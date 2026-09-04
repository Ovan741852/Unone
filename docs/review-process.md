# Code review 流程

## 目的

定期用 Claude CLI 做第二層 code review，檢查引擎核心是否仍符合 Rust/Luau 邊界、遊戲引擎定位、determinism、hot reload 與語意診斷要求。

## 觸發時機

- 每完成一個重要垂直切片。
- 每 3–5 個 commits。
- 修改 runtime ownership、script lifecycle、platform adapter、protocol 或資料格式後。
- 憤怒鳥 2D 或其他驗證遊戲回報跨專案重複問題時。

## 執行原則

在專案根目錄以 non-interactive、read-only 方式執行 Claude CLI。review 不直接授權它改檔；修正由主開發流程判斷、實作、測試，再另做 commit。

建議 prompt：

```text
Review the current Unone Rust/Luau engine changes as a senior game-engine reviewer.
Do not edit files. Inspect the diff and relevant tests. Focus on correctness,
Rust ownership/FFI safety, deterministic simulation, hot reload, semantic
diagnostics, platform boundaries, and whether game-specific policy leaked into
the engine. Report findings by severity with file/line and concrete fixes.
```

## 結果紀錄

每次 review 在 devlog 記錄：日期、review commit、Claude 版本、執行命令、結果、採納項目與不採納理由。若 CLI 不可用，也要記錄具體錯誤，不以「已 review」代替。

## 本次狀態

2026-09-05：Claude CLI `2.1.206` 曾回報 OAuth session expired，後續 review 無輸出並超時；`2.1.260` 的第十一次 review 也在約 60 秒後無輸出而中止，所有這些都不算完成。待 transport 或登入狀態可正常回應後重試；第十一次詳細紀錄見 `docs/issues/2026-09-05-claude-cli-review-timeout-11.md`。
