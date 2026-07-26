# ===========================================================================
# NIGHTCELL 7 installer for Windows
#
#   irm https://nightcell7.com/install.ps1 | iex
#
# Subcommands (a piped script cannot take arguments, so use the env var):
#   $env:NIGHTCELL7_COMMAND='update';    irm https://nightcell7.com/install.ps1 | iex
#   $env:NIGHTCELL7_COMMAND='uninstall'; irm https://nightcell7.com/install.ps1 | iex
#   $env:NIGHTCELL7_COMMAND='login';     irm https://nightcell7.com/install.ps1 | iex
#
# Downloads the NSIS installer, verifies its checksum, and runs it.
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

function Get-InstalledApp {
  Get-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like '*NIGHTCELL*' } | Select-Object -First 1
}

function Invoke-Uninstall {
  $app = Get-InstalledApp
  if (-not $app) { Write-Warned 'NIGHTCELL 7 does not appear to be installed.'; return }
  Write-Info "Removing $($app.DisplayName)"
  if ($app.QuietUninstallString) {
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $app.QuietUninstallString -Wait
  } elseif ($app.UninstallString) {
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $app.UninstallString -Wait
  } else {
    Write-Failure 'No uninstall command registered. Remove it from Settings > Apps.'
  }
  Write-Ok 'NIGHTCELL 7 removed.'
  Write-Host '  Local saves and settings were left alone: %APPDATA%\NIGHTCELL 7' -ForegroundColor DarkGray
}

function Show-Version {
  $app = Get-InstalledApp
  if ($app) { Write-Host "installed: v$($app.DisplayVersion)" } else { Write-Host 'NIGHTCELL 7 is not installed.'; return }
  try {
    $rel = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
    Write-Host "latest:    $($rel.tag_name)"
  } catch { }
}

function Invoke-Login {
  # Authentication is a browser-session concern; the desktop client has no
  # privileged path to credentials.
  $url = 'https://nightcell7.com/login?from=cli'
  Write-Info "Opening $url"
  Start-Process $url
  Write-Ok 'Sign in in your browser, then launch the game.'
}

function Invoke-Install {
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

  # --- locate the asset ------------------------------------------------------
  # Asset names are decided by the packaging tool, so discover them from the
  # release rather than reconstructing a filename.
  try {
    $rel = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/tags/v$version"
  } catch {
    Write-Failure "Release v$version not found."
  }

  $assetPattern = if ($arch -eq 'arm64') { 'win-arm64\.exe$' } else { 'win-x64\.exe$' }
  $assetItem = $rel.assets | Where-Object { $_.name -match $assetPattern } | Select-Object -First 1
  if (-not $assetItem) {
    # Fall back to any .exe, so a naming change degrades rather than breaks.
    $assetItem = $rel.assets | Where-Object { $_.name -like '*.exe' } | Select-Object -First 1
  }
  if (-not $assetItem) { Write-Failure "No Windows installer in v$version. See https://nightcell7.com/downloads" }

  $name = $assetItem.name
  $url  = $assetItem.browser_download_url
  $dest = Join-Path $env:TEMP $name

  Write-Info "Downloading $name"
  try {
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
  } catch {
    Write-Failure "Download failed."
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
  Write-Warned 'This build is unsigned. Windows SmartScreen may warn on first run.'
  Write-Host '  The demo and multiplayer alpha are free. No account needed to play the demo.' -ForegroundColor DarkGray
  Write-Host '  Prefer a package manager? https://nightcell7.com/downloads' -ForegroundColor DarkGray
  Write-Host ''
}

$command = if ($env:NIGHTCELL7_COMMAND) { $env:NIGHTCELL7_COMMAND.ToLower() } else { 'install' }

switch ($command) {
  'install'   { Invoke-Install }
  'update'    { Invoke-Install }
  'upgrade'   { Invoke-Install }
  'uninstall' { Invoke-Uninstall }
  'remove'    { Invoke-Uninstall }
  'login'     { Invoke-Login }
  'signin'    { Invoke-Login }
  'version'   { Show-Version }
  default     { Write-Failure "Unknown command: $command" }
}
