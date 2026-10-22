param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Fa-f0-9]{2}(:[A-Fa-f0-9]{2}){31}$')]
  [string]$ReleaseSigningSha256,
  [string]$OutputDirectory = (Join-Path $PSScriptRoot 'digital-asset-links')
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$template = Get-Content (Join-Path $PSScriptRoot 'assetlinks.template.json') -Raw
$assetLinks = $template.Replace('__RELEASE_SIGNING_SHA256__', $ReleaseSigningSha256.ToUpperInvariant())
$target = Join-Path $OutputDirectory 'assetlinks.json'
[System.IO.File]::WriteAllText($target, $assetLinks, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Created $target"
Write-Host 'Copy it to .well-known/assetlinks.json at the website root, then deploy. Do not commit a placeholder fingerprint.'
