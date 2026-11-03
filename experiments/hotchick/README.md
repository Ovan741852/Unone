# HotChick 共用模組候選交接包

這個分支收錄 HotChick「海王」試玩版的實作來源與整理提案，供確認哪些能力適合回收成 Unone 共用模組。來源快照為 **release-025**，整理日期為 **2026-11-03**；分支以 Unone `main` 的 `d7b4afcab8db547a9fae25832974606ac50fdc24` 為基底。

目前階段是 **來源交接與設計審閱**。這些實作仍有遊戲專用命名與耦合，尚未完成通用化，也沒有新增正式 EngineApi、安裝套件或變更引擎建置。請先閱讀 [共用模組候選](MODULE-CANDIDATES.md)。

## 內容導覽

| 路徑 | 用途 |
| --- | --- |
| [source/game/presentation/game-renderer.mjs](source/game/presentation/game-renderer.mjs) | Web 呈現整合：多路影片、圖集、覆蓋層、標準輸入橋接及官方 renderer 擴充 |
| [source/game/presentation/cards.mjs](source/game/presentation/cards.mjs) | 拆包演出、結果顯示、卡片欣賞與互動 |
| [source/game/presentation/card-shader.mjs](source/game/presentation/card-shader.mjs) | 官方 shader factory 上的雙面卡片、貼圖與材質資源管理 |
| [source/game/presentation/landscape.mjs](source/game/presentation/landscape.mjs) | 方向限制、全螢幕請求及輸入釋放 |
| [source/game/scenes/main.scene.json](source/game/scenes/main.scene.json) | `card_foil`／`card_diamond` 材質與粒子定義 |
| [source/game/scripts/main.luau](source/game/scripts/main.luau) | 遊戲狀態、事件消費及演出生命週期的參考實作 |
| [source/scripts/media-tool/README.md](source/scripts/media-tool/README.md) | 影片裁切、圖集、縮圖、不同解析度與 JSON 配方工具 |
| [source/scripts/card-tool/README.md](source/scripts/card-tool/README.md) | 固定比例卡圖裁切、批次輸出與配方工具 |
| `source/scripts/qa-*.py`／`qa-*.mjs` | 已有驗收腳本的來源；各自依賴條件見下文 |
| `source/benchmark-game/` 與 `source/scripts/*symbol_benchmark*` | WebP／影片同播的基準測試來源與量測整理 |
| `examples/` | 交接包另外提供的合成素材／配方範例；不包含原角色素材 |
| [validation/README.md](validation/README.md) | 可獨立執行的合成 smoke、環境需求及驗證界線 |
| [validation/RESULTS.json](validation/RESULTS.json) | 本次交接檢查：51 項通過，0 項跳過；未執行完整遊戲或瀏覽器驗證 |
| [SOURCE-MANIFEST.json](SOURCE-MANIFEST.json) | 55 個來源檔案的原始及交接 SHA-256、正規化紀錄 |

來源目錄保留原專案的相對結構，方便追蹤呼叫與搬移；它不是 Unone 正式套件目錄。`main.luau` 中的投注、命中、派彩、角色、卡池與解鎖規則只作上下文參考，繼續歸遊戲所有。

## 九項候選與優先順序

第一批建議確認：**影片播放池、圖集動畫、Web ↔ Luau 事件通道、素材工具**。

第二批為覆蓋層管理、演出序列、3D 卡片欣賞與材質、方向／全螢幕管理、媒體與效能驗證範本。每項的既有實作、缺口與建議歸屬都列在 [MODULE-CANDIDATES.md](MODULE-CANDIDATES.md)。

其中，帶參數且可確認／去重的 Web ↔ Luau 事件通道是**待設計提案**；目前原始碼以標準鍵盤輸入代碼傳遞通知，卡牌種子使用 31 個 bit 動作加 Ready／確認。此分支沒有實作新的通道 API。

## 呈現與規則的界線

- 遊戲規則與權威狀態由 Luau 管理；影片是否成功播放，不應成為計算獎金的依據。
- Web 擴充負責實際媒體播放、DOM 介面、互動姿態與渲染呈現，向 Luau 回報可驗證的生命週期事件。
- 原遊戲選用 `renderer_mode: custom`，並委派官方 `createThreeRenderer`／`attachPresentation`；卡片材質使用官方 `createShaderMaterials` 及既有 renderer context。
- Shader 與粒子已有引擎基礎。適合回收的是元件、資源管理與預設，並非另建 GPU host 或取代引擎的 shader／粒子系統。

## 版本與來源限制

原遊戲使用 Windows SDK，`engine_version: 0.1.0`、`@unone/ui: 0.2.0`。SDK runtime metadata 標記來源 commit `859826ecdac50f5722cc66a226123039d4675e2e`，並已有 `source_dirty: true`。

交接前的核對發現：所用 SDK manifest 的 64 個檔案符合原 SHA-256，遊戲匯出的 JS／Wasm 核心與該 SDK 一致。這能確認相對於所用 SDK 沒有額外修補；不能據此還原該 SDK 與上游原始碼的完整差異，也不能將既有 dirty 標記歸因於 HotChick。

分支基底的 Unone `main` 已在 AGENTS.md 使用 `@unone/ui: 0.6.0`。本包的缺口盤點主要來自原遊戲所用 SDK，正式抽取前必須再核對目前 `main`，沿用已新增的官方能力、型別與契約，不能直接照抄舊版判斷。

## 如何查看與試用工具

這份來源快照**不是可直接啟動的完整遊戲**。它未提供角色照片、影片、原始素材副本、DT2 圖片、Three.js vendor 檔、SDK 或已匯出的官方 player。呈現模組中的 `../../web/...` 匯入需在原本的官方 player 匯出結構下解析；單獨開啟 HTML 不會得到試玩版。

工具可從 `source/` 作為工作目錄先檢查 CLI：

```powershell
python scripts/media-tool/media_tool.py --help
python scripts/card-tool/card_tool.py --help
```

工具依賴 Python、Pillow；影片處理另需 FFmpeg／FFprobe。FFmpeg 路徑可依工具說明設定 `HOTCHICK_FFMPEG`／`HOTCHICK_FFPROBE`。Windows 啟動器及既有測試仍有原開發機路徑、埠與輸出位置，移植時需逐一調整。原工具的角色載入捷徑也會引用本包未提供的正式素材配方。

使用合成範例或自己的合法素材建立配方後，再執行各工具的 `validate`／`build`。產物應放在測試輸出資料夾；保留原圖／原片，不以來源路徑作為輸出。

從本交接包目錄執行 `python validation/smoke.py --help`，依 [合成驗證說明](validation/README.md) 指定 FFmpeg／FFprobe；此入口不需要原角色素材。

## 驗證來源的閱讀方式

以下是既有測試腳本，**收錄檔案不等於此分支已重跑通過**：

- [qa-media-tool.py](source/scripts/qa-media-tool.py)：包含合成影片與圖片的裁切、圖集、輸出及工具 API 驗收，也會核對原藝瑟配方的 19 項產物；完整執行需要未隨附的角色來源及配方。
- [qa-card-tool.py](source/scripts/qa-card-tool.py)：包含合成條紋圖片、裁切像素、配方、來源校驗與下載驗收，也會核對原 14 張正式卡圖；完整執行需要未隨附的卡圖與配方。
- [qa-pack-sequence.mjs](source/scripts/qa-pack-sequence.mjs)：拆包階段、卡背、翻面、排序及取消的瀏覽器驗證；fixture 會讀取三張原卡圖，屬來源參考。
- [qa-runtime-fixes.mjs](source/scripts/qa-runtime-fixes.mjs)：實際遊戲的影片完成、時鐘差、輸入與亂數握手回歸；需要完整遊戲匯出與 Chrome CDP。

瀏覽器腳本需 Node.js、Chrome CDP 及各腳本要求的 fixture／服務；原生與完整遊戲測試另需未隨附的媒體、SDK 或遊戲場景。這些既有腳本列為 reference-only，不保證只靠本包就能跑完；交接包另附的合成 smoke 測試才是無角色素材的獨立入口。新交接檢查與歷史驗證應分開記錄，不把舊版通過結果視為新版 SDK 相容證明。

## 待確認

- [ ] 確認九項候選的範圍與第一批優先順序。
- [ ] 對照目前 Unone `main`，確認哪些能力已存在、哪些只需補包裝。
- [ ] 決定套件位置、公開 API、資產格式及支援的 target／renderer。
- [ ] 抽出至少兩個不含角色／投注邏輯的合成消費端範例。
- [ ] 將既有生命週期、輸入恢復、資源釋放與失敗路徑改成通用驗收。
- [ ] 經確認後再進行正式抽取、相容性驗證及合併。
