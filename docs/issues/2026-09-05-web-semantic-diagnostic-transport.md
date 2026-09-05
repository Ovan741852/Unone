# Issue：Web reload failure 被壓平成不可行動的字串

日期：2026-09-05  
範圍：`crates/unone-web-live-smoke`、`web/runner/`

## 症狀

Web C ABI 的 `load_project`／`reload_script` 失敗原本只把 engine `Diagnostic` 格式化成 `"CODE: explanation"`。generic runner 因而只能顯示一段字串，AI 無法穩定讀取 `severity`、`scope`、`hints`，也無法依 code 做後續處置。

## 分類

這是 Web host/ABI 邊界的可觀測性邏輯問題，不是把 Web API 塞進 engine core 的架構問題。Rust engine 已有共用 `Diagnostic`；正確修復是保留結構化資料跨 C ABI 傳輸，並讓 host 決定顯示方式。

## 修正

- Web bridge 以 `{ ok: false, kind: "web_error", diagnostic: { ... } }` 回傳 engine/runtime failure；非 engine 的 host failure 才使用 plain `error`。
- generic runner 建立帶 `.diagnostic` 的 Error，狀態列保留人類可讀訊息，JSON output 保留機器可讀欄位。
- Rust regression test 驗證壞 script reload 會回傳 semantic diagnostic，且上一個有效 runtime 仍可繼續 tick。

## 驗證與邊界

`cargo test --workspace`、workspace clippy、Web Emscripten build、Node syntax check 與 browser 3D Racing load/save smoke 通過。這只完成錯誤傳輸，不等於 production logging/telemetry、正式 CDN 或七類遊戲 final gate。
