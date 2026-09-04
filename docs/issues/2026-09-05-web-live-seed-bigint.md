# Issue：Emscripten `u64` seed 在 JavaScript 端必須使用 BigInt

- 日期：2026-09-05
- 範圍：browser host 呼叫 `unone_web_load_project` 的 seed ABI
- 分類：Tooling / platform contract
- 狀態：已修正並回歸

## 重現

`web/live/main.js` 第一次以 JavaScript number `42` 呼叫 Rust `unone_web_load_project(..., seed: u64)`，瀏覽器回報 `Cannot convert 42 to a BigInt`，頁面保持 failed，沒有假裝 live runtime 已載入。

## 原因與修正

Emscripten wrapper 對 Rust `u64` 使用 JavaScript `BigInt` ABI。host 改為傳 `42n`，並保留 seed 在 Rust runtime 內作 deterministic state；不把 seed 改成模糊的浮點 number。

## 回歸

重新載入 `web/live/` 後 status 顯示 live frame 持續遞增；host-provided project load、pointer drag 與 script reload 均通過，console 無 warning/error。後續任何 JS host wrapper 都必須以 BigInt 傳 `u64`。

