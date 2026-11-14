# 共用模組候選

下列內容是 release-025 的來源盤點與回收建議。除特別註明為提案外，都已有遊戲專用實作；目前尚未抽成可安裝的通用模組。原遊戲 SDK 與分支基底的版本不同，實作前需重新對照目前 Unone `main`。

## 1. 影片播放器與播放池｜高

**來源：** [game-renderer.mjs](source/game/presentation/game-renderer.mjs) 的中型播放池、滿版影片及回顧影片生命週期。

可抽出影片來源／海報、預載、首影格就緒、淡入、音量、並行上限、排隊、略過、逾時、錯誤、自然結束與釋放。中型的非阻擋同播和大型的優先覆蓋，可成為呼叫端選項。

建議放在 Web 呈現套件。回報事件須攜帶實例識別碼與取消狀態，避免舊影片 callback 操作新演出。完整看過的判斷應使用實際媒體播放紀錄，避免把影片 wall clock 與遊戲 tick clock 當成相同時間。角色、獎級、解鎖與派彩留給 Luau。

**待驗收：** 多路並行／排隊、切換與取消、解碼失敗、背景頁面、遊戲慢於影片、重播、完整播放辨識及 decoder 清理。

## 2. 圖集動畫元件｜高

**來源：** [game-renderer.mjs](source/game/presentation/game-renderer.mjs) 的圖集 metadata 載入、貼圖共享與幀更新；素材工具的 `field-sprites.json` 輸出。

可抽出圖集頁面、格數、排列、fps、循環長度與片段選擇，提供共用貼圖快取及 UV 更新。統一素材格式後，可供大量 NPC、魚群、角色頭像及小演出使用。

建議歸官方 renderer 與資產規格。原 SDK 的 `animation.play` 是 Spine 能力，不應直接假設等同圖集動畫；目前 `main` 是否已有相應能力需再查。移動路徑、命中與物件生成由遊戲決定。

**待驗收：** 不同片長與末頁空格、多頁圖集、循環邊界、共享資源、卸載及大量物件的幀時間。

## 3. 帶參數的 Web ↔ Luau 事件通道｜高／待設計

**來源問題：** [game-renderer.mjs](source/game/presentation/game-renderer.mjs) 的 `action`、`syncCardSeed`，以及 [main.luau](source/game/scripts/main.luau) 的事件消費與確認。

目前透過鍵盤動作字串傳送演出序號／影片 ID；卡牌種子用 31 個 bit 動作與 Ready，並持續送到 Luau 確認。這是可檢視的現有橋接方式，**不是已完成的正式通用通道**。

建議評估標準命令／事件佇列：型別、payload、實例 ID、確認、去重、取消與 tick 邊界。事件需能記錄及重播；輸入驗證與權威狀態更新仍在引擎／Luau 的既有契約下。先對照目前 `main` 的輸入與傳輸介面，再決定是否新增 API。

**待驗收：** 同 tick 多事件、低幀率、重複／過期事件、重設、失焦、重播確定性與非法 payload。完成通知只影響呈現生命週期，不應憑空授獎。

## 4. 素材處理工具｜高

**來源：** [影片工坊](source/scripts/media-tool/README.md)、[卡片工坊](source/scripts/card-tool/README.md)。

已有時間／空間裁切、影片與海報輸出、WebP 圖集、固定比例圖片、批次配方、來源 SHA-256、原檔保留及輸出校驗。適合整理為 SDK 開發工具，與遊戲 runtime 分離。

需移除角色捷徑、遊戲用途名稱、固定 2:3／600×900 的預設耦合，改成可配置的輸出 profile；保留明確覆寫及來源保護。工具目前不會自動去除影片原背景，透明補邊也不等於背景分離。

**待驗收：** 合成媒體像素／時間校驗、配方重生、跨平台路徑、來源保護、錯誤輸入及 CLI／GUI 輸出一致。

## 5. 視窗與覆蓋層管理｜中

**來源：** [game-renderer.mjs](source/game/presentation/game-renderer.mjs)、[cards.mjs](source/game/presentation/cards.mjs) 的回顧視窗、卡片 portal、滿版演出覆蓋及返回焦點。

可抽出層級、優先權、阻擋底層輸入、focus trap／還原、覆蓋暫停與恢復。像「大獎先覆蓋賞卡，結束後保留旋轉與縮放」可轉成通用優先層測試。

建議擴充 `@unone/ui` 或官方 Web UI host 的覆蓋層介面。沿用已有控制項、捲動、穩定 key 與焦點能力，不重寫一套 UI。視窗開啟後是否停止 AUTO 等規則由遊戲處理。

**待驗收：** 多層關閉順序、鍵盤／觸控、底層隔離、焦點恢復、背景狀態保持與 dispose。

## 6. 演出序列播放器｜中

**來源：** [cards.mjs](source/game/presentation/cards.mjs) 的 charge → tear → backs → reveal → results；影片與收心的階段銜接。

可抽出具名階段、串行／並行、時間與完成事件、取消 token、資源清理、略過及 reduced-motion 分支。動畫內容與階段資料由遊戲提供，不將卡包數量、稀有度或派彩寫入共用播放器。

建議放在共用呈現套件。需明確區分視覺完成與遊戲結算；瀏覽器定時器、WAAPI 與 Luau tick 的暫停／恢復語義也需定義。

**待驗收：** 中途取消、連續重開、切場景、減少動態、延遲 callback 失效，以及結果只提交一次。

## 7. 3D 卡片欣賞與材質預設｜中

**來源：** [cards.mjs](source/game/presentation/cards.mjs)、[card-shader.mjs](source/game/presentation/card-shader.mjs)、[main.scene.json](source/game/scenes/main.scene.json)。

可抽出正背面、拖曳旋轉、翻面、縮放、重設、鍵盤與觸控；foil／prism 材質則整理成可調預設。現有實作使用官方 shader factory、同一個 renderer context 與場景宣告材質。

建議為選配展示套件及材質預設庫。Shader／粒子 API 已存在；需要回收的是包裝與預設。卡面版型、角色文字、稀有度對應、收藏與 NEW 標記由遊戲提供。

**待驗收：** 多角度反光、正背切換、圖片載入失敗、普通材質 fallback、reduced-motion、覆蓋後姿態保持及 GPU 資源釋放。

## 8. 方向、全螢幕與輸入恢復｜中

**來源：** [landscape.mjs](source/game/presentation/landscape.mjs)。

可抽出橫直向條件、轉向提示、使用者觸發的全螢幕／方向鎖定、功能不支援時的提示，以及方向切換時釋放 pointer capture／按壓狀態。恢復後要求新的操作，避免殘留長按。

建議放在 Web 平台套件。提示內容可由遊戲提供；方向改變後是否暫停遊戲、停止 AUTO 或繼續處理在途事件，仍由 Luau 決定。

**待驗收：** 瀏覽器不支援鎖定、拒絕全螢幕、反覆轉向、拖曳中切換、鍵盤與觸控狀態清理。

## 9. 媒體、演出與效能驗證範本｜中

**來源：** [qa-media-tool.py](source/scripts/qa-media-tool.py)、[qa-card-tool.py](source/scripts/qa-card-tool.py)、[qa-pack-sequence.mjs](source/scripts/qa-pack-sequence.mjs)、[qa-runtime-fixes.mjs](source/scripts/qa-runtime-fixes.mjs) 及同目錄的其他已收錄腳本。

另有 `source/benchmark-game/` 的場景／Luau／renderer，以及 `run_symbol_benchmark.mjs`、`summarize_symbol_benchmark.py` 等量測來源。它們仍依賴原測試素材；原有工具驗收也包含正式角色配方與圖片，不等於僅使用合成素材即可執行全部驗收。

可整理成合成素材與最小消費端範例：大量圖集、多影片同播、shader 多角度、慢 CPU、取消／重設、資源回收及 reduced-motion。統一報告版本、環境、測試數與量測方法。

建議放在 SDK 測試工具。既有腳本含原專案路徑、埠、媒體與遊戲規則假設，需要移植；此來源包本身不是通過新版 SDK 的證據。

**待驗收：** 至少兩個無遊戲角色的範例、乾淨環境可重跑、測試後關閉自建頁面／程序、失敗可診斷，以及效能門檻附明確裝置與環境。

## 整理前共同確認

- 先使用目前 Unone 的官方 API、renderer 與 UI 套件；只補經核對仍缺少的共用能力。
- 先定 API、支援 target、生命週期及失敗語義，再搬程式；保留目前來源作對照。
- 用合成素材證明模組可脫離角色、卡池與投注規則使用。
- 每項的正式抽取與合併，待候選範圍確認後另行進行。
