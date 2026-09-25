# Frame Atelier 盲拆評測紀錄

## 目前基準

- 測試畫面：`evidence/hero-loadout.png`
- 視口：1920 × 1080
- HTML 原始區域：13 個
- 可比對區域：12 個（排除整張 `screen` 畫布）
- 盲拆區域：12 個
- 區域召回率：100%（12/12）
- 幾何分數：86.80 / 100（2026-09-21 重跑；stats-panel 與 ability-panel 的遮擋偏差已修正）
- 語意欄位分數：85.21 / 100（欄位級記錄見 `evidence/comparison.json`）
- 平均 IoU：0.8680
- API provider：`pixel-blind-segmentation`
- Gemma 3 是否直接讀取像素：否
- Vision hierarchy：Qwen2.5-VL-3B，本機 CUDA；文字採 region-only，不以 OCR 內容計分
- Recursive trial：最大樹深 3；修正子裁切回傳的百分比／像素座標判斷後，Vision 元件數 65，區域召回約 20.59%，尚未因增加深度而提升精度

## 評分規則

每次測試固定使用同一張截圖與 HTML ground truth：

1. 先比對是否找到對應區域。IoU >= 0.5 算該區域通過。
2. 幾何分數 = 所有應比對區域 IoU 的平均值 × 100。
3. 同時記錄區域召回率，避免只靠少數大面板拉高平均分。
4. 未來增加語意評分：名稱、用途、元素類型各 1 分，和幾何分數分開。

## Frame Atelier atomic pipeline v2

不要讓 Gemma3 一次同時猜「有什麼、在哪裡、用途是什麼、大小多少」。目前工具採用逐欄位的 micro-stage：

1. **元素掃描**：只列出可獨立處理的元素，不輸出座標。
2. **label**：只命名，不改 id。
3. **purpose**：只說明用途。
4. **behavior**：只判斷 fixed 或 dynamic 類型。
5. **dynamic_fields**：只列出可能變動的內容。
6. **fixed_fields**：只列出固定 label、按鈕、icon 位置與結構。
7. **children**：只從已核准元素挑子元素，禁止 self-reference。
8. **component**：只判斷是否可重用與類型。
9. **nine_grid**：只判斷是否適合作為可替換素材。
10. **icon**：只判斷 icon 必要性與用途。
11. **幾何確認**：最後才估算 rect，不能覆寫語意欄位。
12. **規則審查**：檢查邊界、過度拆分與重疊，再交給使用者確認。

每一階段都保留 provider、原始回答、修正後回答、信心分數與 latency；F01/F02/F03 的實跑摘要另見 `evidence/atelier-run-log.jsonl`。

## 下一輪比較項目

- **Grayscale + edge geometry trial**：同一張原圖建立灰階版與邊緣版；原圖只負責語意，灰階／邊緣只負責 bbox。比較加入幾何校正前後的 mean IoU、父子框違規數與小元件召回率。
- 實測結果：灰階 + Canny 35/110 + 3x3 close 一次，mean IoU **77.15 / 100**、通過率 **75%**；目前盲拆基準為 **86.80 / 100**、**100%**。edge-only 不適合作為唯一來源，但可作為裝備槽、卡片與面板的 bbox 校正候選。
- 目前已增加真正的 Vision Model；下一輪改進重點是小元件 bbox 的座標校正、父子關係穩定化，以及讓它辨識「頭盔、胸甲、武器」等語意。
- 對同一畫面加入文字、背景、裝備槽、重疊元素等難例。
- 讓 Gemma3 只負責語意與決策，將像素座標交給視覺模型或幾何後處理。
- 下一個最小實驗：先固定元素清單，再逐一確認單一元素 bbox；禁止同一個 Vision call 同時新增元素與估算所有尺寸。
- 每次執行都追加到 `evidence/evaluation-log.jsonl`，用分數、召回率、平均 IoU 與語意正確率比較版本。
- 若某個 micro-stage 表現不好，只重跑該欄位；不必把整個 frame 重新猜一次。

## Guided hierarchy 實跑

這次不以「盲拆像素分數」作為主要判定，而是測試使用者粗框後，工具能否建立可消費的樹：

- 輸入：3 個粗框父 panel、`max_depth=3`、`max_scans=12`。
- 輸出：3 個 root panel、36 個 hierarchy nodes、最深 4 層；局部掃描結果保留在 `vision.children`。
- 每個節點提供：`parent_id`、`children`、`rect`、`role`、`label`、`purpose`、`contains_text`；另外提供 `summary.composition` 描述直接組成。
- 第二次重跑將局部 Vision 回覆上限降到 560 tokens，避免長 JSON 截斷；並用父節點 namespace 穩定同名 card／list 的 id。
- 可直接查看輸出：[guided-hierarchy.json](D:/Projects/Unone/_Tools/frame-blind-test/evidence/guided-hierarchy.json)、[guided hierarchy HTML scaffold](D:/Projects/Unone/_Tools/frame-blind-test/evidence/guided-renderer/hierarchy-scaffold.html)、[Unity importer](D:/Projects/Unone/_Tools/frame-blind-test/evidence/guided-renderer/UnoneHierarchyImporter.cs)。

這個測試也說明一個重要限制：粗框本身若沒有涵蓋正確 panel，AI 會忠實地在錯誤範圍內展開；因此粗框是結構提示，不是最後尺寸答案。接下來應讓使用者先修正 root panels，再重跑它們各自的 children。
