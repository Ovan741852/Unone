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
$UnoneHostNode = (Get-Command node -ErrorAction Stop).Source
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
& $UnoneHostNode --experimental-wasm-exnref target/wasm32-unknown-emscripten/debug/deps/unone_web_smoke.js
```

目前 host Node 需要 `--experimental-wasm-exnref` 才能載入這個 Emscripten exception section；要在修改 `PATH` 前先記住 host Node，避免誤執行 Emscripten SDK 內不支援該 flag 的舊 Node。成功時會印出 `unone_web_smoke completed: sha256:...`；這證明 memory-backed Luau runtime 已完成 link 並執行 60 frames，但仍不是瀏覽器 WebGPU page。

## Browser runtime smoke

完成 build 後，在 repo root 啟動靜態 server：

```powershell
python -m http.server 8000
```

開啟 `http://127.0.0.1:8000/web/smoke/`。`web/smoke/index.html` 會載入同一份 Emscripten `.js + .wasm`，頁面顯示 `passed: 60 deterministic frames executed` 才算 browser runtime smoke 通過。這仍不是 WebGPU renderer、瀏覽器輸入或正式遊戲 host。

## Mobile host 盤點

目前 engine core 不依賴 UIKit、Android View 或 JNI；mobile host 應沿用 `EngineRuntime::tick_with_input`，由平台 adapter 負責 lifecycle、surface、safe area、touch、storage 與 package/update policy。這台 Windows 已用 Android NDK `27.1.12297006` 成功 cross-check `unone-engine` 的 `aarch64-linux-android` 與 `x86_64-linux-android`，但沒有 Gradle，`adb` 也沒有 connected device；沒有 Apple `xcodebuild`，所以 iOS/Android host package 或 lifecycle smoke 尚未完成。完整責任邊界與驗收項目見 `docs/decisions/0017-mobile-host-lifecycle-boundary.md`，盤點細節見 `docs/issues/2026-09-05-mobile-host-toolchain-audit.md`。

## 尚未完成

- CI 尚未固定下載 Emscripten SDK 的來源與 checksum。
- `unone-web-smoke` 與 `web/smoke/index.html` 已驗證 Emscripten memory-source runtime；`web/live/index.html` 另已驗證窄 C ABI、WebGPU live loop、browser input、bundle verifier、IndexedDB generation/cache 與 script hot update。兩者都不是完整 Web 發布頁面。
- 大型 asset 的 OPFS/chunked storage writer、CDN policy、背景下載、production error transport 與 mobile host 尚未完成。
- 這裡的 `cargo check`／smoke artifact 不等於完整 Web 發布包。
