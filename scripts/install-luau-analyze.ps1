# Fetch the pinned official luau-analyze into .toolcache.
#
# The analyzer is a development-time tool, not part of any game binary (see
# docs/decisions/0005-luau-analyzer-toolchain.md), so it is deliberately not
# committed. But a fresh clone with no analyzer fails `verify`'s types gate, and
# "go and find the right build of luau-analyze yourself" is a judgement call a
# script can make instead: pin the version, verify the bytes, put it where the
# CLI already looks.
#
#   powershell -File scripts/install-luau-analyze.ps1
#
# Both hashes below are of the bytes this repository was validated against. A
# mismatch stops the install rather than typechecking your game with something
# nobody here has run.

param(
    [string]$ToolcachePath = (Join-Path $PSScriptRoot "..\.toolcache"),
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$version = "0.734"
$archiveUrl = "https://github.com/luau-lang/luau/releases/download/$version/luau-windows.zip"
$archiveSha256 = "0f814860c2939f85d2e37bc2e8a8f848012523d1e52c435c6832845fb3fe5dc8"
$analyzerSha256 = "fc28e3a85eccdbdca4974784ffb96134cf2166d5fbd149078cb28cffde88bfee"

if (-not $IsWindows -and $PSVersionTable.PSVersion.Major -ge 6) {
    throw "This script installs the Windows build. On another platform, build or download luau-analyze $version yourself and point UNONE_LUAU_ANALYZER at it."
}

$targetRoot = Join-Path ([IO.Path]::GetFullPath($ToolcachePath)) "luau-$version"
$analyzerPath = Join-Path $targetRoot "luau-analyze.exe"

if ((Test-Path -LiteralPath $analyzerPath -PathType Leaf) -and -not $Force) {
    $existing = (Get-FileHash -LiteralPath $analyzerPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($existing -eq $analyzerSha256) {
        Write-Output "luau-analyze ${version} already installed: $analyzerPath"
        exit 0
    }
    throw "$analyzerPath exists but is not the pinned build (sha256 $existing). Re-run with -Force to replace it."
}

New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
$archivePath = Join-Path $targetRoot "luau-windows.zip"

Write-Output "downloading $archiveUrl"
Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath -UseBasicParsing

$downloadedHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($downloadedHash -ne $archiveSha256) {
    Remove-Item -LiteralPath $archivePath -Force
    throw "downloaded archive sha256 $downloadedHash does not match the pinned $archiveSha256; nothing was installed"
}

Expand-Archive -LiteralPath $archivePath -DestinationPath $targetRoot -Force

if (-not (Test-Path -LiteralPath $analyzerPath -PathType Leaf)) {
    throw "the archive did not contain luau-analyze.exe; nothing was installed"
}
$installedHash = (Get-FileHash -LiteralPath $analyzerPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($installedHash -ne $analyzerSha256) {
    throw "extracted luau-analyze.exe sha256 $installedHash does not match the pinned $analyzerSha256"
}

Write-Output "installed luau-analyze ${version}: $analyzerPath"
Write-Output "game check --types finds it automatically when run from the repository root."
