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

## 重現嘗試：50 次 0 失敗

以同一個未修改的 slot-machine 連續執行 `verify` 50 次，`types` **全部 passed**。
因此**無法宣稱重現**；發生率低於 1/50，或當時有一次性的環境因素（最可能是
防毒對子行程的首次掃描）。

實作者不需要重現它。下面的缺陷可以直接從程式碼與 analyzer 行為確認，與發生
頻率無關。

## 已確認的缺陷（讀碼 + 實測）

`runtime.rs` 的型別檢查只分兩種情況：

- `Command::output()` **無法啟動** → `LUAU_ANALYZER_NOT_FOUND`（正確）
- 啟動後**任何非零 exit** → `LUAU_TYPECHECK_FAILED`，訊息是
  「入口腳本通過 runtime contract，但沒有通過官方 luau-analyze」

也就是說：analyzer 只要**跑起來之後**因為任何環境理由死掉（被防毒中止、
crash、DLL 載入失敗），作者會被告知**自己的腳本有型別錯誤**，而 `output`
是空的。這正是觀察到的樣態。

## 可靠的判別依據（實測）

用 `.toolcache/luau-0.734/luau-analyze.exe --formatter=gnu` 實測：

| 情況 | exit code | 輸出長度 |
|---|---|---|
| 型別正確的腳本 | 0 | 0 |
| **真的有型別錯誤** | 1 | **184**（完整 TypeError 訊息） |
| 檔案不存在 | 0 | 0 |

**真正的型別錯誤一定帶輸出**——那正是 `--formatter=gnu` 的用途。因此
**「非零 exit + 空輸出」永遠不是型別錯誤**，這是一個確定的判別依據，不需要
猜測失敗原因。

附帶發現：analyzer 對不存在的檔案回傳 exit 0 且無輸出，所以 exit 0 本身不
足以證明它真的分析過。目前這條路徑被上游的 `SCRIPT_READ_FAILED` 擋住
（實測入口腳本不存在時 `check --types` 回報該碼），不是現行 bug，但它說明
「exit 0」不等於「分析完成」。

## 根因判斷

`check_with_types` 把 exit code 當成唯一判準，忽略了輸出內容。輸出內容才是
分辨「工具講了什麼」與「工具沒講話」的依據。
## 為什麼優先

一個會偶爾假失敗的 gate 會教作者「重跑到綠為止」。那個習慣一旦養成，所有
gate 的結論都不再可信——包含 layout、assets 與 tests。這比任何單一功能缺口
更傷，因為它侵蝕的是整套驗證機制的可信度。

## 修正

依輸出內容分流，不再只看 exit code：

| exit | 輸出 | 結論 |
|---|---|---|
| 0 | 任意 | `passed: true`（不變） |
| 非零 | **非空** | `LUAU_TYPECHECK_FAILED`（不變） |
| 非零 | **空** | **新的 `LUAU_ANALYZER_FAILED`**：附 exit code 與 stderr，明說這是工具或環境問題、不是遊戲的型別問題，並建議重跑與檢查防毒／檔案鎖 |

`verify` 的 types step 對新錯誤碼要顯示成工具問題，不得與型別失敗混為一談。

回歸測試不能只證明「跑一次會過」。要用一個假的 analyzer（例如
`UNONE_LUAU_ANALYZER` 指向一個必定非零結束且不輸出的執行檔）證明它被分類成
`LUAU_ANALYZER_FAILED` 而不是型別錯誤。

## 文件與教學更新

修正後 `docs/ai-workflow.md` 的 `verify` 段落要說明兩類失敗的分別。
