# Report contract v1

`plugin.json` / `package.json` 的版本代表整個插件發行版；`ai_native.describe` 回傳的 `version` 則代表單一操作的輸入／輸出契約版號，並由 `versionScope` 明示。兩者獨立遞增：只有契約有變的操作才需更新版號；比較插件安裝版本時讀 manifest，不要把操作契約版號當成插件發行版號。

`ai_native.init` 是唯一維護中的空白範本，回傳 JSON 但不寫檔；`ai_native.catalog` 是問題與權重來源。
模板故意不能直接通過：先填真正的任務與證據。未驗證使用 `unverified` + `null`，不空白跳題。
`ai_native.describe` 選擇 `ai_native.evaluate` 後會提供完整 `reportSchema` 與 preparation。
不用為了知道欄位 enum 翻驗證器或猜測；這份文字文件補充語意和證據限制。

## 欄位

- `schema: unone.ai-native.audit.v1`, `rubricVersion: 1.0.0`。
- `ai_native.evaluate` 必須且只能收到 `report_path` 或 `report` JSON 其中一種。直接傳 `report` 可讓唯讀 host 對記憶體中的報告評分；證據檔仍從 host 選定 root 讀取。CLI 可用 `--report -` 從 stdin 讀取，最大 2 MiB。
- `target`: id, name, surface (plugin/http/cli/mcp/ui/library/mixed), scope,
  version, revision, environment。revision 可寫實際 HEAD 加 dirty；subject hash 才鎖定本次選定原碼。
- `trial`: mode (blind/informed/retest), entryPoints 字串陣列，steps 正整數，
  firstSuccessStep/sourceFallbackStep 為步數或 null，wrongGuesses，limitations。
  步數是實際探索操作次數，不宣稱精準人類時間或模型 token 數。原始探索順序放 observation artifact。
- `subject`: 1–64 個 `{path, sha256}`。是此次受測範圍的程式／文件，不是報告自身或整個 repo 的保證。
- `evidence`: `{id, kind, path, sha256, quote}`。
  kind 為 document/source/execution/observation；quote 是檔案內真的存在的短原文。
  execution 只能引用 recorder 的 JSON，必須對應同組 subject、現在的 probe hash。
  observation 是審查者記錄，不能取代執行證據。請在答案中指明來源檔案／函數或回應欄位。
- `checks`: 固定 10 題每題一次，欄位 id/status/rating/access/answer/reason/nextAction/evidence。
  evidence 是 ID 陣列。assessed 題至少一個引用；unverified 可以空引用但必須寫阻擋原因。
  access 只能是 `public`（只靠公開契約完成）、`source-assisted`（翻源碼後才完成）、
  `internal`（刻意以內部介面驗證）、`none`（未執行或未取得入口，只能搭配 unverified）。
  source-assisted 必須記錄 trial.sourceFallbackStep；不能因 HTTP 有回應就改標 public。
- `issues`: 最多 40 項；每項 id/checkId/severity (P0/P1/P2)/summary/cause/fix/verification/evidence。
  不知道根因時寫可證明的線索與仍需驗證的假設，不能編一個原因。

示例單題（只是欄位範例，不是完成的證據）：

```json
{"id":"diagnostics","status":"partial","rating":2,"access":"source-assisted","answer":"缺必要 header 回空白 403，無法由回應發現缺哪個 header。","reason":"合法的隔離請求通過；省略 x-example 後得到空 body，翻 source 才找到原因。","nextAction":"回傳穩定錯誤碼、缺少 header 名稱及安全修復方式，再跑相同負例。","evidence":["probe-output","guard-source"]}
```

## 分數不允許漏題灌水

rating 0–4，verified 3–4、partial 1–2、failed 0、unverified null。
每題證據支持點數 = weight × acceptedRating / 4，總權重固定 100。

- source-assisted/internal 操作最高 2；需要 runtime 的題只有靜態證據最高 1。
- 最高 4 需要執行證據；引用只有失敗／逾時／截斷的 capture 不能支撑通過。
- `index` 是有證據支持的下限。所有題都未測時 index=null，不是零能力。
- `possibleRange` 加上未知題的最大可能點數。未知不會被偷偷移出分母。
- `coveragePercent` 是有做判斷的題權重；另有 execution/publicExecutionCoveragePercent。
- 關鍵題 operation/observation/diagnostics/boundaries 任一不足 3，gate 不可通過。
  即使 gate=supported_within_scope，也只對聲明的任務成立，不是正式商用或安全認證。

工具只能驗證檔案一致與摘錄存在，無法自動驗證摘錄是否足以支持語意主張。
禁止把補一份看似正確的 JSON 當成跑過程式；獨立 evaluator 應重跑並檢查推論。

## 前後比較

`compare` 要求兩份報告都能用當前根目錄的證據驗證，且 target/scope/rubric 相同。
保存不同版本時使用不可變 snapshot 子目錄與對應 paths，不把舊 hash 更新成新的。
回測 agent 已有背景，標成 retest；要再次主張盲測改善，另給全新 agent 相同任務。
第一版不負責 Git checkout、下載舊版本或獨立證據簽署。

## 版本化紀錄

0.2.0 可用 `ai_native.register` 重新核對此報告後追加紀錄，再以
`ai_native.history/status` 查歷史與目前適用狀態。原 report v1 格式與 rubric 不變。
評分時間不會取代探針原始時間；登錄不是新一次盲測。詳見 [registry.md](registry.md)。
