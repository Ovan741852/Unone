# 正式遊戲介面交付 · 2026-09-10

2026-09-11 更新：玩家固定，沒有換位按鈕；金幣與強化結晶分開顯示，商店與結算已更新，UI 資產共 66 張。12 頁 strict 排版與三種解析度的真實 Canvas 操作通過。現行經濟規格與驗證見 [CURRENCY-SPLIT.md](tests/CURRENCY-SPLIT.md)，以下原交付紀錄保留供歷史追溯。

正式入口 http://127.0.0.1:8190/ 使用 Unone 官方非 DOM UI renderer。HTML 只提供 canvas surface、載入錯誤與視窗尺寸。`web-overlay.html` 保留原開發介面；正式入口不 import ui.mjs / rpg-ui.mjs。

## 所有權與檔案

- `ui/formal-ui.luau`：遊戲自己的頁面、字串、語意操作，建置時合入 main.luau，再發布 api.ui.setRoot。
- `assets/formal-ui`：60 張 PNG companion 與原創 SVG；墨綠底、朱紅按鈕、金色切角；森林與 Q 版部隊主圖。
- `host.mjs`：使用 Unone `web/shared/canvas-ui.mjs`，官方圖片繪製、文字、反向 hit test、pointer capture；遊戲不另寫通用 widget renderer。
- `presentation/world-labels.mjs`：從真實 observation 投影怪物破防、共享池與倍率文字，同樣使用官方 Canvas UI renderer。
- `presentation/rewards.mjs`：官方 Lottie 四種獲獎特效，遊戲 Canvas 寶箱／輪盤及音效。所有傷害、派兵費、購物、開獎和退款仍由 Luau 決定。

主畫面、城鎮、三選一路線、五類補給地點、五部位武庫、符文、九流派分頁、戰鬥、暫停、結算／按住開箱均已接入。戰鬥含部隊成本、P1–P4 本機席位、手動／LOCK／AUTO、目標篩選、破防資訊、怪物潮與共享獎池。配裝顯示技能及派兵加價，科技單次選擇、附魔待確認時不能離開等原規則保留。

## 本次驗證

- `check --types`：通過。
- `tools/verify-formal-layout.mjs`：十一頁 Unone `ui preview --strict` 通過，零 findings。`tests/formal-layout` 保存每頁 InputFrame、精確 behind/front 圖像重疊意圖及官方報告；沒有整體關閉 overlap 檢查。
- `tools/verify-formal-ui.cjs`：真實 Edge 滑鼠點擊，城鎮→出征→選路→購買→換裝→符文／流派→戰鬥；點 UI 不發兵，按住戰場連射，切模式／篩選／暫停正常，零瀏覽器例外與 UI 載圖錯誤。1440×900、1280×720、900×600 已截圖目視檢查。
- `tools/verify-formal-flows.mjs`：明確標記的 WASM UI 狀態 fixture，測藥水／科技／詛咒、附魔採用、短按不開箱、持續一秒開箱、收下與下一輪；不拿 fixture 冒充自然通關。
- `tools/verify-rpg.mjs`：99 項玩法 fixture 及真實輸入買裝／出戰、城鎮存檔通過。19 個 JSON 回歸通過；未重跑 72 局平衡批次。
- Unone `verify-player-parity.mjs --timeout-ms 600000`：最終正式腳本的 19 個案例 native／WASM observation digest 一致，`selected_project_export_verified: true`。原本 120 秒 wrapper 逾時問題已由 Unone 修為可設定逾時並提供明確診斷。

建置：修改 formal-ui.luau 後執行 `node tools/build-formal-ui.mjs`，再 `node tools/finish_export.mjs`。後者由 D:/Projects/Unone 複製官方 UI 和 input 模組；不要在 YesSir 偽造引擎 API。若重建 WASM，從 Unone checkout 執行官方 build-web-live，指定 YesSir 專案；production artifact 位於 dist/formal-runtime，必須通過 native/WASM parity 才交付。

目前交付與截圖驗收平台是 Web player（Unone WASM + Canvas UI）。Unone 另有 native UI adapter，但本遊戲的完整動畫、特效及 native 整局整合未驗收，不宣稱已完成 native standalone。中文字形目前用 Windows 微軟正黑體／系統 fallback，跨裝置完全一致的字型仍需攜帶有授權的字型檔。四席是本機切換，共用池可玩，網路多人尚未完成。
