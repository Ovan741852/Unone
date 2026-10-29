# 通用 JSON 陣列與空間效能診斷回測

2026-10-23 開始，2026-10-24（台北）完成。只修改 UNONE 的通用引擎、後端、型別、SDK 文件與驗證工具，沒有改動 YesSir 或帶入遊戲規則，沒有 commit／push。

## 修正內容

- 引擎回傳的空查詢 `results`、無命中 `hits` 會保留 JSON `[]`。共用 Lua／JSON 轉換追蹤陣列身分，普通空表仍是 `{}`。
- `api.observation.array(values?)` 保留原表及元素型別；`api.observation.setArray(key, values?)` 方便發布有型別的數字／記錄陣列。空表、清空後重填、巢狀陣列及 save 往返有對應驗證。非法內容／鍵不會覆蓋既有 observation。
- `api.spatial.profile()` 提供批次數、資料／查詢數、配對測試上界、命中數、等價輸入大小、實際傳輸 buffer bytes、manager 與 CPU／GPU executor 的 host 階段時間。
- Web GPU 包含驗證與輸入快照、排隊、打包、上傳、提交、等待回讀及解碼。無法量到的 GPU 核心時間明示缺值及原因。時間不混入一般結果或 canonical spatial snapshot；只讀取 profile 不會改變重播 digest。

```lua
local numbers: {number} = {}
api.observation.setArray("numbers", numbers) -- []
api.observation.set("empty", api.observation.array()) -- []
api.observation.set("object", {}) -- {}
local profile: SpatialProfile = api.spatial.profile()
api.observation.set("spatial_cost", profile)
```

新 SDK：`artifacts/spatial-observation-profile-sdk`；完整公開契約：`docs/spatial-batches.md`。新 release runtime：`artifacts/spatial-observation-profile-runtime`。

## Scout 與驗證證據

固定 rubric 1.0.0 評分 **80.5／100，supported_within_scope**，獨立審查接受。十題均有本次範圍的判斷／執行證據；100% coverage 指這十題，不代表整個引擎或所有裝置。operation／observation 為 4，其餘八題為 3；四個關鍵題皆達門檻。不是正式認證，也不把不同任務範圍的舊報告當成數值前後比較。

全新 agent 只拿 SDK 入口與通用幾何任務，不讀引擎原碼、舊評測或實作提示。39 筆 subprocess 操作、24 次公開 CLI，另有重播內 2 次 CLI。保留一次搜尋落空、一次 Node 輔助程式錯誤、一次 Luau query literal 推導錯誤；沒有隱藏失敗。

首次 runtime 交付在操作 030，發生於 strict 檢查失敗之後、修復之前。加入 canonical `SpatialNearestQuery` 區域型別後，032 strict 成功、033 重跑成功；獨立 JSON 驗證與新 temp 重播也通過。不宣稱第一次 strict 就通過。

盲測確認最近／重疊／掃掠查詢、完整巢狀陣列、普通物件、非法更新與修復、版本、下一 tick 交付、已消耗 ticket／已銷毀 index 邊界，以及不相關場景 entity 未變。CPU 小批次為 3×4；大批次為 4096×256。CPU 執行與 manager 驗證成本可以分別讀取；這些單次樣本不是穩定吞吐量或 GPU 效益證明。

- `blind/scout-arrays-profile/REPORT.txt`：完整盲測經過與限制。
- `blind/scout-arrays-profile/SHA256SUMS.json`／`SEAL.txt`：126 檔封存，根代理及獨立審查者逐檔驗證。
- `capture-public.json`：公開 SDK 型別、陣列、4096×128 成本、原子失敗及 profile-read digest 一致性。
- `capture-web.json`：fresh WASM，CPU／WebGPU 各自 main／Worker 的陣列與 4096×128 成本。
- `capture-native.json`：實際 RTX 5080／Vulkan 的 2×4 GPU 整合與 profile；不是大批次效能比較。
- `capture-kernel.json`：實際 WebGPU 九個差異／容量案例與 host profile。
- `capture-blind-replay-v2.json`：審讀後將封存 final inputs 複製到新 temp，實際 strict／native 重播。原 `capture-blind-replay.json` 保留驗證器 CRLF／LF 比較失敗，產品和盲測封存均未改。
- `validation.json`：測試／建置記錄及開發失敗。正式回歸通過 325 library、2 陣列、15 幾何、10 runtime；官方 analyzer 測試另行明確執行通過。
- `source-review.md`、`semantic-review.md`：原碼審查與獨立證據語意審查。
- `audit.json`、`evaluation.json`：最終固定十題 rubric 評測。

五份成功 recorder 使用相同 44 個 selected subjects，無 sourceChanged、截斷或逾時。source fingerprint 不是完整 immutable source snapshot／建置來源認證；CLI、analyzer 與 WASM 另由 SHA／manifest 鎖定。

## 量測界線

所有時間為 host monotonic 毫秒。GPU encode／readback wait 不是核心執行時間；階段可能重疊或巢狀，不能相加當 GPU compute。Luau 轉換、bridge JSON、呼叫端套用及裝置／pipeline setup 不在這些批次量測內。`pair_tests_upper_bound` 是上界，`input_body_bytes` 是等價 USB1 大小。

純讀取 profile 不改 canonical digest；發布實際時間會刻意產生非決定性的 observation。沒有宣稱 GPU 加速倍率、CPU／GPU 切換門檻、正式渲染驗收、跨裝置確定性或整個引擎都已驗完。舊評測與盲測封存維持原樣。
