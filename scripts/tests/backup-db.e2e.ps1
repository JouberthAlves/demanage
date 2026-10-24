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

function Assert-FixtureSchema {
  param([Parameter(Mandatory)][string]$Database)
  $columnsSql = @'
SELECT 'COLUMN|' || attname || '|' || format_type(atttypid, atttypmod) || '|' ||
       CASE WHEN attnotnull THEN 'NOT NULL' ELSE 'NULL' END
FROM pg_attribute
WHERE attrelid = 'public.o04_backup_restore_fixture'::regclass
  AND attnum > 0 AND NOT attisdropped
ORDER BY attnum;
'@
  $columns = @(Invoke-OwnedDocker -Command @('exec', $containerName, 'psql', '-X', '-A', '-t',
    '-v', 'ON_ERROR_STOP=1', '-U', 'demanage', '-d', $Database, '-c', $columnsSql))
  $expected = @('COLUMN|row_id|integer|NOT NULL',
    'COLUMN|amount|numeric(18,4)|NOT NULL', 'COLUMN|note|text|NULL')
  if (($columns -join "`n") -ne ($expected -join "`n")) {
    throw "O04 unexpected fixture column schema in $Database"
  }
  $primaryKey = @(Invoke-OwnedDocker -Command @('exec', $containerName, 'psql', '-X', '-A', '-t',
    '-v', 'ON_ERROR_STOP=1', '-U', 'demanage', '-d', $Database, '-c',
    "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.o04_backup_restore_fixture'::regclass AND contype = 'p';"))
  if ($primaryKey.Count -ne 1 -or $primaryKey[0] -ne 'PRIMARY KEY (row_id)') {
    throw "O04 unexpected fixture primary key in $Database"
  }
}

function Assert-ArchiveRejected {
  param([Parameter(Mandatory)][string]$Archive, [Parameter(Mandatory)][string]$Case)
  Assert-OwnedContainer
  & docker exec $containerName pg_restore --list $Archive 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { throw "O04 accepted $Case archive" }
  # A failed Docker daemon/container must never masquerade as archive rejection.
  [void](Invoke-OwnedDocker -Command @('exec', $containerName, 'pg_isready',
    '-U', 'demanage', '-d', 'demanage'))
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
$stagedTampered = "/tmp/o04-tampered-$([guid]::NewGuid().ToString('N')).dump"
$stagedTruncated = "/tmp/o04-truncated-$([guid]::NewGuid().ToString('N')).dump"
$restoreCreated = $false
$dumpStaged = $false
$tamperedStaged = $false
$truncatedStaged = $false

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
  Assert-FixtureSchema -Database 'demanage'
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

  # Known-bad copies must be rejected by the same real pg_restore parser.
  # The original freshly generated dump remains untouched for the restore.
  $tampered = Join-Path $fixtureRoot 'tampered.dump'
  Copy-Item -LiteralPath $dumps[0].FullName -Destination $tampered
  $stream = [System.IO.File]::Open($tampered, 'Open', 'Write', 'None')
  try { $stream.WriteByte(0) } finally { $stream.Dispose() }
  [void](Invoke-OwnedDocker -Command @('cp', $tampered, "${containerName}:$stagedTampered"))
  $tamperedStaged = $true
  Assert-ArchiveRejected -Archive $stagedTampered -Case 'tampered'

  $truncated = Join-Path $fixtureRoot 'truncated.dump'
  Copy-Item -LiteralPath $dumps[0].FullName -Destination $truncated
  $stream = [System.IO.File]::Open($truncated, 'Open', 'Write', 'None')
  try { $stream.SetLength(8) } finally { $stream.Dispose() }
  [void](Invoke-OwnedDocker -Command @('cp', $truncated, "${containerName}:$stagedTruncated"))
  $truncatedStaged = $true
  Assert-ArchiveRejected -Archive $stagedTruncated -Case 'truncated'

  [void](Invoke-OwnedDocker -Command @('exec', $containerName, 'createdb', '-U', 'demanage', $restoreDb))
  $restoreCreated = $true
  [void](Invoke-OwnedDocker -Command @('exec', $containerName, 'pg_restore', '-U', 'demanage',
    '-d', $restoreDb, '--no-owner', '--no-privileges', '--exit-on-error', $stagedDump))
  Assert-FixtureSchema -Database $restoreDb
  $after = Get-FixtureFingerprint -Database $restoreDb
  if ($before -ne $after) { throw "O04 restored rows do not match their source: $before != $after" }

  Write-Host "PASS O04: real pg_dump + pg_restore, schema/PK, 4 rows, tampered/truncated rejected, content SHA256=$before, dump SHA256=$dumpHash"
} finally {
  # All cleanup targets are private to this run; never delete other containers,
  # databases, dumps or user files. The CI job removes its own labeled container.
  if ($restoreCreated) {
    [void](Invoke-OwnedDocker -Command @('exec', $containerName, 'dropdb', '-U', 'demanage', '--if-exists', $restoreDb))
  }
  if ($dumpStaged) {
    [void](Invoke-OwnedDocker -Command @('exec', $containerName, 'rm', '-f', $stagedDump))
  }
  if ($tamperedStaged) {
    [void](Invoke-OwnedDocker -Command @('exec', $containerName, 'rm', '-f', $stagedTampered))
  }
  if ($truncatedStaged) {
    [void](Invoke-OwnedDocker -Command @('exec', $containerName, 'rm', '-f', $stagedTruncated))
  }
  if (Test-Path -LiteralPath $fixtureRoot) {
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
  }
}
