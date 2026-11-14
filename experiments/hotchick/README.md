# HotChick「海王・心動時分」來源交接

這份交接更新到 **release-036**，以 Unone `main` 的 `77557b59c0a025a1752abe0aa909220acc86b6e9` 為基底。先前 release-025 的來源交接位於 `hotchick` 分支；本次依目前專案規則提交到 `main`，範圍限定在 `experiments/hotchick/`。

這是遊戲原始碼、素材工具與驗證參考，尚未將候選能力抽成正式 Unone 共用模組，也沒有修改引擎核心或公開 EngineApi。既有 [共用模組候選](MODULE-CANDIDATES.md) 保留為 release-025 的設計提案，不能視為已重新盤點最新引擎的功能缺口。

正式遊戲：[海王・心動時分](https://goldsaucer.ovan929.chatgpt.site/g/heart-king)。release-036 已由 GoldSaucer 驗證並自動發布，版本為 `b1d8ce3be320654aa7b637df065ee41f`。正式進場會依平台規則兌換代幣；[免費單人試玩](https://goldsaucer.ovan929.chatgpt.site/play-content/b1d8ce3be320654aa7b637df065ee41f/index.html?trial=1) 每次載入使用 10,000 虛擬點數。

## 本次來源內容

| 路徑 | 職責 |
| --- | --- |
| `source/game/scripts/main.luau` | 射擊、碰撞、演出、收心、卡片、三個真實炮口，以及共用盤面與房間輸入 ACK |
| `source/game/presentation/goldsaucer-rooms.mjs` | 房間列表、開房、加入、換房、玩家進出與房間輸入傳輸 |
| `source/game/presentation/goldsaucer-server.mjs` | 單飛 RPC 排程、權威結算、退款、收藏同步及金融 ACK |
| `source/game/presentation/goldsaucer.mjs` | 平台身分、生命週期，以及試玩與正式模式隔離 |
| `source/server/goldsaucer/functions.js` | GoldSaucer 伺服器函式：安全亂數、帳務、收藏、房間目錄與原子捕獲判定 |
| `source/server/goldsaucer/room.js` | 平台房間伺服器：三人座位、公開玩家身分、即時射擊及失效提示 |
| `source/game/presentation/` | 官方 renderer 擴充、多路影片、圖集、覆蓋層、拆包及卡片 shader |
| `source/scripts/media-tool/`、`source/scripts/card-tool/` | 影片裁切、WebP 圖集、縮圖與卡片固定比例裁切工具 |
| `source/game/tests/`、`source/scripts/qa-*.mjs` | 原生、橋接、房間、UI 與瀏覽器驗收來源 |
| `source/assets/platform/goldsaucer/` | 平台接入規格、RTP 推導、品牌 metadata 與需求紀錄 |
| `examples/`、`validation/` | 無角色素材的配方、可重跑檢查與原工作目錄的歷史驗證摘要 |

`SOURCE-MANIFEST.json` 記錄 130 個來源檔的路徑、原始 SHA-256 與交付 SHA-256；來源內容按原位元組保留。`HANDOFF-MANIFEST.json` 記錄完整交接內容，排除其自身以避免循環雜湊。

## 多人與帳務界線

每房最多三人，共用 27 個女孩 symbol。盤面的種子、目標世代與時間軸一致；捕獲由伺服器函式透過共享狀態原子判定，同一世代只派獎一次。全部目標失效時退回整輪預扣，部分失效時保持原目標次序，以仍有效的目標數分攤整輪投注。已成立有效投注的理論 RTP 保持 98%。

房間伺服器只同步公開玩家與操作，不持有錢包，也不自行決定獎金。客戶端收到捕獲提示後，仍透過已序列化的伺服器函式取得可信盤面；不接受其他玩家任意送來的捕獲結果。實際射擊碰撞仍由 Luau 回報，這份實作沒有宣稱伺服器會重建完整射擊幾何。

換房先收到新的原生射擊閘門 ACK，讓舊房在途投注、金融回覆、演出與愛心全部完成，再只提交新盤面。錢包、卡片、影片解鎖、偏好與金融流水識別保留；同一頁面換房不重新 `open`，也不觸發代幣帶入／帶出。平台在真正離開遊戲頁時會自動換回整數紅鑽，舊版 `autoCashOut:false` 不再控制此行為。

免費訪客與獨立單人試玩不加入房間、不呼叫正式錢包或伺服器函式。初始 10,000 點用完，由玩家自行重新整理，本頁的試玩進度一併重新開始。

## 來源與驗證限制

完整遊戲使用官方 Unone Web/Wasm player，遊戲邏輯仍由 Luau 執行；專案明確選用 `renderer_mode: custom` 並委派官方 `createThreeRenderer`，卡片材質與粒子使用官方引擎介面。來源 SDK 為 `engine_version: 0.1.0`、`@unone/ui: 0.2.0`，不是目前 `main` 的 SDK 相容性宣告。若要升級，須依目前引擎契約重新整合與驗證。

交接不包含角色圖片／影片、DT2 圖片、Three.js vendor、SDK、匯出 player、快取、部署 ZIP、權杖或玩家帳本。呈現 inventory 及配方仍會引用原工作目錄中的素材；因此這份來源快照不能直接啟動完整遊戲。Windows 啟動器與部分測試亦保留原開發機路徑，需要依環境配置。

從交接目錄依 [驗證說明](validation/README.md) 可執行無素材檢查及平台模擬測試。`validation/WORKSPACE-RELEASE-036.json` 與相關原生／瀏覽器摘要是完整原工作目錄的既有證據；不能將它們視為這份交接在最新 Unone `main` 上重新跑過完整遊戲。
