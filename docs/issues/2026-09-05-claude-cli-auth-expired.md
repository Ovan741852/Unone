# Claude CLI 無法完成 code review

## 狀態
open

## 分類
tooling-docs

## 影響範圍
- 平台：Windows
- 專案：Unone engine workspace
- 功能：外部第二層 code review

## 重現

在 `D:/Projects/Unone` 執行 non-interactive Claude review：

```powershell
claude -p "Review the current Unone Rust/Luau engine prototype ..." --output-format text --permission-mode plan --tools "Read,Bash" --no-session-persistence
```

## 預期與實際

第一次預期取得只讀 code review；實際回覆：`Failed to authenticate: OAuth session expired and could not be refreshed`。第二次以相同 read-only 目的重試，進程長時間無輸出，超過合理等待後停止。

## 根因判斷

外部 Claude CLI OAuth session 已過期，與 Unone 原始碼無關；不分類為引擎架構問題。

## 修正

待重新登入 Claude CLI 後重試。工具可用前，主流程仍以 `cargo check`、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo test`、git diff 與人工審查維持品質。

## 回歸測試

重試相同 review 命令，確認能取得 review output；之後把結果寫入對應 devlog。
