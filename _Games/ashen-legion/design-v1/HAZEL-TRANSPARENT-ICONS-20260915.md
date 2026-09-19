# 榛姨風格透明圖示

本批沿用使用者確認的短劍插畫：暖金、赤褐皮革、苔綠、象牙色金屬，以及清楚的手繪明暗切面。完整目標為 **181 張獨立原畫，對應 201 個 UI 資源 ID**：77 張裝備、77 張技能、6 張建築、21 張商店／屬性／操作圖示。

已完成 **181 / 181 張原畫、201 / 201 個資源 ID**，`hazel-transparent-manifest.json` 的 `generationComplete` 為 true。

## 裝備與技能

裝備呈現具體物件：刀劍、長柄武器、頭冠、護手、靴子、護甲、披風、法杖、藥匣等。每張必須符合遊戲中的物件名稱與用途。

技能呈現動作、衝擊、元素反應或增益。例如疾行靴是皮靴，疾行技能是帶殘影的奔跑；火焰斗篷是披風，技能是環身火焰。同一能力的裝備和技能使用不同原畫與不同材質路徑。

## 生成與保存

- 使用內建 `image_gen.imagegen`。批次工作由 3 個 Luna 子代理分工，主代理負責提示詞校正、部分技能生成、整合與驗收。Luna 降低的是代理協作成本；圖片生成本身仍由 ImageGen 執行，沒有把模型費用宣稱為已知金額。
- 保留已確認的短劍與可用的透明火焰技能試作，避免重複生成。
- 裝備採用已確認短劍的透明 PNG 作為替換參照；建築採用透明市集圖；技能使用簡潔的動作描述。每張實際提示詞、參考圖與原始工具來源都保存在 receipt。
- 原畫必須是工具直接回傳的 RGBA。沒有使用本機去背、色鍵、背景重繪或把棋盤格交成成品。
- `art-source/hazel-transparent-v2/` 保存原始生成檔，SHA-256 必須與工具來源一致。
- `assets/formal-ui/transparent-v2/` 是供遊戲使用的等比例 256 px PNG，只縮圖、不修改原圖的透明邊界或配色。
- `art-source/hazel-transparent-attempts/` 保留各次嘗試和檢查結果；`hazel-transparent-receipts/` 只收錄通過 alpha 檢查、已選入的原畫。失敗嘗試不會出現在新 manifest。

## 可重現流程

在 `_Games/ashen-legion` 執行：

```powershell
node tools/collect-hazel-transparent.mjs
python tools/package-hazel-transparent.py
node tools/build-formal-ui.mjs
node tools/build-hazel-transparent-gallery.mjs
node tools/finish_export.mjs
node tools/capture-hazel-imgen.cjs --transparent --complete
node tools/capture-hazel-transparent-catalog.cjs
```

收集器要求每張獨立原畫有唯一 SHA-256，資源 ID 不能重複；配對驗收要求所有技能與其裝備原畫分離。透明檢查包含 alpha 範圍、透明像素比例與畫面邊緣覆蓋。另以深淺兩種底色、縮小尺寸及遊戲實際介面做目視檢查。

## 檢視入口

- `http://127.0.0.1:8190/art-review/`：可搜尋、分類、比較裝備與技能的素材圖鑑。這是開發檢視頁，遊戲本體維持原有 Unone UI。
- `tests/hazel-transparent/gallery.html`：相同圖鑑的本地入口。
- `tests/hazel-transparent/catalog-*.png`：淺底／深底圖表。
- `tests/hazel-transparent/equipment-skills-*.png`：裝備／技能對照。
- `tests/hazel-transparent/review.json`：最近一次實際遊戲 UI 驗證結果；請看其中數量確認該次是部分還是全量驗收。

## 全量驗收

2026-09-15：181 張原画全部通過原生透明、原始檔 SHA-256、唯一來源、縮圖 alpha、遊戲資源對應檢查。77 組装備／技能使用不同圖片。8 頁淺底／深底圖表已逐頁目視檢查，包含修正後的直立暫停符號及黑油技能完整輪廓。

`tests/hazel-transparent/review.json` 記錄 181 張、201 個資源、0 個遺漏，原生 UI 的城鎮、景點、商店、配置、戰鬥與手機橫版均正常載入，沒有 UI 診斷錯誤或頁面錯誤。另以真實滑鼠操作通過購買、裝備槽選取、裝備／符文轉交、返回商店、出售及出戰：`tests/shop-loadout/browser-report.json`。

透明原畫與收據均保留；未使用本機去背。實際提示詞與參考圖列於 manifest 和每張 receipt，可供後續重現。
