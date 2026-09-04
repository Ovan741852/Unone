# Browser runtime smoke

這個頁面只驗證 memory-backed Luau runtime 能被瀏覽器載入並執行；它不是 WebGPU game host，也不代表 iOS／Android 已完成。

在 `D:/Projects/Unone` 先依 [platform toolchain](../../docs/platform-toolchain.md) 建立 Emscripten artifact：

```powershell
cargo build -p unone-web-smoke --target wasm32-unknown-emscripten
python -m http.server 8000
```

再開啟 `http://127.0.0.1:8000/web/smoke/`。頁面應顯示 `passed: 60 deterministic frames executed`，並在 output 顯示 observation digest。

若 `.js` 載入但 `.wasm` 找不到，確認兩個檔案位於：

```text
target/wasm32-unknown-emscripten/debug/deps/unone_web_smoke.js
target/wasm32-unknown-emscripten/debug/deps/unone_web_smoke.wasm
```
