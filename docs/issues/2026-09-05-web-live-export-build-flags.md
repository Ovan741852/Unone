# Issue：Emscripten live bridge export flags 傳給錯誤層級

- 日期：2026-09-05
- 範圍：`unone-web-live-smoke` exported ABI build script
- 分類：Tooling / platform boundary
- 狀態：已修正並回歸

## 重現

第一次執行 `scripts/build-web-live.ps1` 時，將 `--export=unone_web_init` 等參數直接放進 `RUSTFLAGS`。rustc 在讀取 target-specific information 時回報 `Unrecognized option: 'export'`；PowerShell script 還錯誤地繼續印出 built 訊息。

## 預期 / 實際

- 預期：Rust 編譯器接受 rustc flags，linker 匯出指定 C ABI symbols，失敗時 script 以非零狀態停止。
- 實際：linker flags 被當成 rustc flags；失敗命令沒有阻止後續成功訊息，會污染 AI 的 build feedback。

## 修正

改為 `-C link-arg=--export=...`，並在 native command 後檢查 `$LASTEXITCODE`，失敗時 throw。重新建置後 generated JS 確實包含目前 ABI 的 init、alloc、bundle begin/write/finish、project load、script reload、pointer、tick 與 observation pointer/length symbols。

## 回歸

`build-web-live.ps1` 成功；瀏覽器 live page 可逐 frame 呼叫 ABI、讀取 snapshot，pointer drag 後 `web_probe` position 改變；console 無 warning/error。教學不再使用錯誤的直接 `--export` 寫法。
