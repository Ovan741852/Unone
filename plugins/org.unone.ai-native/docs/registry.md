# Version-bound assessment registry v1

這是 AI-first 開發工具的本機評測紀錄，不是 Core runtime、商店認證服務或第三方簽章。
Scout 只推薦契約；評分仍使用原來十題和 evidence gate。不能用登錄來抬高分數。

## 操作與權限

從插件目錄執行，`--root` 指向受測專案：

```sh
node cli.mjs describe --operation ai_native.register
node cli.mjs register --root <project> --assessment equipment-20260915-01 --report audits/equipment/audit.json --manifest plugins/org.example.equipment/plugin.json
node cli.mjs history --root <project> --target org.example.equipment
node cli.mjs status --root <project> --assessment equipment-20260915-01 --version 1.0.0
```

所有操作都可用 `ai_native.call` 與最新 describe 的 contractHash 執行。
`register` 是唯一 mutation：Node API 的可信任呼叫端傳 `{registryWrite:true}`；
stdio host 設 `UNONE_AI_NATIVE_REGISTRY_WRITE=1`。預設拒絕，payload 不可自行給權限；
環境變數是 host 設定，不是跨帳號授權／OS sandbox。CLI 明確呼叫 register 本身就是本機寫入意圖。
manifest 宣告 project.read / project.write_staging，真正寫入還是由插件獨立 guard。

`register` 先讀原報告、用 evaluate 重驗每個答案及證據，再建立新紀錄。
不能輸入 `{score:100}` 或舊 evaluation.json 冒充 report。target.surface=plugin 時
manifest 必填，ID/version 必須相同，且其 hash **原本就在 probe 的 subject**。
其他工具／Core／HTTP surface 可不綁 manifest；current_version 是呼叫端明確提供的版本，
不是插件已核實「安裝中的執行檔」。版本未知就不能宣稱已完成部署驗證。

## 不混淆的時間

| 欄位 | 意義 |
| --- | --- |
| probes[].startedAt / durationMs | 原始 recorder 的執行開始時間／耗時；可能比今天早 |
| evaluatedAt | 本次 register 重新驗證及計分完成時間；不是 probe 重跑時間 |
| recordedAt | 本次新紀錄組裝時間 |
| checkedAt | 本次 status 檢查版本／檔案是否仍一致的時間 |

UTC ISO timestamps，來自本機 clock 或既有 capture；沒有獨立時間戳機構保證。
同 assessment ID 的精確重試回 created=false，不換時間、不重算、不再增加紀錄。
若第一次已写入但回覆遺失，重送原 ID／報告即可查回；之後呼叫 status 查當前狀態。
不同意圖使用同 ID 回 AUDIT_REGISTRY_ID_CONFLICT。新版本、新報告用新 ID，舊檔不覆蓋。

## 查詢狀態

| state | 顯示 | score |
| --- | --- | --- |
| verified_within_scope | 已通過（限定範圍） | 原 gate 通過，版本、選定檔案與評分器一致 |
| needs_work | 未達標 | 有效證據支持的原分数，可能不為零 |
| insufficient_evidence | 證據不足 | 原分數或 null；不能當成通過 |
| needs_revalidation | 待重驗 | null；historicalScore 保留舊成績 |

history 只列歷史，不選最高分、不跨 scope/environment 合併成「全插件通過」。
查不到 target 回 records=[]；查不存在的 assessment 回 AUDIT_REGISTRY_NOT_FOUND，
不是 0 分。損壞紀錄回錯誤且 value=null，不信任其歷史分數。
`status` 成功完成但結果待重驗，仍是 `ok:true`／CLI exit 0；需要發布 gate 的呼叫端
**必須檢查 state === verified_within_scope**，不能只看 process exit code。

status 核對原碼／文件 subject、報告、證據、probe、manifest（若綁定）與評分器指紋。
版本或檔案改變／遺失、越界、評分器變更都不沿用目前分數；reasons 提供 code、field、
actual/expected（可量測時）與 fix。不重跑命令、不修 source、不自動改 old hash。
只對選定檔案和原 scope/environment 成立，沒有偵測未列入的新檔、所有依賴或另一平台。
相同版本文字不是完整身份保證；檔案選取完整性仍要審查。

## 持久化、完整性與備份

固定保存 `<project>/.unone/ai-native/assessments/<assessment-id>.json`。
包含 schema、完整原 report/result、版本／範圍、指紋、探針时间與 evidence references。
整份 payload 有 SHA-256；可偵測意外修改，**不能抵擋有本機寫權的人偽造內容及 checksum**。
不簽章、不證明評測者語意誠實。原始 capture／檔案並非全部嵌入；備份須連同 evidence 一起保留。

先完整寫入私有暫存檔並 fsync，再以不可覆蓋的 hard link 發布 .json，並發同 ID 只會有一份。
需要本機支援 hard link 的檔案系統（Windows NTFS 實測）；未支援時明確拒絕，不退回可能覆蓋的寫法。
crash 留下的 `.pending` 不當成認證，history 會忽略；沒有自動刪歷史或背景清理。
父路徑 symlink/junction 不允許。這不是對抗惡意併發改路徑的 OS 級隔離。

每份最多 2 MiB；history 最多掃 256 份且總讀取量 16 MiB，超過回 AUDIT_REGISTRY_LIMIT，
不悄悄漏掉紀錄。應按專案保存，明確備份／封存舊檔。Unone `.gitignore` 忽略 `.unone/`，
**這些紀錄不會自動 commit、同步其他電腦或上傳商店**，避免私有證據意外外流。
需要分享時由使用者明確檢查、備份登錄檔與原證據，或接入有授權的上傳流程。

## 本版範圍

提供可用的登錄、查詢與失效判定 API／CLI。沒有背景 watcher、Viewer 認證 UI、
商店 badge、平台簽章或 release CI 接線。呼叫端每次顯示／發布前應重新查 status。
舊 audit 文件維持不動、不自動改 hash 匯入；需要登錄時必須仍能真正驗證其原始證據。
既有單元測試或功能驗證不能自動被轉成「新 AI-native 分數」。
