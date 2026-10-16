# Browser runtime smoke

這個頁面只驗證 memory-backed Luau runtime 能被瀏覽器載入並執行；它不是 WebGPU game host，也不代表 iOS／Android 已完成。

在 `D:/Projects/Unone` 先依 [platform toolchain](../../docs/platform-toolchain.md) 建立 Emscripten artifact：

```powershell
cargo build -p unone-web-smoke --target wasm32-unknown-emscripten
python scripts/serve-player.py --directory . --port 8000 --no-cache
```

再開啟 `http://127.0.0.1:8000/web/smoke/`。頁面應顯示 `passed: 60 deterministic frames executed`，並在 output 顯示 observation digest。

這裡以 repo root 為 server root，供 source smoke 使用；正式遊戲請使用
[player export](../../docs/player-export.md) 並 serve export 目錄。Helper 固定
`.js`／`.mjs` 的 JavaScript MIME 與 `.wasm` 的 `application/wasm`；其他
static server 也必須提供這些 MIME types，不能讓 module 回傳 `text/plain`。

若 `.js` 載入但 `.wasm` 找不到，確認兩個檔案位於：

```text
target/wasm32-unknown-emscripten/debug/deps/unone_web_smoke.js
target/wasm32-unknown-emscripten/debug/deps/unone_web_smoke.wasm
```
