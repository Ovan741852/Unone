# Issue：Node 預設未開啟 Emscripten exception section

- 日期：2026-09-05
- 範圍：Web smoke host／Node 執行環境
- 狀態：已確認，使用明確 runtime flag 繞過

## 現象

Emscripten 主模組已成功 link，但直接執行：

```powershell
node target/wasm32-unknown-emscripten/debug/deps/unone_web_smoke.js
```

會回報 `WebAssembly.instantiate(): unexpected section <Exception>`。

## 判定

這不是 Rust runtime、Luau source 或遊戲邏輯問題；artifact 包含 Emscripten exception section，而目前本機 Node 預設沒有開啟對應的 exnref 支援。這個結果也不代表瀏覽器已完成驗證。

## 修正與驗證

使用：

```powershell
node --experimental-wasm-exnref target/wasm32-unknown-emscripten/debug/deps/unone_web_smoke.js
```

同一份 `.js + .wasm` 成功執行 60 frames 並輸出 observation digest。正式 Web host 仍需使用瀏覽器支援矩陣與實際 WebGPU page 重新驗證，不把 Node smoke 當成瀏覽器通過。
