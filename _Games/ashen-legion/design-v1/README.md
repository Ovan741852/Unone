# 森林領主 · 系統、介面與向量美術 v1

開啟展示器：執行 `Start.ps1`，或啟動 `node serve.mjs` 後造訪 http://127.0.0.1:8288。

## 已完成

- `SYSTEMS.md`：城鎮／單局資金分流、七輪選路、五種地點、五部位換裝、藥水、詛咒、必要 UI 狀態、製作順序。數值為可調整的第一版設計基準。
- 13 個遊戲介面設計頁，另有素材庫與動畫展示，共 15 頁。支援導航、兵種／部位切換、購買／附魔／換裝確認樣式、素材篩選、動畫播放／暫停／拖曳。
- `svg/`：51 張獨立、可編輯向量素材。沒有嵌入點陣圖片，SVG title 描述用途。
- `animations/`：4 段 shape-only Lottie，文字為輪廓；960×540、30fps、4 秒。
- `manifest.json`：逐項美術清單、用途、尺寸、格式、路徑。
- `previews/`：實際瀏覽器介面截圖、動畫 40f 畫面與檢查結果。
- `tools/build_assets.py`：可重建全部 SVG／Lottie 的美術原稿程式。需要 Python fontTools 與 Windows Arial Bold 字型；輸出播放不需要安裝字型。

這次的交付範圍是規格與美術，不是新城鎮／商店系統已實裝。展示資料、交易對話框、戰鬥構圖均明確標記設計預覽，沒有修改原遊戲金錢或存檔。

## Lottie 引擎狀態

Unone 已確認目前 runtime、Web 與 native hosts **均未支援 Lottie**。官方設計提案：`D:/Projects/Unone/docs/proposals/lottie-ui-v1.md`，commit `d3be213`。本包的 `UNONE-LOTTIE-REQUEST.md` 是交接需求，正式 API 以 Unone 實作與驗收結果為準。

不在 YesSir 實作私人播放器。此設計展示器僅引用上游 `lottie-web 5.13.0`（`vendor/lottie.min.js`），作為離線資產檢視工具；與正式遊戲 host、UI、export 完全分開。播放器 MIT 授權保留於 `vendor/LICENSE-lottie.md`。上游來源：https://github.com/airbnb/lottie-web 。

所有動畫 0f 是刻意透明的入場起點，120f 是透明的出場終點。測試時應驗證 15f／40f／80f 有可見內容，不應要求 0f 非空。標記時間是階段邊界；各金幣有 0–8f 的錯落延遲。遊戲內應用仍由 Unone 提供載入、布局、播放與生命週期；本包只提供來源檔與使用規則。

## 檢查

啟動伺服器後執行 `node tools/verify.mjs`。本機檢查使用 Edge 與已安裝 Playwright：15 頁、55 個資產、4 動畫各 5 影格讀取、播放／暫停、對話框 Esc、素材篩選、桌面／平板水平溢出。結果 `previews/verification.json` 僅證明設計展示器与上游資產播放，不是 Unone 引擎驗收。

原遊戲 `main.luau`、`host.mjs`、`ui.mjs` 與 `dist/web` 本輪未變更。待 Unone 能力交付後，再接正式 `rewardEvents`，保留世界金幣粒子，動畫不參與獎金入帳。

## 流派與演出補充

- `EQUIPMENT-SKILLS-VFX.md`：15 件核心裝備、9 條附魔、觸發／副效果規則、粒子與音效規格。
- `BUILDS-AND-PROGRESSION.md`：20 分鐘七輪、苟活／爆擊／連殺／折返／終結／旋風六路線與跨局養成；新增徵募印記、狂獵戰旗，故候選裝備總數為 17。
- `PLAYTEST-PLAN.md`：真人與數值測試計畫。以上新規則尚未實裝，素材待製作項目有另外標記。

## 怪物外型與動畫設計 v2

`MONSTERS.md` 定義八隻森林怪物的外型、步態、受擊、各獎項反應與骨架需求。`monsters-v2/index.html` 為圖鑑，`monsters-v2/manifest.json` 列出新增八張獨立 SVG，未改原 51 張素材清單。生成原稿為 `tools/build_monsters.py`，概念圖不代表 3D／骨架動畫已完成。

## 數值技能與派兵成本

`STAT-SKILL-DESIGN.md` 收錄數值轉技能候選、合成順序、裝備／附魔派兵加價與 CP 值驗證；這是設計，尚未替換正式遊戲計價。
