# 榛姨風格 ImageGen 圖示

使用內建 `image_gen.imagegen`，逐張生成。參考圖為 `assets/formal-ui/quartermaster-v1.png`。

原先 `HAZEL-ICONS-20260915.md` 的 201 個圖示資源是程式生成的 SVG；本次改為真正的 ImageGen 插畫。進度與最終採用檔案以 `hazel-imgen-manifest.json` 為準，不能以原先 SVG 的標記判定已完成。

## 視覺規格

- 榛姨的手繪切面、暖金邊光、深青綠陰影、赤褐皮革與苔綠布料。
- 建築保留一眼可讀的屋頂及店招輪廓；藥水用瓶形、液體色彩與功能徽飾區分。
- 每個技能和授予它的裝備共用一張主題圖，方便玩家從商店認出已熟悉的效果。欄位與名稱仍區分物品及技能。
- 104 張原畫對應 201 個圖示資源；同義的 HUD 與庫存圖示共用圖檔。
- 採用深森林綠的實色圖底。透明底的試稿輸出含有畫出的棋盤格，未採用；本版不宣稱具有透明 alpha。

## 檔案與工具

- 初始提示詞：`hazel-imgen-jobs.json`；採用版本的最終提示詞保存在下列 manifest 各項目。
- 生成來源及資源對應：`hazel-imgen-manifest.json`。
- 逐張生成回執：`../art-source/hazel-imgen-receipts/`。
- 重繪回執：`../art-source/hazel-imgen-revisions/`。紅蓮火種匣初稿被畫成披風，第二稿明確改成盒形；舊原稿及提示詞保留於 previousVersions，正式資源改用 r2 圖檔。
- 原始 PNG：`../art-source/hazel-imgen-v1/`。
- 遊戲載入 PNG：`../assets/formal-ui/imgen-v1/`。
- `tools/import-hazel-imgen.mjs` 僅保留原稿並縮小成 256 px，沒有以程式重畫、調色或去背。
- `tools/build-formal-ui.mjs` 最後套用上述對應表；重建舊 SVG 不會覆蓋遊戲使用的新插畫。

重新匯出：先執行 `node tools/collect-hazel-imgen.mjs`，再依序執行 `node tools/import-hazel-imgen.mjs`、`node tools/build-formal-ui.mjs`、`node tools/finish_export.mjs`。

## 驗證

`node tools/capture-hazel-imgen.cjs --complete` 檢查所有圖示對應、實際城鎮／景點／商店／裝備／戰鬥的載入與 UI 診斷，並產出 150 px 與 40 px 的原畫目錄供目視檢查。未完成全部資源時，`--complete` 會拒絕通過。

本次只改遊戲美術資源與匯出流程；沒有新增引擎能力或修改戰鬥規則。

## 完成紀錄

2026-09-15 已採用 104 張不同的內建 ImageGen 原畫，對應全部 201 個圖示資源（6 張建築、21 張共用物件與屬性、77 張裝備／技能主題圖）。104 個原稿 SHA-256 皆不同；紅蓮火種匣採用第二版，初稿另留存。正式 256 px 圖片合計約 12.8 MiB，依畫面需要載入，沒有把完整原畫送進遊戲。

`capture-hazel-imgen.cjs --complete` 已通過，未轉換資源數 0；實際城鎮、景點、商店購買、裝備及戰鬥載入正常，844×390 橫版亦無資源或 UI 診斷錯誤。所有圖示已逐頁檢查大圖及小圖，成果在 `tests/hazel-imgen/hazel-icons.png`、`catalog-1.png` 至 `catalog-5.png` 與 `review.json`。遊戲已重新匯出到 dist/web。
