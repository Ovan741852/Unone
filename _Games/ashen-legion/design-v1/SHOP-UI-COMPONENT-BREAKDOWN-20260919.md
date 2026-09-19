# 裝備店 v5 元件拆解

> 本頁保留元件拆解階段的歷史提案，不是現行尺寸與驗收標準。現行 [製作流程](../UI-PRODUCTION.md)與[商店詳細規格](UI-DESIGN-GUIDELINES-20260919.md)優先：摘要最多兩行、短橫版移至詳情；主要驗收為正式 Web 元件及操作測試，native 檢查只在工具可用時補跑。以下「三行」及舊 footer 間距屬當時提案，不可覆蓋後續響應式規則。

這次先不把整張商店畫面直接接回正式 UI。先以目前正式使用的 `quartermaster-v1`（榛姨）作為 style master，將小元件拆開確認，再逐件重做。

## 風格基準

- 主底：墨綠／青綠，沿用 `panel.svg`、`card.svg` 的低飽和布面與顆粒。
- 線條：舊金細線、斜切角、少量半透明光斑；不使用新的細金框系統。
- 動作色：磚紅 `button.svg`，只用在主要行動，不拿來做所有卡片。
- 榛姨色彩：橄欖綠披肩、深青綠衣料、磚紅圍巾、皮革棕、舊金配件。這組色彩是角色與商店的統一參考。
- 稀有度只改卡片底色與邊緣強度，線條語彙保持一致；不能變成冷藍紫主題。

## 元件清單

1. `Window Panel`：主視窗外框與背景布面。
2. `Merchant Panel`：榛姨肖像、名字、短台詞；與商品列保持獨立欄位。
3. `Card Surface`：所有商品共用同一個等高容器。
4. `Rarity Base`：稀有／史詩／傳奇只替換底色與邊緣色。
5. `Item Icon Slot`：固定尺寸與固定垂直位置，不因圖示比例改變卡片高度。
6. `Item Name Row`：單行截斷，不讓名稱推動下方內容。
7. `Description Slot`：固定三行高度；長文縮短，不撐高。
8. `Stat Row`：價格與派兵費固定兩欄、同一基線。
9. `Action Slot`：所有「查看詳情」按鈕固定在同一個 y。
10. `Footer Controls`：刷新與前往配置獨立於卡片，留出至少 `s2` 垂直距離。

## 實作順序

1. 先把 `panel/card/button/secondary` 四個母元件的顏色與線條固定。
2. 重做三種稀有度底板，確認只是換色，不增加新的裝飾語彙。
3. 接四個等高商品卡，先只放圖示與 placeholder，不接長文。
4. 加入名稱、固定三行摘要、價格／派兵費與底部操作槽。
5. 接回榛姨欄位與正式文案。
6. 最後才做詳情 modal、進場動畫與窄版調整。

## 驗收規則

- 四張卡片的 top、bottom、action button y 完全一致。
- 卡片間至少 `s1=1` unit，卡片與 footer 至少 `s2=2` units。
- 所有文字、圖示、按鈕都在自己的 card AABB 內；不同卡片或獨立控制項不得重疊。
- 檢查工具：`tools/verify-shop-layout.mjs`；本頁只作元件視覺確認，不取代正式 UI AABB 檢查。

元件拆解預覽：[shop-v5-component-breakdown.html](layout-previews/shop-v5-component-breakdown.html)
