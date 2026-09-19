# 正式遊戲介面交付 · 2026-09-10

> 現行製作入口：[UI-PRODUCTION.md](UI-PRODUCTION.md)；視覺規格：[DESIGN.md](DESIGN.md)。本頁主要保留歷史交付；最新裝備店鍵盤／整卡點擊／小螢幕及重骰修正範圍，見 [2026-09-19 修正報告](tests/ui-skill-trial/REPORT.md)。歷史案例數與資產數不可當成最新版測試結果。

2026-09-11 更新：玩家固定，沒有換位按鈕；金幣與強化結晶分開顯示，商店與結算已更新，UI 資產共 66 張。12 頁 strict 排版與三種解析度的真實 Canvas 操作通過。現行經濟規格與驗證見 [CURRENCY-SPLIT.md](tests/CURRENCY-SPLIT.md)，以下原交付紀錄保留供歷史追溯。

正式入口 http://127.0.0.1:8190/ 使用 Unone 官方 Canvas UI renderer。HTML 提供 canvas surface、載入錯誤與視窗尺寸；2026-09-19 起裝備店另有 Canvas fallback 語意按鈕與鍵盤焦點投影，不是第二套可見遊戲介面，也不另算玩法。`web-overlay.html` 保留原開發介面；正式入口不 import ui.mjs / rpg-ui.mjs。

## 所有權與檔案

- `ui/formal-ui.luau`：遊戲自己的頁面、字串、語意操作，建置時合入 main.luau，再發布 api.ui.setRoot。
- `assets/formal-ui`：60 張 PNG companion 與原創 SVG；墨綠底、朱紅按鈕、金色切角；森林與 Q 版部隊主圖。
- `host.mjs`：使用 Unone `web/shared/canvas-ui.mjs`，官方圖片繪製、文字、反向 hit test、pointer capture；遊戲不另寫通用 widget renderer。
- `presentation/world-labels.mjs`：從真實 observation 投影怪物破防、共享池與倍率文字，同樣使用官方 Canvas UI renderer。
- `presentation/rewards.mjs`：官方 Lottie 四種獲獎特效，遊戲 Canvas 寶箱／輪盤及音效。所有傷害、派兵費、購物、開獎和退款仍由 Luau 決定。

主畫面、城鎮、三選一路線、五類補給地點、五部位武庫、符文、九流派分頁、戰鬥、暫停、結算／按住開箱均已接入。戰鬥含部隊成本、P1–P4 本機席位、手動／LOCK／AUTO、目標篩選、破防資訊、怪物潮與共享獎池。配裝顯示技能及派兵加價，科技單次選擇、附魔待確認時不能離開等原規則保留。裝備店現在採置中視窗、柔焦後景、商人側欄與四件水平商品卡；卡片底色表示稀有度，詳情彈窗沿用原本 Buy 語意動作。正式商店框、商品卡與商店按鈕使用生成素材的九宮格切片，100×100 佈局只拉伸中段，不拉變形四角裝飾。

## 本次驗證

### 2026-09-19 共用元件修正版（取代先前商店驗收聲明）

先前只檢查全螢幕 bounds，漏了卡片超出視窗、實際字形與裝飾安全區；先前的「商店通過」不足以作為交付依據。

本次改用 `presentation/ui-components.mjs` 的來源切線／固定角落／實際字寬契約，商店按鈕共用高度與 padding，商品卡共用模板。入場和 hover 以整個元件為單位；背景遮罩不縮放。保留原有生成框素材和遊戲規則。

正式 Web 驗收由 `tools/verify-shop-components.cjs` 執行，報告與實際截圖在 `tests/shop-layout/components-*`：四種視窗尺寸、四件商品詳情、購買回執、長文案與六個動畫時間點；檢查父框包含、同層 AABB、九片完整性、四角原比例、統一按鈕高度及 Canvas 真實字形 clipping。

本次修正後 native CLI `D:/Projects/Unone/target/debug/game.exe` 已不在磁碟上，未宣稱完成最新 native strict 重跑；以下舊紀錄僅供歷史追溯。

- `check --types`：通過。
- `tools/verify-shop-layout.mjs`：裝備店專項 AABB 檢查，驗證四張水平卡片、卡片內容 containment、卡片／按鈕 sibling 不重疊、詳情彈窗控制項與安全邊界；報告保存在 `tests/shop-layout/report.json`。
- `tools/slice-shop-assets.mjs`：將生成的商店框材質切成九個透明 PNG，供 Luau 的 `nineSlice` helper 組裝；不改 Unone 引擎，也不把原始素材直接拉伸到 100×100。
- `tools/verify-formal-layout.mjs`：全局 Unone `ui preview --strict` 回歸。`tests/formal-layout` 保存每頁 InputFrame、重疊意圖及官方報告；其中 profile／town 的歷史基線 findings 與本次裝備店檢查分開記錄，不把卡片父子層級誤當成裝備店缺陷。
- 2026-09-19 實跑結果：裝備店專項與兩種瀏覽器尺寸通過；全局腳本仍保留舊的 profile／town fixture findings，不能拿來取代專項商店驗收。
- 共同間距、安全邊界、資訊層級與 AABB allowlist 規則見 [UI-DESIGN-GUIDELINES-20260919.md](design-v1/UI-DESIGN-GUIDELINES-20260919.md)。
- `tools/verify-formal-ui.cjs`：真實 Edge 滑鼠點擊，城鎮→出征→選路→購買→換裝→符文／流派→戰鬥；點 UI 不發兵，按住戰場連射，切模式／篩選／暫停正常，零瀏覽器例外與 UI 載圖錯誤。1440×900、1280×720、900×600 已截圖目視檢查。
- `tools/verify-formal-flows.mjs`：明確標記的 WASM UI 狀態 fixture，測藥水／科技／詛咒、附魔採用、短按不開箱、持續一秒開箱、收下與下一輪；不拿 fixture 冒充自然通關。
- `tools/verify-rpg.mjs`：99 項玩法 fixture 及真實輸入買裝／出戰、城鎮存檔通過。19 個 JSON 回歸通過；未重跑 72 局平衡批次。
- Unone `verify-player-parity.mjs --timeout-ms 600000`：最終正式腳本的 19 個案例 native／WASM observation digest 一致，`selected_project_export_verified: true`。原本 120 秒 wrapper 逾時問題已由 Unone 修為可設定逾時並提供明確診斷。

建置：修改素材切線時先執行 `node tools/slice-shop-assets.mjs`；修改 formal-ui.luau 後執行 `node tools/build-formal-ui.mjs`，成功後執行 `node tools/finish_export.mjs`。後者由 D:/Projects/Unone 複製官方 UI 和 input 模組；不要在 YesSir 偽造引擎 API。若重建 WASM，從 Unone checkout 執行官方 build-web-live，指定 YesSir 專案；production artifact 位於 dist/formal-runtime，必須通過 native/WASM parity 才交付。

目前交付與截圖驗收平台是 Web player（Unone WASM + Canvas UI）。Unone 另有 native UI adapter，但本遊戲的完整動畫、特效及 native 整局整合未驗收，不宣稱已完成 native standalone。中文字形目前用 Windows 微軟正黑體／系統 fallback，跨裝置完全一致的字型仍需攜帶有授權的字型檔。四席是本機切換，共用池可玩，網路多人尚未完成。
