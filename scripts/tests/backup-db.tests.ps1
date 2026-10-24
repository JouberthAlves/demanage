$ErrorActionPreference = 'Stop'
$source = Join-Path (Split-Path -Parent $PSScriptRoot) 'backup-db.ps1'
$fixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) "demanage-backup-tests-$([guid]::NewGuid().ToString('N'))"
$scriptsDir = Join-Path $fixtureRoot 'scripts'
$fixture = Join-Path $scriptsDir 'backup-db.ps1'
$global:DemBackupDockerCalls = [System.Collections.ArrayList]::new()
$global:DemBackupCpFailNext = $false
$passed = 0

function docker {
  [void]$global:DemBackupDockerCalls.Add([pscustomobject]@{ Command = $args[0]; Subcommand = $args[2]; Target = $args[-1] })
  $global:LASTEXITCODE = 0
  if ($args[0] -eq 'cp') {
    [System.IO.File]::WriteAllText([string]$args[2], "PGDMP fake disposable fixture")
    if ($global:DemBackupCpFailNext) {
      $global:DemBackupCpFailNext = $false
      $global:LASTEXITCODE = 1
    }
  }
}

function Assert-BackupRejects([int]$Days) {
  $before = $global:DemBackupDockerCalls.Count
  try { & $fixture -RetentionDays $Days | Out-Null } catch {
    if ($global:DemBackupDockerCalls.Count -ne $before) { throw "RetentionDays=$Days called Docker before validation" }
    Write-Host "PASS: RetentionDays=$Days rejected without Docker access"
    return
  }
  throw "RetentionDays=$Days unexpectedly accepted"
}

try {
  New-Item -ItemType Directory -Force -Path $scriptsDir | Out-Null
  Copy-Item -LiteralPath $source -Destination $fixture
  Assert-BackupRejects -1
  $passed++
  Assert-BackupRejects 0
  $passed++
  Assert-BackupRejects 3651
  $passed++

  $backupDir = Join-Path $fixtureRoot 'backups'
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  $oldBackup = Join-Path $backupDir 'demanage-20200101-000000.dump'
  [System.IO.File]::WriteAllText($oldBackup, 'OLD')
  [System.IO.File]::SetLastWriteTimeUtc($oldBackup, [datetime]'2020-01-01T00:00:00Z')

  & $fixture -RetentionDays 30 | Out-Null
  & $fixture -RetentionDays 30 | Out-Null
  $backups = @(Get-ChildItem $backupDir -Filter 'demanage-*.dump' -File)
  if ($backups.Count -ne 2) { throw "Two same-second runs did not retain distinct backups: $($backups.Count)" }
  if (Test-Path -LiteralPath $oldBackup) { throw 'Expired backup was not removed' }
  $passed++
  Write-Host 'PASS: two immediate backup runs retain distinct files and clean up only expired backups'

  $dumpTargets = @($global:DemBackupDockerCalls | Where-Object { $_.Command -eq 'exec' -and $_.Subcommand -eq 'pg_dump' } | ForEach-Object { $_.Target })
  if (@($dumpTargets | Select-Object -Unique).Count -ne 2) { throw 'Concurrent backup commands reuse the same container temporary path' }
  $passed++
  Write-Host 'PASS: backup runs use distinct container-side paths'

  $global:DemBackupCpFailNext = $true
  try { & $fixture -RetentionDays 30 | Out-Null; throw 'Failing docker cp returned success' } catch {
    if ($_.Exception.Message -ne 'docker cp falhou.') { throw }
  }
  if (@(Get-ChildItem $backupDir -Filter 'demanage-*.dump' -File).Count -ne 2) {
    throw 'Failed docker cp left a partial dump in the backup directory'
  }
  $passed++
  Write-Host 'PASS: failed copy removes partial backup'

  Write-Host "All $passed disposable backup tests passed."
} finally {
  Remove-Variable -Name DemBackupDockerCalls -Scope Global -ErrorAction SilentlyContinue
  Remove-Variable -Name DemBackupCpFailNext -Scope Global -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $fixtureRoot) { Remove-Item -LiteralPath $fixtureRoot -Recurse -Force }
}
