$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'ci-local.ps1')

$sessionSuffix = [guid]::NewGuid().ToString('N')
$otherSuffix = [guid]::NewGuid().ToString('N')
$name = "demanage-ci-cleanup-test-$sessionSuffix"
$image = 'postgres:18.6-alpine3.24@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873'

# docker create never starts PostgreSQL; it registers a disposable container
# exclusively for proving the ownership guard refuses an unrelated session.
$containerId = & docker create --name $name --label "demanage.ci-local.session=$sessionSuffix" $image
if ($LASTEXITCODE -ne 0 -or ($containerId -join '').Trim() -notmatch '^[a-f0-9]{64}$') {
  throw 'Could not create disposable Docker ownership fixture.'
}
$containerId = ($containerId -join '').Trim()

try {
  $rejected = $false
  try {
    Remove-OwnedCiContainer $containerId $otherSuffix
  } catch {
    $rejected = $true
  }
  if (-not $rejected) { throw 'Cleanup accepted an unrelated session ID.' }

  $remaining = (& docker ps -a --filter "id=$containerId" --format '{{.ID}}')
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($remaining -join '').Trim())) {
    throw 'Ownership mismatch deleted the test container.'
  }
  Write-Host 'PASS: cleanup refuses another session and leaves its container intact'

  Remove-OwnedCiContainer $containerId $sessionSuffix
  $remaining = (& docker ps -a --filter "id=$containerId" --format '{{.ID}}')
  if ($LASTEXITCODE -ne 0 -or -not [string]::IsNullOrWhiteSpace(($remaining -join '').Trim())) {
    throw 'Owned CI container still exists after cleanup.'
  }
  Write-Host 'PASS: cleanup removes only the container with the matching session label'
} finally {
  # If an assertion failed, clean up only this fixture after revalidating its label.
  $remaining = (& docker ps -a --filter "id=$containerId" --format '{{.ID}}')
  if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace(($remaining -join '').Trim())) {
    Remove-OwnedCiContainer $containerId $sessionSuffix
  }
}
