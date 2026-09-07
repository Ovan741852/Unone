param(
    [string]$OutputPath = (Join-Path $PSScriptRoot "..\artifacts\unone-engine-package")
)

$ErrorActionPreference = "Stop"
$engineRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$outputRoot = [IO.Path]::GetFullPath($OutputPath)
$cliPath = Join-Path $engineRoot "target\debug\game.exe"
$analyzerPath = Join-Path $engineRoot ".toolcache\luau-0.734\luau-analyze.exe"
$webBuildRoot = Join-Path $engineRoot "target\wasm32-unknown-emscripten\debug\deps"

if (-not (Test-Path -LiteralPath $cliPath -PathType Leaf)) {
    throw "Missing $cliPath. Run cargo build -p unone-cli first."
}
if (-not (Test-Path -LiteralPath $analyzerPath -PathType Leaf)) {
    throw "Missing $analyzerPath. Install/build the pinned official luau-analyze before packaging."
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
Copy-PackageFile $analyzerPath "bin\luau-analyze.exe"
Copy-PackageFile (Join-Path $engineRoot "docs\ai-agent-game-handoff.md") "docs\ai-agent-game-handoff.md"
Copy-PackageFile (Join-Path $engineRoot "docs\ai-workflow.md") "docs\ai-workflow.md"
Copy-PackageFile (Join-Path $engineRoot "docs\plugin-protocol.md") "docs\plugin-protocol.md"
Copy-PackageFile (Join-Path $engineRoot "docs\asset-workflow.md") "docs\asset-workflow.md"
& $cliPath api typings --output (Join-Path $outputRoot "docs\engine.d.luau") | Out-Null
if ($LASTEXITCODE -ne 0) { throw "game api typings failed while packaging the Luau type contract" }
Copy-PackageFile (Join-Path $engineRoot "docs\project.schema.json") "docs\project.schema.json"
Copy-PackageFile (Join-Path $engineRoot "docs\scene.schema.json") "docs\scene.schema.json"
Copy-PackageFile (Join-Path $engineRoot "docs\test.schema.json") "docs\test.schema.json"
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
    "0025-asset-gate-and-ai-subagent-handoff.md",
    "0027-declared-engine-systems.md",
    "0028-semantic-presentation-systems.md",
    "0029-text-layout-gate.md",
    "0030-anchored-ui-placement.md",
    "0031-camera-view-extent.md",
    "0032-frame-cost-observation.md",
    "0033-replay-diff.md",
    "0034-independent-2d-colliders.md"
)) {
    Copy-PackageFile (Join-Path $engineRoot "docs\decisions\$decision") "docs\decisions\$decision"
}
foreach ($webFile in @(
    "web\runner\main.js",
    "web\runner\index.html",
    "web\runner\save-store.js",
    "web\shared\webgpu-snapshot.js",
    "web\live\bundle-store.js",
    # The presentation host is the only one that plays Spine, Effekseer and
    # audio. Without it a packaged agent can enable those systems and never
    # see or hear the result, which reads as "the engine does nothing".
    "web\presentation\main.js",
    "web\presentation\index.html",
    "web\presentation\README.md",
    "web\vendor\README.md",
    "web\vendor\spine\spine-webgl.js",
    "web\vendor\spine\LICENSE",
    "web\vendor\effekseer\effekseer.js",
    "web\vendor\effekseer\effekseer.wasm",
    "web\vendor\effekseer\LICENSE"
)) {
    Copy-PackageFile (Join-Path $engineRoot $webFile) $webFile
}
# Keep each host's transitive renderer and shared imports in the package.
foreach ($directory in @('web/shared','web/renderer','web/vendor/three','tests/host-parity-project')) {
    foreach ($file in Get-ChildItem -LiteralPath (Join-Path $engineRoot $directory) -File -Recurse) {
        Copy-PackageFile $file.FullName $file.FullName.Substring($engineRoot.Length + 1)
    }
}
Copy-PackageFile (Join-Path $engineRoot 'scripts/verify-host-parity.mjs') 'scripts/verify-host-parity.mjs'
Copy-PackageFile (Join-Path $webBuildRoot "unone_web_live_smoke.js") "web\runtime\unone_web_live_smoke.js"
Copy-PackageFile (Join-Path $webBuildRoot "unone_web_live_smoke.wasm") "web\runtime\unone_web_live_smoke.wasm"
Copy-PackageFile (Join-Path $engineRoot "scripts\verify-ai-engine-package.ps1") "scripts\verify-ai-engine-package.ps1"
Copy-PackageFile (Join-Path $engineRoot "scripts\plugin-smoke.ps1") "scripts\plugin-smoke.ps1"
foreach ($pluginFile in @(
    "plugins\org.unone.blender\plugin.json",
    "plugins\org.unone.blender\plugin.mjs",
    "plugins\org.unone.blender\README.md"
)) {
    Copy-PackageFile (Join-Path $engineRoot $pluginFile) $pluginFile
}

$utf8 = New-Object System.Text.UTF8Encoding($false)
# Both hosts load the runtime from the repo build directory in place; in a
# package it lives beside them.
foreach ($hostIndex in @("web\runner\index.html", "web\presentation\index.html")) {
    $indexPath = Join-Path $outputRoot $hostIndex
    $index = [IO.File]::ReadAllText($indexPath)
    $index = $index.Replace("../../target/wasm32-unknown-emscripten/debug/deps/unone_web_live_smoke.js", "../runtime/unone_web_live_smoke.js")
    [IO.File]::WriteAllText($indexPath, $index, $utf8)
}

$readme = @"
# Unone AI engine package

Use this package with exactly one game plan. The game package is the only
runtime/tool input a game subagent should need. Read docs/ai-agent-game-handoff.md
before writing game code.

Native command: bin/game.exe
Luau analyzer: bin/luau-analyze.exe (game check --types finds it automatically)
Optional AI plugins: docs/plugin-protocol.md and plugins/
Web runner: web/runner/index.html
Presentation host: web/presentation/index.html (Spine, Effekseer and audio;
the generic runner draws none of those)

This is a Web-first package. Android package binaries and Android smoke
scripts are intentionally not included; Android packaging is a later host task.
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

& (Join-Path $outputRoot "scripts\verify-ai-engine-package.ps1") -PackagePath $outputRoot
foreach ($file in Get-ChildItem -LiteralPath $outputRoot -File -Recurse) {
    $file.IsReadOnly = $true
}

Write-Output "created immutable AI engine package: $outputRoot"
