# 來源交接驗證

從 `experiments/hotchick` 執行無角色素材的語法與工具 smoke：

```sh
python validation/smoke.py --ffmpeg /path/to/ffmpeg --ffprobe /path/to/ffprobe
```

需要 Python 3.10+、Pillow、FFmpeg（libx264／libwebp）與 FFprobe。Node.js 可檢查 JavaScript 語法；若未安裝，報告會列為跳過。工具也接受 `HOTCHICK_FFMPEG`／`HOTCHICK_FFPROBE` 或從 `PATH` 尋找。

腳本解析交接中的 Python／JSON、檢查 JavaScript 語法，並在臨時目錄產生抽象圖片與影片，執行真正的卡片及媒體 CLI。它核對卡片尺寸、圖集、透明空格、縮圖、H.264 解碼與原始來源雜湊；僅保留 `RESULTS.json`，不提交生成媒體。

平台與房間測試也可直接從 `source/` 執行，不需原角色素材或登入平台：

```sh
node --test server/goldsaucer/functions.test.mjs server/goldsaucer/rooms.test.mjs
node scripts/qa-goldsaucer-server.mjs
node scripts/qa-goldsaucer-rooms.mjs
node scripts/qa-goldsaucer-trial.mjs
node scripts/qa-goldsaucer-bridge.mjs
node scripts/qa-wager-notices.mjs
node scripts/qa-platform-wager-notices.mjs
```

這些測試使用合成玩家、虛擬帳本及 SDK fixture，不執行真實兌幣、下注或平台 RPC。`SOURCE-CHECKS.json` 記錄在本交接副本上實際重跑的結果。

原生驗收另需與來源相容的 Unone SDK；實際瀏覽器驗收還需未隨附的媒體、正式 player 匯出、服務與 Chrome CDP。QuickJS 測試需要 GoldSaucer 原始碼與其相依套件，預設路徑可用各測試的環境變數調整。

`WORKSPACE-RELEASE-036.json`、`rooms-browser-summary.json` 及 `*-v36.json` 是完整原工作目錄的歷史驗證證據。這份交接的 smoke／平台模擬通過，不能證明完整遊戲在最新引擎 `main` 的渲染、媒體效能或 API 相容性；本次未重新執行這些完整遊戲檢查。
