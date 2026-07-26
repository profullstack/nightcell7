# ===========================================================================
# NIGHTCELL 7 installer for Windows
#
#   irm https://nightcell7.com/install.ps1 | iex
#
# Downloads the signed NSIS installer, verifies its checksum, and runs it.
# ===========================================================================
$ErrorActionPreference = 'Stop'

$Repo = 'profullstack/nightcell7'

function Write-Info    { param($m) Write-Host "> $m" -ForegroundColor DarkGray }
function Write-Ok      { param($m) Write-Host "OK $m" -ForegroundColor Green }
function Write-Warned  { param($m) Write-Host "!  $m" -ForegroundColor Yellow }
function Write-Failure { param($m) Write-Host "X  $m" -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host '  NIGHTCELL 7 - FALSE DAWN'
Write-Host '  Two operatives. Two countries. One manufactured war.' -ForegroundColor DarkGray
Write-Host ''

# --- architecture ----------------------------------------------------------
$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
  'AMD64' { 'x64' }
  'ARM64' { 'arm64' }
  default { Write-Failure "Unsupported architecture: $env:PROCESSOR_ARCHITECTURE" }
}

# --- version ---------------------------------------------------------------
$version = $env:NIGHTCELL7_VERSION
if (-not $version) {
  try {
    $release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
    $version = $release.tag_name -replace '^v', ''
  } catch {
    Write-Failure 'Could not determine the latest version. No release published yet? See https://nightcell7.com/downloads'
  }
}
$version = $version -replace '^v', ''
Write-Info "Installing NIGHTCELL 7 v$version for windows-$arch"

# --- download --------------------------------------------------------------
$name = "NIGHTCELL 7 Setup $version.exe"
$url  = "https://github.com/$Repo/releases/download/v$version/" + [uri]::EscapeDataString($name)
$dest = Join-Path $env:TEMP $name

Write-Info "Downloading $name"
try {
  Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
} catch {
  Write-Failure "Download failed. Is v$version published for $arch?"
}

# --- verify ----------------------------------------------------------------
# A pipe-to-shell installer that does not check what it downloaded is not
# worth the convenience.
try {
  $sums = (Invoke-WebRequest -Uri "https://github.com/$Repo/releases/download/v$version/SHA256SUMS.txt" -UseBasicParsing).Content
  $line = ($sums -split "`n" | Where-Object { $_ -match [regex]::Escape($name) } | Select-Object -First 1)
  if ($line) {
    $expected = ($line -split '\s+')[0]
    $actual = (Get-FileHash -Path $dest -Algorithm SHA256).Hash.ToLower()
    if ($expected.ToLower() -ne $actual) {
      Remove-Item $dest -Force -ErrorAction SilentlyContinue
      Write-Failure 'Checksum mismatch. Refusing to install.'
    }
    Write-Ok 'Checksum verified'
  } else {
    Write-Warned 'Installer not listed in SHA256SUMS.txt; skipping integrity check.'
  }
} catch {
  Write-Warned 'No SHA256SUMS.txt published; skipping integrity check.'
}

# --- install ---------------------------------------------------------------
Write-Info 'Launching the installer'
Start-Process -FilePath $dest -Wait
Remove-Item $dest -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Ok 'Done.'
Write-Host '  The demo and multiplayer alpha are free. No account needed to play the demo.' -ForegroundColor DarkGray
Write-Host '  Prefer a package manager? https://nightcell7.com/downloads' -ForegroundColor DarkGray
Write-Host ''
