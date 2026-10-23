# Runs only on a disposable GitHub Actions runner. The production backup script
# uses a fixed Docker container name; ownership must be verified before use.
$ErrorActionPreference = 'Stop'

if ($env:GITHUB_ACTIONS -ne 'true' -or $env:CI -ne 'true' -or
    $env:RUNNER_TEMP -eq $null -or $env:RUNNER_TEMP -eq '' -or
    $env:DEMANAGE_O04_OWNER -notmatch '^[0-9]+-[0-9]+$') {
  throw 'O04 E2E can run only in its isolated GitHub Actions job.'
}

$containerName = 'demanage-db'
$labelFormat = '{{ index .Config.Labels "org.demanage.o04.owner" }}'

function Assert-OwnedContainer {
  $observed = & docker inspect --format $labelFormat $containerName 2>$null
  if ($LASTEXITCODE -ne 0 -or ($observed -join '').Trim() -ne $env:DEMANAGE_O04_OWNER) {
    throw 'O04 refused to access a Docker container it does not own.'
  }
}

function Invoke-OwnedDocker {
  param([Parameter(Mandatory)][string[]]$Command)
  Assert-OwnedContainer
  $output = & docker @Command 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "O04 Docker command failed ($LASTEXITCODE): $($Command[0]) $($Command[1])"
  }
  return $output
}

function Get-FixtureFingerprint {
  param([Parameter(Mandatory)][string]$Database)
  # Hex-encoding text makes delimiters, line breaks and Unicode unambiguous.
  $sql = @'
SELECT row_id::text || '|' || amount::text || '|' ||
       CASE WHEN note IS NULL THEN 'NULL' ELSE encode(convert_to(note, 'UTF8'), 'hex') END
FROM public.o04_backup_restore_fixture ORDER BY row_id;
'@
  $rows = @(Invoke-OwnedDocker -Command @('exec', $containerName, 'psql', '-X', '-A', '-t',
    '-v', 'ON_ERROR_STOP=1', '-U', 'demanage', '-d', $Database, '-c', $sql))
  if ($rows.Count -ne 4) { throw "O04 expected four rows in $Database; got $($rows.Count)" }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes(($rows -join "`n"))
  return [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
}

Assert-OwnedContainer

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sourceScript = Join-Path $repoRoot 'scripts/backup-db.ps1'
$fixtureRoot = Join-Path $env:RUNNER_TEMP "demanage-o04-$([guid]::NewGuid().ToString('N'))"
$fixtureScripts = Join-Path $fixtureRoot 'scripts'
$fixtureBackups = Join-Path $fixtureRoot 'backups'
$fixtureScript = Join-Path $fixtureScripts 'backup-db.ps1'
$restoreDb = "o04_restore_$([guid]::NewGuid().ToString('N').Substring(0, 16))"
$stagedDump = "/tmp/o04-restore-$([guid]::NewGuid().ToString('N')).dump"
$restoreCreated = $false
$dumpStaged = $false

try {
  New-Item -ItemType Directory -Path $fixtureScripts -Force | Out-Null
  Copy-Item -LiteralPath $sourceScript -Destination $fixtureScript

  $seed = @'
CREATE TABLE public.o04_backup_restore_fixture (
  row_id integer PRIMARY KEY,
  amount numeric(18,4) NOT NULL,
  note text
);
INSERT INTO public.o04_backup_restore_fixture (row_id, amount, note) VALUES
  (1, 100.25, 'Ariquemes - café'),
  (2, -12.3456, 'quoted ''line'''),
  (3, 0, NULL),
  (4, 999999.9999, 'line' || chr(10) || 'break');
'@
  [void](Invoke-OwnedDocker -Command @('exec', $containerName, 'psql', '-X',
    '-v', 'ON_ERROR_STOP=1', '-U', 'demanage', '-d', 'demanage', '-c', $seed))
  $before = Get-FixtureFingerprint -Database 'demanage'

  # Execute the *unaltered* real backup-db.ps1 against the disposable database.
  # The copied file redirects its normal backups/ folder to RUNNER_TEMP.
  & $fixtureScript -RetentionDays 1 | Out-Null
  $dumps = @(Get-ChildItem -LiteralPath $fixtureBackups -Filter 'demanage-*.dump' -File)
  if ($dumps.Count -ne 1 -or $dumps[0].Length -le 0) {
    throw "O04 expected one non-empty real pg_dump; got $($dumps.Count)"
  }
  $dumpHash = (Get-FileHash -LiteralPath $dumps[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant()

  # Verify that the produced custom archive is structurally readable.
  [void](Invoke-OwnedDocker -Command @('cp', $dumps[0].FullName, "${containerName}:$stagedDump"))
  $dumpStaged = $true
  $archive = @(Invoke-OwnedDocker -Command @('exec', $containerName, 'pg_restore', '--list', $stagedDump))
  if (-not ($archive -match 'TABLE DATA.*o04_backup_restore_fixture')) {
    throw 'O04 backup archive does not contain the fixture table data.'
  }

  [void](Invoke-OwnedDocker -Command @('exec', $containerName, 'createdb', '-U', 'demanage', $restoreDb))
  $restoreCreated = $true
  [void](Invoke-OwnedDocker -Command @('exec', $containerName, 'pg_restore', '-U', 'demanage',
    '-d', $restoreDb, '--no-owner', '--no-privileges', '--exit-on-error', $stagedDump))
  $after = Get-FixtureFingerprint -Database $restoreDb
  if ($before -ne $after) { throw "O04 restored rows do not match their source: $before != $after" }

  Write-Host "PASS O04: real pg_dump + pg_restore, 4 rows, content SHA256=$before, dump SHA256=$dumpHash"
} finally {
  # All cleanup targets are private to this run; never delete other containers,
  # databases, dumps or user files. The CI job removes its own labeled container.
  if ($restoreCreated) {
    [void](Invoke-OwnedDocker -Command @('exec', $containerName, 'dropdb', '-U', 'demanage', '--if-exists', $restoreDb))
  }
  if ($dumpStaged) {
    [void](Invoke-OwnedDocker -Command @('exec', $containerName, 'rm', '-f', $stagedDump))
  }
  if (Test-Path -LiteralPath $fixtureRoot) {
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
  }
}
