
param(
    # Where Emscripten lives. Defaults to $env:UNONE_EMSDK_ROOT, then $env:EMSDK.
    [string]$EmsdkRoot = $(if ($env:UNONE_EMSDK_ROOT) { $env:UNONE_EMSDK_ROOT } elseif ($env:EMSDK) { $env:EMSDK } else { '' })
)

$ErrorActionPreference = 'Stop'

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
$env:RUSTFLAGS = '-C link-arg=--export=unone_web_init -C link-arg=--export=unone_web_alloc -C link-arg=--export=unone_web_bundle_begin -C link-arg=--export=unone_web_bundle_write -C link-arg=--export=unone_web_bundle_finish -C link-arg=--export=unone_web_load_project -C link-arg=--export=unone_web_set_save_payload -C link-arg=--export=unone_web_reload_script -C link-arg=--export=unone_web_set_pointer -C link-arg=--export=unone_web_set_input_frame -C link-arg=--export=unone_web_set_viewport_aspect -C link-arg=--export=unone_web_set_screen_pointer -C link-arg=--export=unone_web_tick -C link-arg=--export=unone_web_observation_ptr -C link-arg=--export=unone_web_observation_len'

cargo build --quiet -p unone-web-live-smoke --target wasm32-unknown-emscripten
if ($LASTEXITCODE -ne 0) {
    throw 'Web live bridge build failed; no usable artifact was produced'
}
Write-Output 'built Web live bridge: target/wasm32-unknown-emscripten/debug/deps/unone_web_live_smoke.js'
