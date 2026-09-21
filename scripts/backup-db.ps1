param(
  [int]$RetentionDays = 30
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$backupDir = Join-Path $repoRoot 'backups'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = Join-Path $backupDir "demanage-$timestamp.dump"
$containerPath = '/tmp/demanage-backup.dump'

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

try {
  docker exec demanage-db pg_dump -U demanage -d demanage --format=custom --no-owner --no-privileges --file=$containerPath

  if ($LASTEXITCODE -ne 0) {
    throw 'pg_dump falhou.'
  }

  docker cp "demanage-db:$containerPath" $backupPath
  if ($LASTEXITCODE -ne 0) {
    throw 'docker cp falhou.'
  }
} finally {
  docker exec demanage-db rm -f $containerPath 2>$null | Out-Null
}

Get-ChildItem -Path $backupDir -Filter 'demanage-*.dump' -File |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } |
  Remove-Item -Force

Write-Host "Backup criado: $backupPath"
