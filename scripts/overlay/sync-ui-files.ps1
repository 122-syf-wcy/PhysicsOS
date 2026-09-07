# Mirror a list of ui-physicsos files from vendor/ to overlays/ (or back).
# The overlay `apply` re-copies overlay files over vendor, so an in-progress
# vendor edit is lost if a teammate runs `apply` mid-way; mirroring each touched
# file right after editing makes the two trees agree at every step.
#
#   pwsh scripts/overlay/sync-ui-files.ps1 src/client/Foo.tsx src/client/Foo.module.css
#   pwsh scripts/overlay/sync-ui-files.ps1 -Reverse src/client/Foo.tsx
param(
  [switch]$Reverse,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Files
)

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$pkg = 'packages\client\ui-physicsos'
$vendor = Join-Path $root "vendor\deepseek-harness\$pkg"
$overlay = Join-Path $root "overlays\harness\files\$pkg"

foreach ($file in $Files) {
  $rel = $file -replace '/', '\'
  $from = if ($Reverse) { Join-Path $overlay $rel } else { Join-Path $vendor $rel }
  $to = if ($Reverse) { Join-Path $vendor $rel } else { Join-Path $overlay $rel }
  if (-not (Test-Path $from)) { Write-Warning "missing: $from"; continue }
  New-Item -ItemType Directory -Force -Path (Split-Path $to) | Out-Null
  Copy-Item -Path $from -Destination $to -Force
  Write-Host "synced $rel"
}
