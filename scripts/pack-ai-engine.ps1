param(
    [string]$OutputPath = (Join-Path $PSScriptRoot "..\artifacts\unone-engine-package")
)

$ErrorActionPreference = "Stop"
$engineRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$outputRoot = [IO.Path]::GetFullPath($OutputPath)
$cliPath = Join-Path $engineRoot "target\debug\game.exe"
$webBuildRoot = Join-Path $engineRoot "target\wasm32-unknown-emscripten\debug\deps"

if (-not (Test-Path -LiteralPath $cliPath -PathType Leaf)) {
    throw "Missing $cliPath. Run cargo build -p unone-cli first."
}
foreach ($path in @(
    (Join-Path $webBuildRoot "unone_web_live_smoke.js"),
    (Join-Path $webBuildRoot "unone_web_live_smoke.wasm")
)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Missing $path. Run scripts/build-web-live.ps1 first."
    }
}
if (Test-Path -LiteralPath $outputRoot) {
    throw "Output already exists: $outputRoot. Choose a new path so package inputs remain immutable."
}

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$fileRecords = [Collections.Generic.List[object]]::new()

function Copy-PackageFile {
    param(
        [string]$Source,
        [string]$RelativeDestination
    )
    $destination = Join-Path $outputRoot $RelativeDestination
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $Source -Destination $destination
}

Copy-PackageFile $cliPath "bin\game.exe"
Copy-PackageFile (Join-Path $engineRoot "docs\ai-agent-game-handoff.md") "docs\ai-agent-game-handoff.md"
Copy-PackageFile (Join-Path $engineRoot "docs\ai-workflow.md") "docs\ai-workflow.md"
Copy-PackageFile (Join-Path $engineRoot "docs\engine.d.luau") "docs\engine.d.luau"
Copy-PackageFile (Join-Path $engineRoot "docs\mobile-host-abi.md") "docs\mobile-host-abi.md"
Copy-PackageFile (Join-Path $engineRoot "docs\platform-toolchain.md") "docs\platform-toolchain.md"
Copy-PackageFile (Join-Path $engineRoot "docs\review-process.md") "docs\review-process.md"
foreach ($decision in @(
    "0010-bundle-fetch-boundary.md",
    "0016-bundle-generation-and-browser-storage.md",
    "0017-mobile-host-lifecycle-boundary.md",
    "0019-semantic-observation-mvvm-boundary.md",
    "0020-minimal-save-boundary.md",
    "0021-minimal-ui-tree-boundary.md",
    "0022-minimal-3d-world-boundary.md",
    "0023-generic-web-game-host-boundary.md",
    "0024-minimal-asset-reference-contract.md"
)) {
    Copy-PackageFile (Join-Path $engineRoot "docs\decisions\$decision") "docs\decisions\$decision"
}
foreach ($webFile in @(
    "web\runner\main.js",
    "web\runner\index.html",
    "web\runner\save-store.js",
    "web\shared\webgpu-snapshot.js",
    "web\live\bundle-store.js"
)) {
    Copy-PackageFile (Join-Path $engineRoot $webFile) $webFile
}
Copy-PackageFile (Join-Path $webBuildRoot "unone_web_live_smoke.js") "web\runtime\unone_web_live_smoke.js"
Copy-PackageFile (Join-Path $webBuildRoot "unone_web_live_smoke.wasm") "web\runtime\unone_web_live_smoke.wasm"

$indexPath = Join-Path $outputRoot "web\runner\index.html"
$index = [IO.File]::ReadAllText($indexPath)
$index = $index.Replace("../../target/wasm32-unknown-emscripten/debug/deps/unone_web_live_smoke.js", "../runtime/unone_web_live_smoke.js")
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($indexPath, $index, $utf8)

$readme = @"
# Unone AI engine package

Use this package with exactly one game plan. The game package is the only
runtime/tool input a game subagent should need. Read docs/ai-agent-game-handoff.md
before writing game code.

Native command: bin/game.exe
Web runner: web/runner/index.html

This package contains no validation-game implementation and no engine source.
"@
[IO.File]::WriteAllText((Join-Path $outputRoot "README.md"), $readme, $utf8)

$commit = (& git -C $engineRoot rev-parse HEAD).Trim()
$dirty = (& git -C $engineRoot status --porcelain)
foreach ($file in Get-ChildItem -LiteralPath $outputRoot -File -Recurse | Sort-Object FullName) {
    $relative = $file.FullName.Substring($outputRoot.Length + 1).Replace("\", "/")
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $fileRecords.Add([ordered]@{
        path = $relative
        size_bytes = $file.Length
        sha256 = $hash
    })
}
$package = [ordered]@{
    schema_version = 1
    engine = "Unone"
    source_commit = $commit
    source_dirty = [bool]($dirty)
    files = $fileRecords
}
$manifestPath = Join-Path $outputRoot "package-manifest.json"
[IO.File]::WriteAllText($manifestPath, ($package | ConvertTo-Json -Depth 5), $utf8)

Write-Output "created immutable AI engine package: $outputRoot"
