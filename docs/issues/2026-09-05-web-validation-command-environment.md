# Issue: Web validation commands must isolate Emscripten environment

日期：2026-09-05  
分類：Validation tooling / developer workflow  
狀態：resolved

## 重現

在同一個 PowerShell 命令串先執行 `scripts/build-web-live.ps1`，再執行 native `cargo test`／`cargo clippy`；build script 設定的 Emscripten `RUSTFLAGS` 會留在目前 shell，後續 native cargo 也繼承 Web export flags，造成編譯長時間沒有可判讀輸出。

同一輪嘗試用目前 Node 版本的 `node --check` 直接檢查 browser ES module，會因 `.js` 未由 package 宣告 module 而把合法 `import`／`export` 報成 CommonJS syntax error。

## 判斷與修正

這是 validation command／toolchain 邊界問題，不是 engine 或 Web host 邏輯。中止被污染的命令，在乾淨的新 shell 分開執行 Web build 與 native tests/clippy；browser 實際載入頁面作為 ES module syntax 與 runtime smoke，沒有把錯誤的 Node check 當成程式碼 finding。

## 回歸證據

- `scripts/build-web-live.ps1` 成功產生 Emscripten artifact。
- 乾淨 shell 的 `cargo test --workspace` 與 `cargo clippy --workspace --all-targets -- -D warnings` 通過。
- Browser live page 載入、UI overlay、bundle v2 hot update 與 console warning/error check 通過。
