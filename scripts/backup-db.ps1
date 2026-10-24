param(
  [ValidateRange(1, 3650)]
  [int]$RetentionDays = 30
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$backupDir = Join-Path $repoRoot 'backups'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$operationId = [guid]::NewGuid().ToString('N')
$backupPath = Join-Path $backupDir "demanage-$timestamp-$operationId.dump"
$containerPath = "/tmp/demanage-backup-$operationId.dump"

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$backupComplete = $false

try {
  docker exec demanage-db pg_dump -U demanage -d demanage --format=custom --no-owner --no-privileges --file=$containerPath

  if ($LASTEXITCODE -ne 0) {
    throw 'pg_dump falhou.'
  }

  docker cp "demanage-db:$containerPath" $backupPath
  if ($LASTEXITCODE -ne 0) {
    throw 'docker cp falhou.'
  }
  $copied = Get-Item -LiteralPath $backupPath -ErrorAction Stop
  if ($copied.Length -eq 0) { throw 'Backup gerado está vazio.' }
  $backupComplete = $true
} finally {
  docker exec demanage-db rm -f $containerPath 2>$null | Out-Null
  if (-not $backupComplete -and (Test-Path -LiteralPath $backupPath)) {
    Remove-Item -LiteralPath $backupPath -Force
  }
}

Get-ChildItem -Path $backupDir -Filter 'demanage-*.dump' -File |
  Where-Object { $_.FullName -ne $backupPath -and $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } |
  Remove-Item -Force

Write-Host "Backup criado: $backupPath"
