# Issue：型別 gate 對每個專案都假通過（追查間歇假失敗時發現）

日期：2026-09-06

## 狀態

fixed（假通過已修並補上回歸測試）／間歇假失敗仍 open

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

## 追查時發現更嚴重的問題：型別 gate 對每個專案都假通過

追查間歇假失敗時發現：`check --types` 對**任何**專案都會通過，包含刻意寫壞的。

在 slot-machine 的 `main.luau` 放一個確定的型別錯誤
（`local credits: number = "three"`），`check --types` 仍回報
`ok: true`、`passed: true`、`output: ""`。

### 根因

引擎傳給 analyzer 的是 `fs::canonicalize` 的結果，也就是 Windows 的
**extended-length 路徑** `\\?\D:\...`。實測同一個帶錯誤的檔案：

| 傳入的路徑形式 | exit | 輸出 |
|---|---|---|
| `C:/...`（一般） | 1 | 完整 TypeError |
| `\\?\C:\...`（引擎實際傳的） | **0** | **空** |

luau-analyze 打不開這個形式，於是什麼都沒做就回傳 0。而 exit 0 的意思是
「沒有發現問題」，所以整個型別 gate 靜默通過。

### 為什麼沒被發現

**因為沒有任何測試證明這個 gate 還能失敗。** 本輪稍早手動做過負向控制
（呼叫不存在的 API 會被擋），但那次是在對話中臨時做的，沒有留下測試。之後
路徑處理改動讓它退化，沒有任何東西會響。

### 修正

1. `analyzer_argument()` 在呼叫 analyzer 前去掉 `\\?\` 與 `\\?\UNC\` 前綴。
2. 補上**會失敗的回歸測試**：拿一個確定有型別錯誤的腳本、用
   `fs::canonicalize` 過的路徑（也就是引擎真正傳的形式）跑完整流程，必須得到
   `LUAU_TYPECHECK_FAILED` 且輸出含 `TypeError`。找不到 analyzer 時明確 skip。
3. 另補 `analyzer_argument` 的純函式測試。

驗證：注入型別錯誤後回報 `LUAU_TYPECHECK_FAILED` 並附 `main.luau:97.25-97.31:
TypeError: Expected this to be 'number'...`；還原後三款遊戲的 `types` 全部 passed。

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
