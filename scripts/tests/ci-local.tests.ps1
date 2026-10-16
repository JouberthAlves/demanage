$ErrorActionPreference = 'Stop'
$runner = Join-Path (Split-Path -Parent $PSScriptRoot) 'ci-local.ps1'
. $runner

$passed = 0
function Assert-Throws([scriptblock]$Action, [string]$Case) {
  try {
    & $Action
  } catch {
    $script:passed++
    Write-Host "PASS: $Case"
    return
  }
  throw "Expected failure: $Case"
}

function Assert-Succeeds([scriptblock]$Action, [string]$Case) {
  & $Action
  $script:passed++
  Write-Host "PASS: $Case"
}

$suffix = '0123456789abcdef0123456789abcdef'
$password = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
$db = "postgresql://ci_runner:$password@127.0.0.1:54327/demanage_ci_$($suffix)?schema=public"
$shadow = "postgresql://ci_runner:$password@127.0.0.1:54327/demanage_ci_shadow_$($suffix)?schema=public"

Assert-Succeeds { Assert-CiDisposableEndpoints $db $shadow $suffix 54327 } 'generated disposable DBs accepted'
Assert-Throws { Assert-CiDisposableEndpoints $db '' $suffix 54327 } 'missing shadow refused'
Assert-Throws { Assert-CiDisposableEndpoints $db $db $suffix 54327 } 'same DB for main/shadow refused'
Assert-Throws { Assert-CiDisposableEndpoints 'postgresql://user:pw@prod.example.com:5432/demanage' $shadow $suffix 54327 } 'production host refused'
Assert-Throws { Assert-CiDisposableEndpoints 'postgresql://user:pw@127.0.0.1:54327/demanage?schema=public' $shadow $suffix 54327 } 'non-disposable DB refused'
Assert-Throws { Assert-CiDisposableEndpoints $db ($shadow.Replace($suffix, 'ffffffffffffffffffffffffffffffff')) $suffix 54327 } 'another session shadow refused'

$originalDb = [Environment]::GetEnvironmentVariable('DATABASE_URL', 'Process')
$originalShadow = [Environment]::GetEnvironmentVariable('SHADOW_DATABASE_URL', 'Process')
try {
  [Environment]::SetEnvironmentVariable('DATABASE_URL', 'postgresql://user:pw@prod.example.com/prod', 'Process')
  [Environment]::SetEnvironmentVariable('SHADOW_DATABASE_URL', $null, 'Process')
  Assert-Throws { Assert-NoInheritedDatabaseUrls } 'inherited production URL refused'
  [Environment]::SetEnvironmentVariable('DATABASE_URL', $null, 'Process')
  [Environment]::SetEnvironmentVariable('SHADOW_DATABASE_URL', $shadow, 'Process')
  Assert-Throws { Assert-NoInheritedDatabaseUrls } 'inherited shadow URL refused'
  [Environment]::SetEnvironmentVariable('SHADOW_DATABASE_URL', $null, 'Process')
  Assert-Succeeds { Assert-NoInheritedDatabaseUrls } 'clean environment accepted'

  # Test the real runner process fail-closed exit status with zero Docker interaction.
  [Environment]::SetEnvironmentVariable('DATABASE_URL', 'postgresql://user:pw@prod.example.com/prod', 'Process')
  $ErrorActionPreference = 'Continue'
  & powershell -NoProfile -ExecutionPolicy Bypass -File $runner -GuardOnly *> $null
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -eq 0) { throw 'Runner unexpectedly accepted inherited DATABASE_URL' }
  $passed++
  Write-Host 'PASS: runner process exits nonzero on unsafe environment'
} finally {
  [Environment]::SetEnvironmentVariable('DATABASE_URL', $originalDb, 'Process')
  [Environment]::SetEnvironmentVariable('SHADOW_DATABASE_URL', $originalShadow, 'Process')
}

$logs = Join-Path ([System.IO.Path]::GetTempPath()) "demanage-ci-guard-tests-$([guid]::NewGuid().ToString('N'))"
try {
  New-Item -ItemType Directory -Path $logs -Force | Out-Null
  $fixture = Join-Path $logs 'intentionally-failing-unit.cjs'
  [System.IO.File]::WriteAllText($fixture, "const test = require('node:test'); test('intentional red fixture', () => { throw new Error('expected failure'); });")
  Assert-Throws {
    Invoke-CiStep -Name 'expected-failing-unit' -Executable 'node' -Arguments @('--test', $fixture) -WorkingDirectory $PSScriptRoot -LogDirectory $logs
  } 'failing Node unit test propagates nonzero exit'
  $resultLog = Join-Path $logs 'expected-failing-unit.log'
  if (-not (Test-Path $resultLog)) { throw 'Failing command did not retain its log' }
  $logText = Get-Content -LiteralPath $resultLog -Raw
  if ($logText -notmatch 'intentional red fixture' -or $logText -notmatch 'Exit code: 1') {
    throw 'The expected failing Node unit test was not logged with exit code 1.'
  }
  $passed++
  Write-Host 'PASS: failing unit test writes a nonzero log'
} finally {
  if (Test-Path $logs) { Remove-Item -LiteralPath $logs -Recurse -Force }
}

Write-Host "All $passed local CI guard tests passed."
