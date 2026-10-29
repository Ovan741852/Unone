# 通用空間 API：結構化診斷、型別、故障與成本驗證

本次只修改 `D:/Projects/Unone` 的通用引擎、SDK、文件、合成範例及驗證工具。沒有修改或帶入 YesSir 的遊戲內容，也沒有安裝工具、commit 或 push；保留工作區原有與其他工作的修改。

交付使用 [SDK-v2](../../../artifacts/spatial-hardening-sdk-v2/README.md)，不要使用保留下來的前一個 `spatial-hardening-sdk` 試作產物。完整公開契約見 [空間批次指南](../../spatial-batches.md)。

| 項目 | 完成內容 |
| --- | --- |
| 結構化診斷 | `api.spatial.lastDiagnostic()` 提供錯誤碼、操作、欄位、實際／預期值、重試分類與終止狀態；保留既有 thrown 字串。Rust `spatial_diagnostic()` 與 Web `spatialHost.diagnostic()` 可在 tick 失敗後讀取原因。 |
| 正式型別與範例 | 正式 `SpatialInfo`、limits、diagnostic、binding profile 型別；SDK 打包 `examples/spatial-diagnostics` 合成幾何案例，完整記錄可直接送入 observation。 |
| 故障驗證 | 覆蓋多批次原子失敗、錯誤／重複／遲到回覆、取消與 reload 世代、終止原因保留，以及每 tick／待領取額度的不同重試策略。 |
| 效能量測 | Lua 輸入／輸出轉換、host setup 與 UTF-8 bridge 分項；SDK 量測工具提供暖機、多次樣本及 p50／p95，原生工具標示 build profile／平台。 |

這些是資料與查詢能力。移動整合、索敵決策、命中反應等規則仍由呼叫端決定。

## Scout 盲測與獨立審查

新的 Scout 僅取得正式 SDK 入口及任務，沒有讀取引擎實作、舊稽核、評分規則或範例 `main.luau`，自行設計不同幾何資料，完成 nearest／overlap／sweep、空結果、非法資料修正、版本與 ticket 生命週期、型別化 observation 和兩種 CPU 工作量測。

第一次 strict 檢查通過。第一次執行完成但外部核對為 12／13：原本要驗證失效 index 的第五次提交先碰到該 tick 額度。Scout 自行把該測試移到下一次更新，第二次 strict、執行及外部核對均通過，結果為 **13／13**。搜尋失敗、Node 路徑呼叫失敗與首次 12／13 的原始證據均保留，沒有當成第一次全數成功。

盲測資料封存於 [blind/scout-diagnostics-sdk](blind/scout-diagnostics-sdk/REPORT.txt)，共 87 個受 manifest 保護的檔案。之後的重播與來源／語意審查均明確標示為知情驗證，與首次盲測分開。正式評分為 **84／100，supported_within_scope**，十項均有評估、四項關鍵門檻均通過；獨立語意審查接受全部評等。詳見 [audit.json](audit.json)、[evaluation.json](evaluation.json) 與 [semantic-review.md](semantic-review.md)。分數只適用於報告宣告的範圍，與先前不同 SDK／任務範圍的分數不做正式前後比較。

## 已執行驗證

- 六組正式 recorder：公開 SDK、CPU 量測、Web CPU／WebGPU 主執行緒及 Worker、故障注入、原生 GPU、封存盲測重播，全數通過，沒有逾時、截斷或受測來源變更。
- 同組 62 個受測輸入 hash；另保存 46 份選定原始碼的確切文字，不只保留 hash。這不是完整編譯相依圖或外部來源簽證。
- 引擎相關套件合計 369 個測試通過，4 個既有忽略；另外實際執行官方 Luau 0.734 型別回歸、11 個 Web ABI 測試、29 個 JavaScript 測試及最終 SDK 打包回歸。
- 正式封存中的故障矩陣重跑 12 個 Rust／29 個 JavaScript 測試；另外真實原生 GPU 正常執行與新建 WASM 四種模式均通過。故障注入使用合成 executor／device，沒有宣稱實際發生硬體 device loss。

詳細命令與輸出見六份 `capture-*.json`、[validation.json](validation.json) 及 [source-review.md](source-review.md)。開發過程失敗記錄亦保留，成功結論只引用實際通過的後續執行。

## 保留的限制與後續項目

1. **搜尋 P2**：`空間查詢 錯誤診斷` 複合搜尋仍查無匹配；完整索引可找到介面。Scout 的 `scene entity` 也需縮為 `entity`。後續可改善通用多詞／同義詞搜尋，保留真實查無結果及完整索引退路。
2. 官方 Luau 0.734 對部分動態字串索引／巢狀別名寫入仍有型別限制。回傳值是分離的快照，請視為唯讀；沒有宣稱任意別名寫入都會被 strict 擋住。
3. 結構化診斷涵蓋輸入、管理器、executor 與 host 失敗；不涵蓋 VM OOM、buffer 配置或輸出編碼失敗。結構化欄位路徑從 1 起算，runtime frame 從 0 起算；舊錯誤文字維持舊慣例。
4. `recovery.action` 是人類提示，程式使用 `code`、`recovery.retry` 和 flags 分支。reload 沿用 executor，無法保證修復已故障的 GPU 裝置。
5. 分項耗時可能重疊；GPU kernel timestamp 尚未量測，維持缺值與原因。原生 debug 量測與 release SDK CPU 量測不是對等的端到端加速比較。沒有推論 GPU 加速倍率、自動切換門檻、畫面效能或跨裝置保證。

SDK CLI SHA-256：`d59c051d00ad47616978b6c4352a67092555baecfb090fb6b3442ca929c3e028`。其餘 binary／analyzer／WASM 指紋見 [environment.json](environment.json)、[validation.json](validation.json) 及 SDK／runtime manifests。
