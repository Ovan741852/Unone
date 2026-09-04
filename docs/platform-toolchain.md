# Platform toolchain

這份文件只記錄目前已驗證的建置邊界，不把某台機器上的 SDK 路徑假裝成產品設定。

## Native

`rust-toolchain.toml` 固定 Rust channel 與目前需要的 Web targets。一般 native 開發直接執行：

```powershell
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

## Web library compile

目前已在 Windows 以 Emscripten 3.1.39 wrapper 驗證 vendored Luau 能編譯。SDK 路徑應由開發機或 CI 注入，不寫入 Cargo config：

```powershell
$UnoneEmsdkRoot = 'D:/path/to/emsdk'
$UnoneEmscriptenRoot = Join-Path $UnoneEmsdkRoot 'emscripten'
$env:EMSDK = $UnoneEmsdkRoot
$env:EM_CONFIG = Join-Path $UnoneEmsdkRoot '.emscripten'
$env:EMSDK_PYTHON = Join-Path $UnoneEmsdkRoot 'python/python.exe'
$env:PATH = "$UnoneEmscriptenRoot;$UnoneEmsdkRoot/node;$UnoneEmsdkRoot/python;$UnoneEmsdkRoot/binaryen;$env:PATH"
$env:CC_wasm32_unknown_emscripten = Join-Path $UnoneEmscriptenRoot 'emcc.bat'
$env:CXX_wasm32_unknown_emscripten = Join-Path $UnoneEmscriptenRoot 'em++.bat'
$env:AR_wasm32_unknown_emscripten = Join-Path $UnoneEmscriptenRoot 'emar.bat'
$env:CXXFLAGS_wasm32_unknown_emscripten = '-fwasm-exceptions'
cargo check -p unone-engine --target wasm32-unknown-emscripten
cargo build -p unone-web-smoke --target wasm32-unknown-emscripten
```

必須使用 `wasm32-unknown-emscripten`。`wasm32-unknown-unknown` 會讓 Cargo 將 C++ compile target 傳給 wrapper，覆蓋 Emscripten 的 sysroot/thread 設定；只換 clang++ 不足以修正它。

`CXXFLAGS_wasm32_unknown_emscripten=-fwasm-exceptions` 用來讓 vendored Luau C++ objects 與 Rust Emscripten target 的 exception model 一致。若之前用另一組 exception flags 編過 `mlua-sys`，先清掉該 target 的 `mlua-sys` build artifacts，再重建：

```powershell
cargo clean -p mlua-sys --target wasm32-unknown-emscripten
```

目前 smoke artifact 可由 Node 執行（`.js` 與同目錄 `.wasm` 必須一起存在）：

```powershell
node target/wasm32-unknown-emscripten/debug/deps/unone_web_smoke.js
```

成功時會印出 `unone_web_smoke completed: sha256:...`；這證明 memory-backed Luau runtime 已完成 link 並執行 60 frames，但仍不是瀏覽器 WebGPU page。

## 尚未完成

- CI 尚未固定下載 Emscripten SDK 的來源與 checksum。
- `unone-web-smoke` 先驗證 Emscripten 可連結記憶體 source runtime；尚未完成瀏覽器 WebGPU host、browser input 與可操作的 Web smoke page。
- 這裡的 `cargo check`／smoke artifact 不等於完整 Web 發布包。
