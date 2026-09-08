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

# This package is Web-first. Keep the native authoring CLI and its analyzer,
# but require the complete generic Web runner surface and do not silently carry
# an Android package host into a Web handoff.
$requiredFiles = @(
    "README.md",
    "bin\game.exe",
    "bin\luau-analyze.exe",
    "docs\ai-agent-game-handoff.md",
    "docs\ai-workflow.md",
    "docs\asset-workflow.md",
    "docs\engine.d.luau",
    "docs\project.schema.json",
    "docs\scene.schema.json",
    "docs\test.schema.json",
    "docs\mobile-host-abi.md",
    "docs\platform-toolchain.md",
    "docs\review-process.md",
    "scripts\verify-ai-engine-package.ps1",
    "scripts\profile-player.mjs",
    "scripts\compare-player.mjs",
    "web\runner\index.html",
    "web\runner\main.js",
    "web\runner\save-store.js",
    "web\shared\webgpu-snapshot.js",
    "web\live\bundle-store.js",
    "web\runtime\unone_web_live_smoke.js",
    "web\runtime\unone_web_live_smoke.wasm"
)
foreach ($required in $requiredFiles) {
    if (-not $listed.ContainsKey($required)) {
        throw "Web-first package is missing required file: $required"
    }
}

$forbiddenFiles = @(
    "docs\mobile-package-host.md",
    "scripts\build-android-package.ps1",
    "scripts\run-android-package-smoke.ps1"
)
foreach ($forbidden in $forbiddenFiles) {
    if ($listed.ContainsKey($forbidden)) {
        throw "Web-first package must not include Android package file: $forbidden"
    }
}
foreach ($relative in $listed.Keys) {
    if ($relative.StartsWith("mobile\", [StringComparison]::OrdinalIgnoreCase)) {
        throw "Web-first package must not include mobile host artifacts: $relative"
    }
}

$runnerIndexPath = Join-Path $packageRoot "web\runner\index.html"
$runnerIndex = [IO.File]::ReadAllText($runnerIndexPath)
if (-not $runnerIndex.Contains("../runtime/unone_web_live_smoke.js")) {
    throw "Web runner index does not reference the packaged runtime: web/runner/index.html"
}
if ($runnerIndex.Contains("target/wasm32-unknown-emscripten")) {
    throw "Web runner index still references a repository build path: web/runner/index.html"
}
$runnerMain = [IO.File]::ReadAllText((Join-Path $packageRoot "web\runner\main.js"))
foreach ($helper in @(
    "../shared/webgpu-snapshot.js",
    "../live/bundle-store.js",
    "./save-store.js"
)) {
    if (-not $runnerMain.Contains($helper)) {
        throw "Web runner is missing its packaged helper import: $helper"
    }
}

# Execute the actual packaged CLI and WASM against the same project and inputs.
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is required for behavioral parity. Install Node.js 22+ and rerun this verifier."
}
foreach ($tool in @('profile-player.mjs','compare-player.mjs')) {
    & node --check (Join-Path $packageRoot "scripts/$tool")
    if ($LASTEXITCODE -ne 0) { throw "Invalid packaged profiling tool: $tool" }
}
& node (Join-Path $packageRoot 'scripts/verify-host-parity.mjs') --cli (Join-Path $packageRoot 'bin/game.exe') --wasm (Join-Path $packageRoot 'web/runtime/unone_web_live_smoke.js') --fixture (Join-Path $packageRoot 'tests/host-parity-project')
if ($LASTEXITCODE -ne 0) { throw 'CLI/WASM behavioral parity failed. Rebuild both artifacts and inspect the shared host payload.' }
Write-Output "AI engine package verified: $packageRoot"
