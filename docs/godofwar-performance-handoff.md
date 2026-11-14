# GodOfWar／九州兵謀：效能、記憶體與載入交接

2026-11-15。這是遊戲消費端提供的量測與需求，請由 Unone 決定共用能力的優化方案。尚未證明的瓶頸列為待驗假設，不把遊戲設定、瀏覽器限制或平台耗時直接歸咎引擎。

## 版本與證據

- 正式遊戲：<https://goldsaucer.ovan929.chatgpt.site/g/jiuzhou-bingmou>，版本 `5fff5ee46f39c2cffee5de2785c666d9`。
- 正式 Web host 釘選 `a1b86ddc4a3618d9deb8c0550f32405f4aeedd2c`；修正已在 `main@c36be22dcac861e526e8db6514947ccb56860915`。production audio WASM SHA-256 為 `913deda0e726b1ca9d46c6ebc40f8cdc2714b5abb6b81aa03d0edb764f4d5fa2`。
- 載入與效能數字主要來自前一版 `5fa4a1ae9348ed694f6cfdfc9d9d50af` 的相同遊戲與 production WASM。最新版本只補手把拒絕保護，驗證過功能連續性，未重新宣稱完成效能 benchmark。
- [彙整 JSON](evidence/godofwar-performance-2026-11-15.json) 保留每筆來源、版本範圍、視窗覆蓋與單位。原始完整檔位於遊戲工作區 `game/evidence/loading-*`，本報告不包含玩家狀態或簽名 URL。

## 現況

| 項目 | 數字／能力 | 解讀界線 |
| --- | --- | --- |
| 完整發布 ZIP | 27,424,887 bytes，約 26.15 MiB | 上傳封裝大小，不是第一次進遊戲的下載量 |
| 解開後完整封裝 | 34,873,935 bytes、171 檔；平台報告 169 檔 | 包含尚未使用的素材與模組，不是啟動 critical path |
| 同一組 13 張主城圖片 | 29,030,415 → 9,195,874 bytes，下降 68.32% | 唯一來源編碼量；排除引擎、字型、音效、重複請求與未來預載 |
| 30 張轉碼圖集 | 77,466,870 → 16,084,316 bytes，下降 79.24% | 不改解析度，WebP alpha 已比對；RGBA／GPU 用量不會同比下降 |
| 必要啟動圖 | 2 張、3,407,984 bytes | 只計必要圖，排除 WASM、JS、字型及稍後進主城的圖片 |
| 主城＋科技暖圖持有 | 14 張唯一圖，88,074,760 bytes，83.995 MiB RGBA 估計 | 非程序總 RAM／VRAM，group 上限 96 MiB 也非總 RAM 上限 |
| 科技返回主城 | broker loads 維持 14，reuse 32 → 48 | 同一最終版本工作集，普通選單往返未新增圖片載入 |
| 較早戰場切換實驗 | 戰場 group 約 60 MiB、回城 group 約 90 MiB | loading-v1，與最終版 84 MiB 不做直接回歸比較；其他 owner 與 inactive cache 另計 |
| 本機 runtime ready／首個成功提交 | 約 294／555 ms，各一筆 | relative to `playerBoot`；首個提交可能是連線／轉場，不能當成主城可操作時間 |
| 科技前景 1 秒樣本 | 新快照提交間隔 p95 33.2 ms；準備 p95 6.2 ms；同步提交 p95 0.7 ms | 只有約 30 筆，非 60 FPS 證明、非 GPU／實際掃描顯示時間 |
| 原生 debug 科技 3×600 ticks | 平均 18.757 → 9.809 ms，下降 47.7% | 只定位趨勢，不能外推 production WASM 或手機 FPS |

本機 CDN 單次 Range 探測取得 `200` 全圖 2,446,991 bytes，而非 partial response，耗時約 1.12 秒；不將此單次結果視為手機網路測速。遊戲已提供 33 張核實 dimensions，避免 broker 為預檢再下載完整 header 所在圖片。

目前沒有實體 iOS／手機 4G、完整可操作時間、程序 RAM 峰值、VRAM 峰值、解碼音效總量或 20 次切頁後的長跑資料。先前約 1 Hz 的背景／未聚焦數字已排除效能結論。累計 dropped steps 不能直接當成所選量測視窗的掉幀率。

## 已有共用能力，請先重用

- `unonePlayerAssets.preload/load/unload/status/snapshot`：18 組共用同一 broker；preload 可升為 load；unload 只釋放該組 owner，不能關閉仍在畫面使用的圖。不是下載 ZIP bundle，也不是手動 GC。
- `unonePlayerPerformance.snapshot`：提交結果、準備耗時、RAF 間隔、圖片工作集／載入摘要。
- `unonePlayerProfile.report()`：選配、有界 host trace；可定位 publication、restore、parse、freeze、UI acquisition 等階段。效能驗收應另外跑關閉 profiler 的 production artifact。
- development `profile`／`memory`、`api.profile.span/count`、CLI `perf/run/verify`。當前 main 的 performance targets 是更新能力，須重建對應 CLI／WASM，不能假設舊發布 runtime 已全部提供。
- 遊戲端已做 WebP、工作集、暖科技圖、靜態 UI 約 10 Hz、拖曳立即更新、城市／戰鬥動畫約 30 Hz。玩法與畫面選擇仍歸遊戲，不移入 Rust。

## 交由引擎處理的項目

### P1：可重現的統一量測與載入階段

把現有工具串成同一測試報告，包含 artifact／engine／WASM hash、執行模式、裝置與瀏覽器、viewport／DPR、foreground／focus、cache／網路條件、profiling 是否開啟、時鐘原點、樣本數與覆蓋率。不同時間分位數不可直接相加。

區分 JS 模組／WASM fetch、compile／instantiate、字型、圖片 queue／fetch／decode、首次成功提交、私人後端同步，以及遊戲宣告的「主城可操作」里程碑。引擎提供通用量測／關聯方式；遊戲決定可操作的語意，平台登入與函式耗時獨立歸因。未知值回報 null；opaque iframe transferSize=0 不能當成 cache hit。

驗收：同一 production export 的冷／暖啟動各 5 次，原始樣本與 median／p95 一起交付；相同流程的開／關 profiler 成對結果。首輪先建立可信基線，再共同設定絕對載入目標，不宣稱本機 555 ms 就是手機進城時間。

### P1：記憶體所有權、峰值與回收可觀測性

目前 84 MiB 只計去重的 group RGBA。請整理現有 memory／renderer／broker 數據，分清 group、scene、Canvas UI、GPU prefix、inactive cache 的重疊 owner，另列 WASM capacity、Luau live heap、JS heap、音訊與 render targets。無法測到的 browser／driver 用量須明確標記，不相加重複資料、不強制 GC、不回收 active owner。

由引擎依量測決定是否需要少一份解碼副本、延後 GPU upload、改善退役時機、壓縮貼圖支援或其他通用方案；這些目前都是候選，沒有證據證明某一種副本正是本遊戲瓶頸。

驗收：固定村落等級與資源組，暖機後連續 20 次「主城→科技→背包→主城」及多次「主城→戰場→主城」，記錄切換峰值與靜置後值。owner／texture／buffer 數量應進入有界穩態，沒有持續增長；unload 不能造成仍顯示圖像失效。程序／GPU 實機峰值需另測，不能只以 group 回到預算判定無洩漏。

### P1：幀長尾、準備與繪製的重複工作

1 秒桌面樣本的 p95 33.2 ms 只能說明需補長時間調查。先跑同視窗空頁與最小官方 player，排除瀏覽器刷新限制，再量測城市拖曳、科技 ScrollView、10 隊戰鬥拖曳、七技能特效、採收飛入與介面疊加。

既有 [issue #2：每幀重設 canvas](https://github.com/Ovan741852/Unone/issues/2) 已有另一遊戲的隔離證據；請在原議題修正與驗收，不重複開項，也不把它當成九州兵謀所有卡頓的定論。另用既有 spans 檢查 UI 重建／跨 WASM publication／restore／GPU upload 中的重複工作；找到主要耗時後再決定修改，不預先要求另一套 renderer 或 cache。

驗收：每個 workload 暖機後至少 30 秒、重複 3 次，production 無 profiler 作接受比較，記錄 p50／p95／p99、>50／>100 ms 的提交間隔、有效樣本數、視窗 dropped-step 差值與輸入至成功提交的延遲。GPU 時間、提交間隔與實際掃描顯示時間分開。原有視覺、觸控、戰霧與飛入圖層不能退化。

### P2：載入排程與選配模組依賴

依 `queue_ms` 查背景 preload 是否延後 required load；若確實存在，請由引擎決定優先級與取消方式，維持同圖共享 promise／decode、取消晚到不污染新世代等契約。沒有 queue 長尾證據時不盲目增加平行解碼。

完整封裝有約 1.90 MB `three.webgpu.js`、1.46 MB `three.core.js` 等選配檔案，但這只是檔案清單，沒有證明啟動實際下載或解析它們。請量測真實 import critical path，再決定 WebGPU／3D／特效後端是否適合延後載入；不能只刪匯出檔或自行改官方 JS。

驗收：提供修正前後實際 request／parse／compile、必要素材 queue p95 與切頁準備時間；暖科技→開科技→回主城應維持不重解碼；場景切換的取消、共用持有與錯誤重試都要通過。

## 回交要求

請先依 `game find` 及最新 main 確認現有能力，選擇有量測支持的最高收益修改。方案由引擎決定，回交原因、改動範圍、相同條件的前後數字、版本／ABI 與官方 production export。新 host 若需要新 WASM，要一起交付並跑真實 exported-player smoke、音訊與原生／WASM 對照；不得只更換 JS 卻使用不相容 WASM。

此次不改遊戲、平台權限、玩法數值或私人後端，也不保證總記憶體／手機 60 FPS 已達標。下一輪遊戲只需按正式 API 接入，再在原場景復驗。
