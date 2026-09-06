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

2026-09-05：Claude CLI `2.1.206` 曾回報 OAuth session expired，後續第 17–27 次 review 都在約 60–70 秒無輸出後中止，這些不算完成。`2.1.260` 的第 28 次 review 已完成；結果與採納項目見 `docs/issues/2026-09-05-claude-cli-review-findings-28.md`。

2026-09-06：第 29 次首次因 session limit 未完成，使用者批准先提交。
現已補完固定 `5ae821e..6ab9b60`：Claude CLI 2.1.260 exit0、無 actionable
P1/P2；只讀 source/tests，沒有 build/test 實跑。對應追蹤已停止，詳見
`docs/issues/2026-09-06-claude-cli-review-29.md`；不代表後續變更或產品通過。

第 30 次已完成 `04af786..4a128d7` 只讀審查；結果及主代理的獨立反例見
`docs/issues/2026-09-06-claude-cli-review-30.md`。第 29 次已另行完成，
兩份 review 各自固定範圍；不代表後續修正、平台建置
或 package-only 盲驗已通過。

第 31 次以 Claude CLI 2.1.260 完成 `4a128d7..c187df8` 唯讀審查，exit0，
無新增 actionable P1/P2。見 `docs/issues/2026-09-06-claude-cli-review-31.md`；
此為 source review，不替代獨立 package-only 評估。
