# Issue: typed ViewModel needs an explicit observation serialization boundary

日期：2026-09-05  
分類：Engine contract / game-side typing  
狀態：resolved

## 重現

AVG validation 的 `DialogueViewModel` 使用 `--!strict` 定義後，直接傳給 `api.observation.set("view_model", viewModel())`；官方 `luau-analyze` 回報具名 record 不能直接賦值給遞迴 JSON-like union。

## 判斷

這不是應該關閉 strict typecheck 的問題，也不是把 ViewModel 移入 Rust 的理由。它是 typed game projection 與 dynamic serialization boundary 的 contract friction；ViewModel 仍應留在遊戲端。

## 修正

- 保留 `DialogueViewModel` 的具體型別與 strict 檢查。
- 只在 `api.observation.set` 呼叫點使用顯式 `:: any`，把 dynamic boundary 標出來。
- engine runtime 對 observation value 做有限制的 JSON-like conversion 與語意 runtime error。
- test manifest 直接 assertion observation JSON，避免以畫面或自由文字確認分支。

## 回歸證據

- AVG `check --types` 通過。
- AVG 兩個 deterministic branch tests 通過。
- engine observation serialization／non-serializable value tests 通過。
- 相關決策：[0019-semantic-observation-mvvm-boundary.md](../decisions/0019-semantic-observation-mvvm-boundary.md)。
