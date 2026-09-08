
param(
    # Where Emscripten lives. Defaults to $env:UNONE_EMSDK_ROOT, then $env:EMSDK.
    [switch]$Player,
    [switch]$Development,
    [string]$BinaryenRoot = $env:UNONE_BINARYEN_ROOT,
    [string]$EmsdkRoot = $(if ($env:UNONE_EMSDK_ROOT) { $env:UNONE_EMSDK_ROOT } elseif ($env:EMSDK) { $env:EMSDK } else { '' })
)

$ErrorActionPreference = 'Stop'
if ($Development -and -not $Player) { throw '-Development requires -Player' }
$parityNode = if ($Player) { (Get-Command node -ErrorAction Stop).Source } else { $null }

# The SDK path belongs to the machine, not to this repository. It used to be one
# hardcoded Unity install path, so on any other machine this script set bogus
# environment variables and the failure surfaced as a confusing linker error
# rather than "you do not have Emscripten".
if (-not $EmsdkRoot) {
    # One known local layout, used only when it actually exists.
    $unityEmscripten = 'C:\Program Files\Unity\Hub\Editor\6000.0.47f1\Editor\Data\PlaybackEngines\WebGLSupport\BuildTools\Emscripten'
    if (Test-Path -LiteralPath $unityEmscripten -PathType Container) {
        $EmsdkRoot = $unityEmscripten
    }
}
if (-not $EmsdkRoot) {
    throw @'
Emscripten not found. The Web runtime needs it; native development does not.

Set one of these to your emsdk (or Unity WebGL BuildTools) directory and re-run:
  $env:UNONE_EMSDK_ROOT = 'D:/path/to/emsdk'
  $env:EMSDK            = 'D:/path/to/emsdk'
or pass it directly:
  powershell -File scripts/build-web-live.ps1 -EmsdkRoot D:/path/to/emsdk

Setup and the verified Emscripten version are in docs/platform-toolchain.md.
'@
}
if (-not (Test-Path -LiteralPath $EmsdkRoot -PathType Container)) {
    throw "Emscripten root does not exist: $EmsdkRoot. See docs/platform-toolchain.md."
}

$emsdkRoot = [IO.Path]::GetFullPath($EmsdkRoot)
$emscriptenRoot = Join-Path $emsdkRoot 'emscripten'
if (-not (Test-Path -LiteralPath (Join-Path $emscriptenRoot 'emcc.bat') -PathType Leaf)) {
    throw "No emcc.bat under $emscriptenRoot. That does not look like an Emscripten install; see docs/platform-toolchain.md."
}
$env:EMSDK = $emsdkRoot
$env:EM_CONFIG = Join-Path $emsdkRoot '.emscripten'
$env:EMSDK_PYTHON = Join-Path $emsdkRoot 'python\python.exe'
$env:PATH = "$emscriptenRoot;$emsdkRoot\node;$emsdkRoot\python;$emsdkRoot\binaryen;$env:PATH"
$env:CC_wasm32_unknown_emscripten = Join-Path $emscriptenRoot 'emcc.bat'
$env:CXX_wasm32_unknown_emscripten = Join-Path $emscriptenRoot 'em++.bat'
$env:AR_wasm32_unknown_emscripten = Join-Path $emscriptenRoot 'emar.bat'
$env:CXXFLAGS_wasm32_unknown_emscripten = '-fwasm-exceptions'
$env:RUSTFLAGS = '-C link-arg=--export=unone_web_init -C link-arg=--export=unone_web_alloc -C link-arg=--export=unone_web_bundle_begin -C link-arg=--export=unone_web_bundle_write -C link-arg=--export=unone_web_bundle_finish -C link-arg=--export=unone_web_load_project -C link-arg=--export=unone_web_set_save_payload -C link-arg=--export=unone_web_reload_script -C link-arg=--export=unone_web_set_pointer -C link-arg=--export=unone_web_set_input_frame -C link-arg=--export=unone_web_set_viewport_aspect -C link-arg=--export=unone_web_set_screen_pointer -C link-arg=--export=unone_web_tick -C link-arg=--export=unone_web_observation_ptr -C link-arg=--export=unone_web_observation_len -C link-arg=--export=unone_web_developer_request'

if ($Player) {
    $repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    if (-not $BinaryenRoot) {
        $candidate = Join-Path $repoRoot '.toolcache/binaryen-version_131'
        if (Test-Path (Join-Path $candidate 'bin/wasm-opt.exe')) { $BinaryenRoot = $candidate }
    }
    if ($BinaryenRoot) { $env:EM_BINARYEN_ROOT = [IO.Path]::GetFullPath($BinaryenRoot) }
    $exports = @('init','alloc','load_project','set_save_payload','set_input_frame','set_viewport_aspect','tick','observation_ptr','observation_len')
    if ($Development) { $exports += 'developer_request' }
    $featureArgs = if ($Development) { @('--features','preview-tools') } else { @() }
    $env:RUSTFLAGS = (($exports | ForEach-Object { "-C link-arg=--export=unone_web_$_" }) -join ' ') + ' -C link-arg=-sENVIRONMENT=web -C link-arg=-sALLOW_MEMORY_GROWTH=1 -C link-arg=-sASSERTIONS=1'
    cargo build --manifest-path (Join-Path $repoRoot 'crates/unone-player/Cargo.toml') --target-dir (Join-Path $repoRoot 'target/player') --release --target wasm32-unknown-emscripten @featureArgs
    if ($LASTEXITCODE -ne 0) { throw 'Player release build failed; no debug fallback is allowed.' }
    $releaseRoot = Join-Path $repoRoot 'target/player/wasm32-unknown-emscripten/release'
    $wasm = Get-ChildItem -LiteralPath $releaseRoot -Filter '*.wasm' | Select-Object -First 1
    $javascript = Get-ChildItem -LiteralPath $releaseRoot -Filter '*.js' | Select-Object -First 1
    if (-not $wasm -or -not $javascript) { throw 'Release output missing.' }
    $outputRoot = Join-Path $repoRoot $(if ($Development) { 'artifacts/player-development-runtime' } else { 'artifacts/player-runtime' })
    New-Item -ItemType Directory -Force $outputRoot | Out-Null
    Copy-Item -LiteralPath $wasm.FullName -Destination $outputRoot -Force
    Copy-Item -LiteralPath $javascript.FullName -Destination $outputRoot -Force
    $report = @{ profile='release'; dev_tools=$false; preview_tools=[bool]$Development; javascript=$javascript.Name; wasm=$wasm.Name;
        wasm_bytes=$wasm.Length; wasm_sha256=(Get-FileHash $wasm.FullName -Algorithm SHA256).Hash.ToLowerInvariant();
        javascript_sha256=(Get-FileHash $javascript.FullName -Algorithm SHA256).Hash.ToLowerInvariant();
        exports=$exports; source_commit=(git -C $repoRoot rev-parse HEAD); source_dirty=[bool](git -C $repoRoot status --porcelain) }
    [IO.File]::WriteAllText((Join-Path $outputRoot 'runtime.json'), ($report | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
    # Run the actual export gate with Node selected before the SDK changed PATH.
    [string[]]$parityArgs = if ($Development) { @('--development') } else { @() }
    & $parityNode (Join-Path $repoRoot 'scripts/verify-player-parity.mjs') --runtime $outputRoot @parityArgs
    if ($LASTEXITCODE -ne 0) { throw 'Player artifact parity failed. Build the current native CLI with cargo build -p unone-cli, fix any mismatch, then rerun this player build.' }
    Write-Output ($report | ConvertTo-Json -Depth 6)
} else {
    cargo build --quiet -p unone-web-live-smoke --target wasm32-unknown-emscripten
    if ($LASTEXITCODE -ne 0) { throw 'Web live bridge build failed; no usable artifact was produced' }
    Write-Output 'built Web live bridge: target/wasm32-unknown-emscripten/debug/deps/unone_web_live_smoke.js'
}
