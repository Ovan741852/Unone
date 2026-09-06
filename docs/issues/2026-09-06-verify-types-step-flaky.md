# Issue：`verify` 的 types step 會間歇性假失敗

日期：2026-09-06

## 狀態

open

## 分類

tooling-docs

## 影響範圍

- 平台：Windows（觀察到的環境）
- 專案：所有專案；以 slot-machine 觀察到
- 功能：`game verify` 的 `types` step、`EngineRuntime::check_with_types`

## 重現

1. `game --project D:/Projects/Unone_Games/slot-machine --json verify`
   → `types: failed`、`ok: false`，summary 是
   「the entry script did not pass the Luau contract or type check」。
2. 立刻單獨執行 `game --project ... --json check --types`
   → `ok: true`，`type_check.passed: true`，`output` 為空字串。
3. 立刻連續執行 `verify` 六次 → 六次都 `types: passed`。

失敗那次的 step diagnostics 沒有被保留下來檢視，因為後續執行都成功；重現時
必須先把每次的完整 diagnostic 寫檔再判斷。

## 預期與實際

預期：型別沒有問題時，`verify` 的 types step 與 `check --types` 結論一致。

實際：同一份未修改的專案，`verify` 偶爾回報型別失敗，而 `check --types`
永遠通過。

## 根因判斷（未證實）

`check_with_types` 把 analyzer 子行程的任何非零結束碼都當成型別錯誤，沒有
分辨「工具本身沒能執行」與「型別真的有問題」。Windows 上短時間重複啟動同一
個執行檔遇到防毒掃描或檔案鎖時，會出現非零結束碼但沒有型別輸出——正是觀察到
的樣態（`verify` 內連續啟動 analyzer，單獨執行則否）。

這是推測，實作者必須先重現並證實，不要照抄這段。

## 為什麼優先

一個會偶爾假失敗的 gate 會教作者「重跑到綠為止」。那個習慣一旦養成，所有
gate 的結論都不再可信——包含 layout、assets 與 tests。這比任何單一功能缺口
更傷，因為它侵蝕的是整套驗證機制的可信度。

## 修正方向

1. 連跑 50 次 `verify`，把每次完整 diagnostic 寫檔，量出失敗率。
2. 分辨兩類失敗：工具無法執行 → 自成錯誤碼，附 exit code 與 stderr，並在
   訊息中說明這是環境問題不是遊戲問題；型別真的不過 → 維持
   `LUAU_TYPECHECK_FAILED`。
3. 回歸測試不能只證明「跑一次會過」，要能證明工具執行失敗時不會被誤報成
   型別錯誤。

## 文件與教學更新

修正後 `docs/ai-workflow.md` 的 `verify` 段落要說明兩類失敗的分別。
