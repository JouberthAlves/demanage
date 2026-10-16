param(
  [switch]$BuildImages,
  [switch]$GuardOnly,
  [string]$LogDirectory
)

$ErrorActionPreference = 'Stop'
$script:ciSecrets = @()

function Assert-NoInheritedDatabaseUrls {
  foreach ($name in @('DATABASE_URL', 'SHADOW_DATABASE_URL')) {
    if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, 'Process'))) {
      throw "$name is already set. Unset it before running local CI; this runner only uses databases in its own disposable Docker container."
    }
  }
}

function Assert-CiDisposableEndpoints(
  [string]$DatabaseUrl,
  [string]$ShadowDatabaseUrl,
  [string]$SessionSuffix,
  [int]$Port
) {
  if ([string]::IsNullOrWhiteSpace($DatabaseUrl) -or [string]::IsNullOrWhiteSpace($ShadowDatabaseUrl)) {
    throw 'Both DATABASE_URL and a separate disposable SHADOW_DATABASE_URL are required.'
  }
  if ($SessionSuffix -notmatch '^[0-9a-f]{32}$' -or $Port -lt 1 -or $Port -gt 65535) {
    throw 'Invalid disposable CI session identity or port.'
  }
  $names = @("demanage_ci_$SessionSuffix", "demanage_ci_shadow_$SessionSuffix")
  $urls = @($DatabaseUrl, $ShadowDatabaseUrl)
  $identities = @()
  for ($index = 0; $index -lt 2; $index++) {
    $parsed = $null
    if (-not [Uri]::TryCreate($urls[$index], [UriKind]::Absolute, [ref]$parsed)) {
      throw 'Invalid CI PostgreSQL connection URL.'
    }
    if ($parsed.Scheme -ne 'postgresql' -or $parsed.Host -ne '127.0.0.1' -or
        $parsed.Port -ne $Port -or $parsed.AbsolutePath -ne "/$($names[$index])" -or
        $parsed.UserInfo -notmatch '^ci_runner:[0-9a-f]{64}$' -or $parsed.Query -ne '?schema=public') {
      throw 'CI database URLs must point to the two expected disposable databases on the generated loopback port.'
    }
    $identities += $parsed.UserInfo
  }
  if ($identities[0] -cne $identities[1]) {
    throw 'CI primary and shadow database credentials differ.'
  }
}

function Assert-MigrationTimestamps([string]$MigrationsDirectory) {
  $names = @(Get-ChildItem -LiteralPath $MigrationsDirectory -Directory |
    Where-Object { $_.Name -match '^[0-9]{14}_' } |
    ForEach-Object { $_.Name.Substring(0, 14) })
  $duplicates = @($names | Group-Object | Where-Object { $_.Count -gt 1 -and $_.Name -ne '20260821120000' })
  if ($duplicates.Count -gt 0) {
    throw "Duplicate migration timestamps: $(($duplicates | ForEach-Object { $_.Name }) -join ', ')"
  }
}

function Invoke-CiStep(
  [string]$Name,
  [string]$Executable,
  [string[]]$Arguments,
  [string]$WorkingDirectory,
  [string]$LogDirectory
) {
  $safeName = $Name -replace '[^a-zA-Z0-9_-]', '-'
  $logPath = Join-Path $LogDirectory "$safeName.log"
  $writer = New-Object System.IO.StreamWriter($logPath, $false, (New-Object System.Text.UTF8Encoding($false)))
  $previousErrorAction = $ErrorActionPreference
  Write-Host "CI: $Name"
  try {
    $writer.WriteLine("Step: $Name")
    $writer.WriteLine("Started: $([DateTime]::UtcNow.ToString('o'))")
    Push-Location -LiteralPath $WorkingDirectory
    try {
      # PowerShell 5.1 turns redirected native stderr into ErrorRecords.
      # Preserve the actual native exit code even if stderr was populated.
      $ErrorActionPreference = 'Continue'
      & $Executable @Arguments 2>&1 | ForEach-Object {
        $line = if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { $_.ToString() }
        foreach ($secret in $script:ciSecrets) {
          if (-not [string]::IsNullOrEmpty($secret)) {
            $line = $line.Replace($secret, '[REDACTED]')
          }
        }
        $writer.WriteLine($line)
        Write-Host $line
      }
      $code = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorAction
      Pop-Location
    }
    $writer.WriteLine("Exit code: $code")
    if ($code -ne 0) {
      throw "CI step '$Name' failed with exit code $code. Log: $logPath"
    }
  } finally {
    $writer.Dispose()
  }
}

function Assert-CiTooling([string]$BackendDirectory) {
  foreach ($binary in @('node', 'corepack', 'docker', 'python')) {
    if (-not (Get-Command $binary -ErrorAction SilentlyContinue)) {
      throw "Missing required tool: $binary (Node >=24, Corepack/pnpm 10.17.1, Docker, Python)."
    }
  }
  $nodeVersionText = (& node --version).TrimStart('v')
  if ($LASTEXITCODE -ne 0 -or [version]$nodeVersionText -lt [version]'24.0.0') {
    throw "Node 24+ required; installed version: $nodeVersionText"
  }
  Push-Location -LiteralPath $BackendDirectory
  try {
    $pnpmVersion = (& corepack pnpm --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $pnpmVersion -ne '10.17.1') {
      throw "Corepack must resolve pnpm 10.17.1; found $pnpmVersion."
    }
  } finally {
    Pop-Location
  }
  & docker info --format '{{.ServerVersion}}' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Docker daemon is unavailable.' }
}

function New-CiRandomPassword {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
}

function Remove-OwnedCiContainer([string]$ContainerId, [string]$SessionSuffix) {
  if ($ContainerId -notmatch '^[a-f0-9]{64}$' -or $SessionSuffix -notmatch '^[a-f0-9]{32}$') {
    throw 'Invalid CI container identity for cleanup.'
  }
  # JSON avoids PowerShell 5.1 stripping nested quotes inside Docker's
  # Go template and accidentally turning a label name into a template call.
  $labelsJson = (& docker inspect --format '{{json .Config.Labels}}' $ContainerId)
  if ($LASTEXITCODE -ne 0) { throw "Cannot inspect CI container $ContainerId for cleanup." }
  $labels = ($labelsJson -join '') | ConvertFrom-Json
  if ($labels.'demanage.ci-local.session' -cne $SessionSuffix) {
    throw "CI container ownership check failed; refusing cleanup of $ContainerId."
  }
  & docker rm -f $ContainerId | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not remove owned CI container $ContainerId." }
}

# Dot-sourcing exposes guard functions to isolated PowerShell smoke tests.
if ($MyInvocation.InvocationName -eq '.') { return }

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDirectory = Join-Path $repoRoot 'backend'
$frontendDirectory = Join-Path $repoRoot 'frontend'
$sessionSuffix = [guid]::NewGuid().ToString('N')
$containerId = $null
$containerName = "demanage-ci-$sessionSuffix"
$originalTz = [Environment]::GetEnvironmentVariable('TZ', 'Process')
$originalJwtSecret = [Environment]::GetEnvironmentVariable('JWT_SECRET', 'Process')
$originalAppUrl = [Environment]::GetEnvironmentVariable('APP_URL', 'Process')

try {
  Assert-NoInheritedDatabaseUrls
  if ($GuardOnly) {
    Write-Host 'CI guard OK: no inherited database URLs. Full runs provision both disposable databases.'
    exit 0
  }

  Assert-CiTooling $backendDirectory
  Assert-MigrationTimestamps (Join-Path $backendDirectory 'prisma/migrations')
  if ([string]::IsNullOrWhiteSpace($LogDirectory)) {
    $LogDirectory = Join-Path $repoRoot "artifacts/ci-local/$([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))-$sessionSuffix"
  }
  if (-not [System.IO.Path]::IsPathRooted($LogDirectory)) {
    $LogDirectory = Join-Path $repoRoot $LogDirectory
  }
  New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
  Write-Host "CI logs: $LogDirectory"

  # A brand-new PostgreSQL 18 container owns both CI databases. Never operate
  # on an existing container, and never drop an arbitrary local database.
  $pgPassword = New-CiRandomPassword
  $dbName = "demanage_ci_$sessionSuffix"
  $shadowName = "demanage_ci_shadow_$sessionSuffix"
  $pgImage = 'postgres:18.6-alpine3.24@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873'
  $dockerArgs = @(
    'run', '--detach', '--rm', '--name', $containerName,
    '--label', "demanage.ci-local.session=$sessionSuffix",
    '-e', 'POSTGRES_USER=ci_runner',
    '-e', "POSTGRES_PASSWORD=$pgPassword",
    '-e', "POSTGRES_DB=$dbName",
    '-e', 'TZ=UTC',
    '-p', '127.0.0.1::5432',
    "--health-cmd=pg_isready -U ci_runner -d $dbName",
    '--health-interval=2s', '--health-timeout=3s', '--health-retries=35',
    $pgImage
  )
  $startedContainer = & docker @dockerArgs
  if ($LASTEXITCODE -ne 0) { throw 'Could not start isolated PostgreSQL 18 container.' }
  $startedContainer = ($startedContainer -join '').Trim()
  if ($startedContainer -notmatch '^[a-f0-9]{64}$') {
    throw 'Docker did not return a valid container ID; refusing to touch other containers.'
  }
  $containerId = $startedContainer

  $ready = $false
  for ($attempt = 0; $attempt -lt 90; $attempt++) {
    $health = (& docker inspect --format '{{.State.Health.Status}}' $containerId)
    if ($LASTEXITCODE -ne 0) { throw 'Ephemeral database container vanished.' }
    if (($health -join '').Trim() -eq 'healthy') { $ready = $true; break }
    if (($health -join '').Trim() -eq 'unhealthy') { throw 'Ephemeral database failed its health check.' }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Ephemeral PostgreSQL timed out during startup.' }

  $portBinding = (& docker port $containerId '5432/tcp')
  if ($LASTEXITCODE -ne 0 -or ($portBinding -join '').Trim() -notmatch '^127[.]0[.]0[.]1:(\d{1,5})$') {
    throw 'Disposable PostgreSQL must bind a unique loopback port.'
  }
  $pgPort = [int]$Matches[1]
  $databaseUrl = "postgresql://ci_runner:$($pgPassword)@127.0.0.1:$pgPort/$($dbName)?schema=public"
  $shadowDatabaseUrl = "postgresql://ci_runner:$($pgPassword)@127.0.0.1:$pgPort/$($shadowName)?schema=public"
  Assert-CiDisposableEndpoints $databaseUrl $shadowDatabaseUrl $sessionSuffix $pgPort

  & docker exec $containerId psql -U ci_runner -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $shadowName" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not create disposable shadow database.' }

  # Process-local env takes precedence over backend/.env, including Prisma dotenv.
  $env:DATABASE_URL = $databaseUrl
  $env:SHADOW_DATABASE_URL = $shadowDatabaseUrl
  $env:JWT_SECRET = "ci-$pgPassword"
  $env:APP_URL = 'http://localhost:5180'
  $env:TZ = 'UTC'
  $script:ciSecrets = @($pgPassword, $databaseUrl, $shadowDatabaseUrl)

  $steps = @(
    @{ Name = '01-backend-install'; WorkingDirectory = $backendDirectory; Executable = 'corepack'; Arguments = @('pnpm', 'install', '--frozen-lockfile') },
    @{ Name = '02-frontend-install'; WorkingDirectory = $frontendDirectory; Executable = 'corepack'; Arguments = @('pnpm', 'install', '--frozen-lockfile') },
    @{ Name = '03-backend-audit'; WorkingDirectory = $backendDirectory; Executable = 'corepack'; Arguments = @('pnpm', 'audit', '--audit-level', 'moderate') },
    @{ Name = '04-frontend-audit'; WorkingDirectory = $frontendDirectory; Executable = 'corepack'; Arguments = @('pnpm', 'audit', '--audit-level', 'moderate') },
    @{ Name = '05-prisma-validate'; WorkingDirectory = $backendDirectory; Executable = 'corepack'; Arguments = @('pnpm', 'exec', 'prisma', 'validate') },
    @{ Name = '06-prisma-generate'; WorkingDirectory = $backendDirectory; Executable = 'corepack'; Arguments = @('pnpm', 'exec', 'prisma', 'generate') },
    @{ Name = '07-migrate-deploy'; WorkingDirectory = $backendDirectory; Executable = 'corepack'; Arguments = @('pnpm', 'exec', 'prisma', 'migrate', 'deploy') },
    @{ Name = '08-migration-drift'; WorkingDirectory = $backendDirectory; Executable = 'corepack'; Arguments = @('pnpm', 'exec', 'prisma', 'migrate', 'diff', '--from-migrations', 'prisma/migrations', '--to-schema', 'prisma/schema.prisma', '--exit-code') },
    @{ Name = '09-backend-typecheck'; WorkingDirectory = $backendDirectory; Executable = 'corepack'; Arguments = @('pnpm', 'typecheck') },
    @{ Name = '10-frontend-typecheck'; WorkingDirectory = $frontendDirectory; Executable = 'corepack'; Arguments = @('pnpm', 'typecheck') },
    @{ Name = '11-backend-lint'; WorkingDirectory = $backendDirectory; Executable = 'corepack'; Arguments = @('pnpm', 'lint') },
    @{ Name = '12-frontend-lint'; WorkingDirectory = $frontendDirectory; Executable = 'corepack'; Arguments = @('pnpm', 'lint') },
    @{ Name = '13-backend-unit'; WorkingDirectory = $backendDirectory; Executable = 'corepack'; Arguments = @('pnpm', 'test:unit') },
    @{ Name = '14-frontend-unit'; WorkingDirectory = $frontendDirectory; Executable = 'corepack'; Arguments = @('pnpm', 'test') },
    @{ Name = '15-backend-integration'; WorkingDirectory = $backendDirectory; Executable = 'corepack'; Arguments = @('pnpm', 'test:integration') },
    @{ Name = '16-backend-build'; WorkingDirectory = $backendDirectory; Executable = 'corepack'; Arguments = @('pnpm', 'build') },
    @{ Name = '17-frontend-build'; WorkingDirectory = $frontendDirectory; Executable = 'corepack'; Arguments = @('pnpm', 'build') },
    @{ Name = '18-deploy-agent-compile'; WorkingDirectory = $repoRoot; Executable = 'python'; Arguments = @('-m', 'compileall', '-q', 'ops/cd') },
    @{ Name = '19-deploy-agent-test'; WorkingDirectory = $repoRoot; Executable = 'python'; Arguments = @('-m', 'unittest', 'discover', '-s', 'ops/cd/tests', '-v') },
    @{ Name = '20-compose-dev-syntax'; WorkingDirectory = $repoRoot; Executable = 'docker'; Arguments = @('compose', '-f', 'docker-compose.yml', 'config', '--quiet', '--no-interpolate') },
    @{ Name = '21-compose-build-syntax'; WorkingDirectory = $repoRoot; Executable = 'docker'; Arguments = @('compose', '-f', 'docker-compose.build.yml', 'config', '--quiet', '--no-interpolate') },
    @{ Name = '22-compose-prod-syntax'; WorkingDirectory = $repoRoot; Executable = 'docker'; Arguments = @('compose', '-f', 'docker-compose.prod.yml', 'config', '--quiet', '--no-interpolate') }
  )
  if ($BuildImages) {
    $steps += @{
      Name = '23-backend-image-build'; WorkingDirectory = $repoRoot; Executable = 'docker'
      Arguments = @('build', '--platform', 'linux/amd64', '--tag', "demanage-ci-backend:$sessionSuffix", './backend')
    }
    $steps += @{
      Name = '24-frontend-image-build'; WorkingDirectory = $repoRoot; Executable = 'docker'
      Arguments = @('build', '--platform', 'linux/amd64', '--build-arg', 'VITE_API_URL=/api', '--tag', "demanage-ci-frontend:$sessionSuffix", './frontend')
    }
  }
  foreach ($step in $steps) {
    Invoke-CiStep -Name $step.Name -Executable $step.Executable -Arguments $step.Arguments -WorkingDirectory $step.WorkingDirectory -LogDirectory $LogDirectory
  }
} catch {
  Write-Error "FAIL: $($_.Exception.Message)"
  exit 1
} finally {
  $env:DATABASE_URL = $null
  $env:SHADOW_DATABASE_URL = $null
  [Environment]::SetEnvironmentVariable('JWT_SECRET', $originalJwtSecret, 'Process')
  [Environment]::SetEnvironmentVariable('APP_URL', $originalAppUrl, 'Process')
  [Environment]::SetEnvironmentVariable('TZ', $originalTz, 'Process')
  if ($containerId -and $containerId -match '^[a-f0-9]{64}$') {
    Remove-OwnedCiContainer $containerId $sessionSuffix
  }
}
Write-Host "PASS: all local CI gates and owned container cleanup. Logs: $LogDirectory"
