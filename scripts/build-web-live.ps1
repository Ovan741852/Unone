$ErrorActionPreference = 'Stop'

$emsdkRoot = 'C:\Program Files\Unity\Hub\Editor\6000.0.47f1\Editor\Data\PlaybackEngines\WebGLSupport\BuildTools\Emscripten'
$emscriptenRoot = Join-Path $emsdkRoot 'emscripten'
$env:EMSDK = $emsdkRoot
$env:EM_CONFIG = Join-Path $emsdkRoot '.emscripten'
$env:EMSDK_PYTHON = Join-Path $emsdkRoot 'python\python.exe'
$env:PATH = "$emscriptenRoot;$emsdkRoot\node;$emsdkRoot\python;$emsdkRoot\binaryen;$env:PATH"
$env:CC_wasm32_unknown_emscripten = Join-Path $emscriptenRoot 'emcc.bat'
$env:CXX_wasm32_unknown_emscripten = Join-Path $emscriptenRoot 'em++.bat'
$env:AR_wasm32_unknown_emscripten = Join-Path $emscriptenRoot 'emar.bat'
$env:CXXFLAGS_wasm32_unknown_emscripten = '-fwasm-exceptions'
$env:RUSTFLAGS = '-C link-arg=--export=unone_web_init -C link-arg=--export=unone_web_alloc -C link-arg=--export=unone_web_load_project -C link-arg=--export=unone_web_reload_script -C link-arg=--export=unone_web_set_pointer -C link-arg=--export=unone_web_tick -C link-arg=--export=unone_web_observation_ptr -C link-arg=--export=unone_web_observation_len'

cargo build --quiet -p unone-web-live-smoke --target wasm32-unknown-emscripten
if ($LASTEXITCODE -ne 0) {
    throw 'Web live bridge build failed; no usable artifact was produced'
}
Write-Output 'built Web live bridge: target/wasm32-unknown-emscripten/debug/deps/unone_web_live_smoke.js'
