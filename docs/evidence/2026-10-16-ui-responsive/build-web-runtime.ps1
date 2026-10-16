$ErrorActionPreference = 'Stop'
$engineRoot = 'D:/TSProject/Voidwake/engine'
$buildCli = 'D:/TSProject/Voidwake/game/tools/build/native/release/game.exe'
$emsdkRoot = 'D:/TSProject/Voidwake/game/tools/emsdk'
$buildRoot = 'D:/TSProject/Voidwake/game/tools/build/player'
$outputRoot = Join-Path $engineRoot 'artifacts/ui-responsive/runtime-web'
$systemsRaw = & $buildCli --project (Join-Path $engineRoot '_Games/voidwake') --json systems list
if ($LASTEXITCODE -ne 0) { throw 'systems list failed' }
$systems = ($systemsRaw -join [Environment]::NewLine) | ConvertFrom-Json
$selected = @($systems.value.systems | Where-Object enabled)
$features = @($selected | Where-Object build_feature | ForEach-Object build_feature | Sort-Object -Unique)
$env:EMSDK = $emsdkRoot
$env:EM_CONFIG = Join-Path $emsdkRoot '.emscripten'
$env:EMSDK_PYTHON = Join-Path $emsdkRoot 'python/3.13.3_64bit/python.exe'
$env:PATH = (Join-Path $emsdkRoot 'upstream/emscripten') + ';' + (Join-Path $emsdkRoot 'upstream/bin') + ';' + $env:PATH
$env:CC_wasm32_unknown_emscripten = Join-Path $emsdkRoot 'upstream/emscripten/emcc.bat'
$env:CXX_wasm32_unknown_emscripten = Join-Path $emsdkRoot 'upstream/emscripten/em++.bat'
$env:AR_wasm32_unknown_emscripten = Join-Path $emsdkRoot 'upstream/emscripten/emar.bat'
$env:CXXFLAGS_wasm32_unknown_emscripten = '-fwasm-exceptions'
$env:EM_BINARYEN_ROOT = 'D:/TSProject/Voidwake/game/tools/build/binaryen-version_131'
$exports = @('init','alloc','load_project','set_save_payload','set_input_frame','set_viewport_aspect','set_instance_transport','tick','jobs_request','jobs_binary','ui_request','observation_ptr','observation_len')
$env:RUSTFLAGS = (($exports | ForEach-Object { '-C link-arg=--export=unone_web_' + $_ }) -join ' ') + ' -C link-arg=-sENVIRONMENT=web -C link-arg=-sALLOW_MEMORY_GROWTH=1 -C link-arg=-sASSERTIONS=1'
& $env:CC_wasm32_unknown_emscripten --version
if ($LASTEXITCODE -ne 0) { throw 'emcc version failed' }
& cargo +1.95.0 build --manifest-path (Join-Path $engineRoot 'crates/unone-player/Cargo.toml') --target-dir $buildRoot --release --target wasm32-unknown-emscripten --no-default-features --features ($features -join ',')
if ($LASTEXITCODE -ne 0) { throw 'Production WASM build failed' }
$release = Join-Path $buildRoot 'wasm32-unknown-emscripten/release'
$js = Get-Item (Join-Path $release 'unone-player.js')
$wasm = Get-Item (Join-Path $release 'unone_player.wasm')
New-Item -ItemType Directory -Force $outputRoot | Out-Null
Copy-Item -LiteralPath $js.FullName,$wasm.FullName -Destination $outputRoot
$package = Get-Content (Join-Path $engineRoot 'packages/unone-ui/package.unone.json') -Raw -Encoding utf8 | ConvertFrom-Json
$descriptor = @{
 profile='release';dev_tools=$false;preview_tools=$false
 javascript=$js.Name;wasm=$wasm.Name;wasm_bytes=$wasm.Length
 javascript_sha256=(Get-FileHash -LiteralPath $js.FullName).Hash.ToLowerInvariant()
 wasm_sha256=(Get-FileHash -LiteralPath $wasm.FullName).Hash.ToLowerInvariant()
 runtime_packages=@{'@unone/ui'=$package.version}
 compiled_systems=@($selected | ForEach-Object id | Sort-Object)
 cargo_features=$features;exports=$exports
 source_commit=(& git -C $engineRoot rev-parse HEAD).Trim();source_dirty=$true
 rust='1.95.0';emscripten='3.1.74'
}
[IO.File]::WriteAllText((Join-Path $outputRoot 'runtime.json'),($descriptor | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
Write-Output ($descriptor | ConvertTo-Json -Depth 8)
