# Guchho installer - https://guchho.js.org/install.ps1
#
# Installs the native Guchho CLI directly from the official npm registry
# tarball. No npm, no Node.js, no administrator privileges required.
#
# Usage:
#   powershell -c "irm https://guchho.js.org/install.ps1 | iex"
#   .\install.ps1 [-Version <x.y.z>] [-InstallDir <path>] [-NoPathUpdate] [-Force]
#
# Environment:
#   GUCHHO_REGISTRY   npm registry (default: https://registry.npmjs.org)

[CmdletBinding()]
param(
  [string]$Version,
  [string]$InstallDir,
  [switch]$NoPathUpdate,
  [switch]$Force,
  [switch]$Help
)

$ErrorActionPreference = 'Stop'

function Show-Usage {
  Write-Host @"
Guchho installer - https://guchho.js.org/install.ps1

Usage:
  powershell -c "irm https://guchho.js.org/install.ps1 | iex"
  .\install.ps1 [-Version <x.y.z>] [-InstallDir <path>] [-NoPathUpdate] [-Force] [-Help]

Parameters:
  -Version        Pin an exact published version (default: latest)
  -InstallDir     Install directory (default: `$env:USERPROFILE\.guchho)
  -NoPathUpdate   Do not modify the user PATH
  -Force          Reinstall even if the same version is already installed
  -Help           Show this help

Supported platforms: win32-x64
"@
}

function Fail([string]$Message) {
  Write-Host "error: $Message" -ForegroundColor Red
  exit 1
}

function Write-Step([string]$Message) {
  Write-Host $Message -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
  Write-Host $Message -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

$GuchhoRegistry = 'https://registry.npmjs.org'
if ($env:GUCHHO_REGISTRY) { $GuchhoRegistry = $env:GUCHHO_REGISTRY }

if (-not $InstallDir) {
  $InstallDir = Join-Path $env:USERPROFILE '.guchho'
}

function Test-LocalUrl([string]$Url) {
  return $Url -match '^http://(localhost|127\.0\.0\.1)([:/]|$)'
}

function Assert-Registry([string]$Registry) {
  if ($Registry -match '^https://') { return }
  if (Test-LocalUrl $Registry) { return }
  Fail "Refusing non-HTTPS registry: $Registry"
}

function Assert-VersionParam([string]$Value) {
  if ($Value -notmatch '^[A-Za-z0-9._+-]+$') {
    Fail "Invalid version string: $Value (only letters, digits, '.', '_', '+', '-' are allowed)."
  }
}

# ---------------------------------------------------------------------------
# Platform detection
# ---------------------------------------------------------------------------

function Get-SystemArchitecture {
  # Prefer .NET's view of the OS architecture: it reports Arm64 even for an
  # x64 process running under emulation on ARM64 Windows.
  try {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    if ($arch -eq 'X64') { return 'x64' }
    if ($arch -eq 'Arm64') { return 'arm64' }
  }
  catch { }

  $procArch = $env:PROCESSOR_ARCHITECTURE
  if ($env:PROCESSOR_ARCHITEW6432) { $procArch = $env:PROCESSOR_ARCHITEW6432 }
  switch ($procArch) {
    'AMD64' { return 'x64' }
    'ARM64' { return 'arm64' }
    'X86' {
      if ($env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { return 'arm64' }
      return 'x86'
    }
    default { return "$procArch".ToLowerInvariant() }
  }
}

function Resolve-PlatformPackage {
  if ($env:OS -ne 'Windows_NT') {
    Fail 'This PowerShell installer targets Windows. Use https://guchho.js.org/install on Linux and macOS.'
  }
  $arch = Get-SystemArchitecture
  switch ($arch) {
    'x64' { return '@guchho/win32-x64' }
    'arm64' {
      Fail @"
Windows ARM64 is not supported: @guchho/win32-arm64 is not published on npm.
On ARM64 Windows you can run the x64 package through emulation, but this
installer does not silently install an unverified combination.
Track the issue at https://github.com/guchho/guchho/issues or build from source:
  https://github.com/guchho/guchho#readme
"@
    }
    default {
      Fail "Unsupported architecture: $arch. Supported: win32-x64."
    }
  }
}

# ---------------------------------------------------------------------------
# Registry metadata
# ---------------------------------------------------------------------------

function Get-HttpContent([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -ErrorAction Stop
    return $response.Content
  }
  catch {
    $statusCode = $null
    try { $statusCode = [int]$_.Exception.Response.StatusCode } catch { }
    if ($statusCode -eq 404) { return $null }
    Fail "Network error while fetching $Url`n$($_.Exception.Message)"
  }
}

function Resolve-VersionMetadata([string]$Package, [string]$RequestedVersion) {
  if ($RequestedVersion) {
    $Url = "$GuchhoRegistry/$Package/$RequestedVersion"
  }
  else {
    $Url = "$GuchhoRegistry/$Package/latest"
  }

  $content = Get-HttpContent $Url
  if ($null -eq $content) {
    if ($RequestedVersion) {
      Fail "Version $RequestedVersion is not published for $Package.`nThis platform package has no release for that version. Check published versions with:`n  curl -s $GuchhoRegistry/$Package"
    }
    Fail "Package $Package is not published at $GuchhoRegistry.`nThe requested platform is not an officially published Guchho target."
  }

  try {
    $doc = $content | ConvertFrom-Json
  }
  catch {
    Fail "Malformed registry metadata for $Package (invalid JSON)."
  }

  if (-not $doc.name -or -not $doc.version) {
    Fail "Malformed registry metadata for $Package (missing name or version)."
  }
  if ($doc.name -ne $Package) {
    Fail "Malformed registry metadata: expected $Package, got $($doc.name)."
  }
  if (-not $doc.dist -or -not $doc.dist.tarball) {
    Fail "Malformed registry metadata for $Package@$($doc.version) (missing dist.tarball)."
  }
  if ($RequestedVersion -and $doc.version -ne $RequestedVersion) {
    Fail "Registry returned $($doc.name)@$($doc.version) when version $RequestedVersion was requested. Refusing to continue."
  }

  Assert-TarballUrl $doc.dist.tarball

  $integrity = ''
  $shasum = ''
  if ($doc.dist.integrity) { $integrity = "$($doc.dist.integrity)" }
  if ($doc.dist.shasum) { $shasum = "$($doc.dist.shasum)" }

  return [pscustomobject]@{
    Name      = $doc.name
    Version   = $doc.version
    Tarball   = $doc.dist.tarball
    Integrity = $integrity
    Shasum    = $shasum
  }
}

function Assert-TarballUrl([string]$Url) {
  if ($Url -notmatch '^https://') {
    if (-not (Test-LocalUrl $Url)) {
      Fail "Refusing tarball URL that is not HTTPS: $Url"
    }
  }
  if ($Url -notmatch '\.tgz$') {
    Fail "Refusing unexpected tarball URL (not a .tgz): $Url"
  }
  if ($Url -notmatch '/-/') {
    Fail "Refusing unexpected tarball URL (not an npm tarball path): $Url"
  }
  $regHost = ([Uri]$GuchhoRegistry).Host
  $urlHost = ([Uri]$Url).Host
  if ($urlHost -ne $regHost) {
    Fail "Refusing tarball URL on unexpected host: $Url (registry: $regHost)"
  }
}

# ---------------------------------------------------------------------------
# Integrity
# ---------------------------------------------------------------------------

function Get-Sha512Base64([string]$Path) {
  $sha = [System.Security.Cryptography.SHA512]::Create()
  try {
    $stream = [System.IO.File]::OpenRead($Path)
    try { $hash = $sha.ComputeHash($stream) }
    finally { $stream.Dispose() }
  }
  finally { $sha.Dispose() }
  return [Convert]::ToBase64String($hash)
}

function Get-Sha1Hex([string]$Path) {
  $sha = [System.Security.Cryptography.SHA1]::Create()
  try {
    $stream = [System.IO.File]::OpenRead($Path)
    try { $hash = $sha.ComputeHash($stream) }
    finally { $stream.Dispose() }
  }
  finally { $sha.Dispose() }
  return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Test-ArchiveIntegrity([string]$Path, [string]$Integrity, [string]$Shasum) {
  if (-not $Integrity -and -not $Shasum) {
    Fail 'No published integrity metadata for the downloaded archive. Refusing to install unverified content.'
  }

  if ($Integrity -like 'sha512-*') {
    $expected = $Integrity.Substring('sha512-'.Length)
    $actual = Get-Sha512Base64 $Path
    if ($actual -ne $expected) {
      Fail @"
Integrity check failed for the downloaded archive (SHA-512 mismatch).
The bytes do not match the published registry metadata. Refusing to install.
Re-run this script, or report the issue at https://github.com/guchho/guchho/issues
"@
    }
    return
  }

  if ($Integrity -like 'sha1-*') {
    $expectedB64 = $Integrity.Substring('sha1-'.Length)
    $expectedHex = ([Convert]::FromBase64String($expectedB64) | ForEach-Object { $_.ToString('x2') }) -join ''
    $actualHex = Get-Sha1Hex $Path
    if ($actualHex -ne $expectedHex) {
      Fail 'Integrity check failed for the downloaded archive (SHA-1 mismatch). Refusing to install.'
    }
    return
  }

  if (-not $Integrity -and $Shasum) {
    $actualHex = Get-Sha1Hex $Path
    if ($actualHex -ne $Shasum.ToLowerInvariant()) {
      Fail 'Integrity check failed for the downloaded archive (SHA-1 shasum mismatch). Refusing to install.'
    }
    return
  }

  $algo = ($Integrity -split '-', 2)[0]
  Fail "Unsupported integrity algorithm published by the registry: $algo"
}

# ---------------------------------------------------------------------------
# Download and extraction
# ---------------------------------------------------------------------------

function Get-File([string]$Url, [string]$OutFile) {
  try {
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -ErrorAction Stop
  }
  catch {
    # Fallback for environments where Invoke-WebRequest is restricted.
    try {
      $client = New-Object System.Net.WebClient
      $client.DownloadFile($Url, $OutFile)
    }
    catch {
      Fail "Download failed: $Url`nCheck your network connection and re-run this script.`n$($_.Exception.Message)"
    }
  }
  if (-not (Test-Path $OutFile) -or (Get-Item $OutFile).Length -eq 0) {
    Fail "Download failed (empty file): $Url"
  }
}

function Get-TarPath {
  $bundled = Join-Path $env:SystemRoot 'System32\tar.exe'
  if (Test-Path $bundled) { return $bundled }
  $cmd = Get-Command tar -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  Fail 'tar.exe not found. Windows 10 version 1803 or later is required to extract .tgz archives.'
}

function Invoke-TarList([string]$TarExe, [string[]]$TarArgs) {
  # Native commands write to stderr; under $ErrorActionPreference = 'Stop'
  # that becomes a terminating error, so relax it for the call.
  $previousEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $TarExe @TarArgs 2>&1
    $code = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousEap
  }
  return [pscustomobject]@{ Output = $output; ExitCode = $code }
}

function Test-ArchiveEntries([string]$TarExe, [string]$Archive) {
  $result = Invoke-TarList $TarExe @('-tzf', $Archive)
  if ($result.ExitCode -ne 0) {
    Fail 'The downloaded archive is corrupt or is not a gzip tar archive.'
  }
  $entries = $result.Output
  foreach ($entry in $entries) {
    $name = "$entry"
    if ($name -match '^([A-Za-z]:)?[/\\]') {
      Fail "Unsafe absolute path in archive: $name"
    }
    foreach ($part in ($name -split '[/\\]')) {
      if ($part -eq '..') {
        Fail "Unsafe path traversal in archive: $name"
      }
    }
  }

  $result = Invoke-TarList $TarExe @('-tvzf', $Archive)
  if ($result.ExitCode -ne 0) {
    Fail 'The downloaded archive is corrupt or is not a gzip tar archive.'
  }
  $members = $result.Output
  foreach ($member in $members) {
    $line = "$member"
    if ($line -match '^[lh]') {
      Fail "Unexpected link entry in archive: $line"
    }
  }
}

function Expand-ArchiveSafely([string]$TarExe, [string]$Archive, [string]$Destination) {
  $result = Invoke-TarList $TarExe @('-xzf', $Archive, '-C', $Destination)
  if ($result.ExitCode -ne 0) {
    Fail 'Extraction failed. The downloaded archive may be corrupt.'
  }
}

function Assert-PackageLayout([string]$Dir, [string]$Package, [string]$Version) {
  $manifestPath = Join-Path $Dir 'package\package.json'
  $binaryPath = Join-Path $Dir 'package\bin\guchho.exe'
  if (-not (Test-Path $manifestPath)) {
    Fail 'Unexpected package layout: package/package.json is missing.'
  }
  if (-not (Test-Path $binaryPath)) {
    Fail 'Unexpected package layout: package/bin/guchho.exe is missing.'
  }
  try {
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  }
  catch {
    Fail 'Unexpected package layout: package/package.json is not valid JSON.'
  }
  if ($manifest.name -ne $Package) {
    Fail "Package layout mismatch: expected $Package, archive contains '$($manifest.name)'."
  }
  if ("$($manifest.version)" -ne $Version) {
    Fail "Package layout mismatch: expected version $Version, archive contains '$($manifest.version)'."
  }
  return $binaryPath
}

# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------

function Test-GuchhoBinary([string]$Binary, [string]$ExpectedVersion) {
  # Returns $true/$false without exiting so activation can roll back;
  # diagnostics go to the warning stream.
  if (-not (Test-Path $Binary)) {
    Write-Warning "Verification failed: $Binary does not exist."
    return $false
  }
  $status = 0
  $output = ''
  $previousEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = (& $Binary --version 2>&1 | Out-String)
    if ($LASTEXITCODE) { $status = $LASTEXITCODE }
  }
  catch {
    $ErrorActionPreference = $previousEap
    Write-Warning "The executable could not run: $($_.Exception.Message)"
    return $false
  }
  $ErrorActionPreference = $previousEap
  if ($status -ne 0) {
    Write-Warning "The executable could not run (exit code $status).`nCommand: $Binary --version`nOutput: $output"
    return $false
  }
  if ($output -notlike "*$ExpectedVersion*") {
    Write-Warning "Unexpected version reported by '$Binary --version'. Expected to find: $ExpectedVersion`nOutput: $output"
    return $false
  }
  return $true
}

# ---------------------------------------------------------------------------
# Installation
# ---------------------------------------------------------------------------

function Install-Guchho {
  if ($Help) {
    Show-Usage
    return
  }

  Assert-Registry $GuchhoRegistry
  if ($Version) { Assert-VersionParam $Version }

  Write-Step 'Detecting platform...'
  $package = Resolve-PlatformPackage
  Write-Host "Platform package: $package"

  Write-Step 'Resolving version...'
  $meta = Resolve-VersionMetadata $package $Version
  Write-Host "Resolved: $($meta.Name)@$($meta.Version)" -ForegroundColor White
  Write-Host $meta.Tarball

  $existingBinary = Join-Path $InstallDir 'bin\guchho.exe'
  if ((Test-Path $existingBinary) -and (-not $Force)) {
    if (Test-GuchhoBinary $existingBinary $meta.Version) {
      Write-Host "guchho $($meta.Version) is already installed at $existingBinary. Use -Force to reinstall."
      return
    }
  }

  $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("guchho-install-" + [System.IO.Path]::GetRandomFileName())
  New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
  try {
    $archive = Join-Path $tempDir 'package.tgz'
    $extractDir = Join-Path $tempDir 'ex'
    New-Item -ItemType Directory -Path $extractDir -Force | Out-Null

    Write-Step 'Downloading...'
    Get-File $meta.Tarball $archive

    Write-Step 'Verifying integrity...'
    Test-ArchiveIntegrity $archive $meta.Integrity $meta.Shasum
    Write-Ok 'Integrity verified.'

    Write-Step 'Extracting...'
    $tar = Get-TarPath
    Test-ArchiveEntries $tar $archive
    Expand-ArchiveSafely $tar $archive $extractDir
    Assert-PackageLayout $extractDir $meta.Name $meta.Version | Out-Null

    $stagingDir = Join-Path $InstallDir ('.staging-' + [System.IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null
    try {
      $stagedBinDir = Join-Path $stagingDir 'bin'
      New-Item -ItemType Directory -Path $stagedBinDir -Force | Out-Null
      Copy-Item (Join-Path $extractDir 'package\bin\*') -Destination $stagedBinDir -Force
      $stagedBinary = Join-Path $stagedBinDir 'guchho.exe'

      Write-Step 'Verifying executable...'
      if (-not (Test-GuchhoBinary $stagedBinary $meta.Version)) {
        Fail 'The downloaded executable failed verification and will not be installed.'
      }
      Write-Ok 'Executable verified.'

      Write-Step 'Installing...'
      $binDir = Join-Path $InstallDir 'bin'
      $finalBinary = Join-Path $binDir 'guchho.exe'
      New-Item -ItemType Directory -Path $binDir -Force | Out-Null

      $backup = $null
      if (Test-Path $finalBinary) {
        $backup = "$finalBinary.previous"
        if (Test-Path $backup) { Remove-Item $backup -Force }
        try {
          Move-Item $finalBinary $backup -Force
        }
        catch {
          Fail "Cannot replace the existing installation at $finalBinary (the file may be in use by a running guchho process).`nClose any guchho processes and re-run this script. $($_.Exception.Message)"
        }
      }

      $activated = $false
      try {
        Get-ChildItem $stagedBinDir | Move-Item -Destination $binDir -Force -ErrorAction Stop
        $activated = $true
      }
      catch {
        if ($backup -and (Test-Path $backup)) {
          Move-Item $backup $finalBinary -Force -ErrorAction SilentlyContinue
          Fail "Could not activate the new installation; the previous installation was restored. $($_.Exception.Message)"
        }
        Fail "Could not activate the new installation. $($_.Exception.Message)"
      }

      if (-not (Test-GuchhoBinary $finalBinary $meta.Version)) {
        if ($backup -and (Test-Path $backup)) {
          Get-ChildItem $binDir -File | Where-Object { $_.FullName -like '*guchho*' -or $_.Name -like '*.dll' } |
            Remove-Item -Force -ErrorAction SilentlyContinue
          Move-Item $backup $finalBinary -Force -ErrorAction SilentlyContinue
          Fail 'Activation verification failed; the previous installation was restored.'
        }
        Fail 'Activation verification failed and no previous installation could be restored.'
      }
      if ($backup) { Remove-Item $backup -Force -ErrorAction SilentlyContinue }
    }
    finally {
      if (Test-Path $stagingDir) {
        Remove-Item $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
      }
    }
  }
  finally {
    if (Test-Path $tempDir) {
      Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }

  if (-not (Test-GuchhoBinary (Join-Path $InstallDir 'bin\guchho.exe') $meta.Version)) {
    Fail 'Post-installation verification failed.'
  }

  Update-UserPath (Join-Path $InstallDir 'bin')
  Report-CommandConflicts (Join-Path $InstallDir 'bin')

  Write-Ok "guchho $($meta.Version) installed successfully."
  Write-Host "Location: $(Join-Path $InstallDir 'bin\guchho.exe')"
  Write-Host "Open a new terminal (or sign out and back in) so PATH changes take effect, then run 'guchho --version'."
}

# ---------------------------------------------------------------------------
# PATH management
# ---------------------------------------------------------------------------

function Update-UserPath([string]$BinDir) {
  $normalized = $BinDir.TrimEnd('\')

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $entries = @()
  if ($userPath) { $entries = $userPath -split ';' | Where-Object { $_ } }

  $present = $false
  foreach ($entry in $entries) {
    if ($entry.TrimEnd('\') -ieq $normalized) { $present = $true; break }
  }

  if ($present) {
    Write-Host "$normalized is already on your user PATH."
  }
  elseif ($NoPathUpdate) {
    Write-Warning 'Skipped PATH update (-NoPathUpdate). Add this directory to your user PATH manually:'
    Write-Host "  $normalized"
  }
  else {
    $newPath = ($entries + $normalized) -join ';'
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    $env:Path = "$env:Path;$normalized"
    Write-Host "Added $normalized to your user PATH."
    Write-Warning 'Open a new terminal (or sign out and back in) for the PATH change to take effect.'
  }
}

function Report-CommandConflicts([string]$BinDir) {
  $command = Get-Command guchho -ErrorAction SilentlyContinue
  if ($command -and $command.Source -and ($command.Source -ine (Join-Path $BinDir 'guchho.exe'))) {
    Write-Warning "'guchho' already resolves to $($command.Source), which takes precedence over the new installation."
    Write-Warning "Remove or rename that file, or ensure $BinDir comes first on your PATH."
  }
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if ($MyInvocation.InvocationName -ne '.') {
  Install-Guchho
}
