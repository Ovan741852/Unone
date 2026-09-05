param(
    [Parameter(Mandatory = $true)]
    [string]$PackagePath
)

$ErrorActionPreference = "Stop"
$packageRoot = [IO.Path]::GetFullPath($PackagePath)
$manifestPath = Join-Path $packageRoot "package-manifest.json"
if (-not (Test-Path -LiteralPath $packageRoot -PathType Container)) {
    throw "Package directory not found: $packageRoot"
}
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Package manifest not found: $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$listed = @{}
foreach ($entry in @($manifest.files)) {
    $relative = ([string]$entry.path).Replace("/", "\")
    if ([string]::IsNullOrWhiteSpace($relative) -or $listed.ContainsKey($relative)) {
        throw "Package manifest contains an empty or duplicate path: $relative"
    }
    $fullPath = [IO.Path]::GetFullPath((Join-Path $packageRoot $relative))
    $rootPrefix = $packageRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $fullPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Package manifest path escapes package root: $relative"
    }
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        throw "Package file is missing: $relative"
    }
    $file = Get-Item -LiteralPath $fullPath
    if ([int64]$entry.size_bytes -ne $file.Length) {
        throw "Package file size mismatch: $relative"
    }
    $actualHash = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne ([string]$entry.sha256).ToLowerInvariant()) {
        throw "Package file hash mismatch: $relative"
    }
    $listed[$relative] = $true
}

$actualFiles = Get-ChildItem -LiteralPath $packageRoot -File -Recurse |
    Where-Object { $_.FullName -ne $manifestPath }
foreach ($file in $actualFiles) {
    $relative = $file.FullName.Substring($packageRoot.Length + 1)
    if (-not $listed.ContainsKey($relative)) {
        throw "Package contains an unlisted file: $relative"
    }
}

# The package ships two engine builds: the native CLI and the Web wasm host. A
# package whose wasm is older than its CLI makes `game verify` a false green:
# every gate passes natively while the Web host rejects a contract the CLI
# accepts. Check that both binaries carry the same UI placement vocabulary
# rather than trusting that whoever packaged it rebuilt everything.
$cliBinary = Join-Path $packageRoot "bin\\game.exe"
$wasmBinary = Join-Path $packageRoot "web\\runtime\\unone_web_live_smoke.wasm"
if ((Test-Path -LiteralPath $cliBinary) -and (Test-Path -LiteralPath $wasmBinary)) {
    $encoding = [Text.Encoding]::ASCII
    $cliText = $encoding.GetString([IO.File]::ReadAllBytes($cliBinary))
    $wasmText = $encoding.GetString([IO.File]::ReadAllBytes($wasmBinary))
    foreach ($marker in @("top_left", "bottom_right", "view_height")) {
        if ($cliText.Contains($marker) -and -not $wasmText.Contains($marker)) {
            throw "Engine build mismatch: bin/game.exe knows '$marker' but web/runtime/unone_web_live_smoke.wasm does not. Rebuild the Web host with scripts/build-web-live.ps1 before packaging."
        }
    }
    Write-Output "CLI and Web host agree on the UI placement contract"
}

Write-Output "AI engine package verified: $packageRoot"
