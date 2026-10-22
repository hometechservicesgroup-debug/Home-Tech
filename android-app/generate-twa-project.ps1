param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot 'generated')
)

$ErrorActionPreference = 'Stop'
$manifestUrl = 'https://home-tech.pages.dev/manifest.webmanifest'

if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
  throw 'JDK 17+ is required. Install it before generating the Bubblewrap Android project.'
}
if (-not (Get-Command keytool -ErrorAction SilentlyContinue)) {
  throw 'keytool is required and is normally installed with the JDK.'
}

Write-Host 'Bubblewrap will ask for app metadata and signing-key details.'
Write-Host 'Use package ID: com.hometech.services'
Write-Host 'Keep the release signing key private and outside Git.'
npx --yes @bubblewrap/cli init --manifest="$manifestUrl" --directory="$OutputDirectory"
