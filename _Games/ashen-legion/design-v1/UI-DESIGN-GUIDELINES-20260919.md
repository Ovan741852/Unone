# 正式 UI 設計準則

這份準則是 `ashen-legion` 正式 Unone Canvas UI 的共同基準。座標不是像素，而是 100 × 100 的 normalized design space；`formal-ui.luau` 最後再由 host 映射到實際畫布。

## 1. 版面與安全邊界

- 所有節點必須落在 `0..100`；主要視窗保留至少 4 units 的外框安全邊界。
- 視窗內容的標題列預留 5 units，底部操作列預留 7–8 units；正文不要貼住視窗邊緣。
- 橫版基準以 1440 × 900、1280 × 720、900 × 600、844 × 390 驗證；保留資訊順序，窄版摘要可省略但詳情必須完整。
- 視覺背景可以滿版，但互動元件不能用背景作為命中區域。

## 2. 間距 token

| Token | Units | 用途 |
| --- | ---: | --- |
| `s1` | 1 | 同一組內的最小卡片／欄間距 |
| `s2` | 2 | 圖示與文字、文字與數值 |
| `s3` | 3 | 同一資訊區塊之間 |
| `s4` | 4 | 區塊與區塊、標題與正文 |
| `s6` | 6 | 視窗內側留白、主要分段 |
| `s8` | 8 | 視窗底部操作區與內容區 |

實作規則：

- 同列卡片使用一致寬度與一致 gap；不得讓最後一張卡貼到視窗邊緣。
- 裝備店視窗為 `(6,6,88,88)`。四張卡使用 `14.75w / 51h / 1.0 gap`，整列由 `x=28,y=29` 開始，最後一張右界為 `90`，不能超出視窗的右界 `94`。商人欄為 `x=10..26`。
- 卡片內容必須被自己的底板包住；卡片與下一列操作區至少留 1 unit 的垂直空間。
- 文字不可跨越相鄰卡片；需要換行時先縮短文案或增加卡片高度，不用負 margin 疊字。

## 3. 資訊層級

- 卡片只放：名稱、部位／技能摘要、價格、派兵費變化、詳情入口。
- 稀有度用底板色表達；不要再增加一排會和說明重複的 badge。
- 完整故事、發動條件、效果與購買行為放進詳情視窗。
- 購買只顯示真實語意：商店按鈕是「買入」，買入後到部隊配置穿戴；不能寫成「買入並裝備」。
- 一個部位最多一件裝備，介面不顯示疊加數量，也不提供會造成誤解的 stack counter。

## 4. AABB／命中區域規則

以 `tools/verify-shop-components.cjs` 的正式 Web player 驗收為主。`tools/verify-shop-layout.mjs` 是需 native CLI 的附加檢查，不能用只看 normalized 節點的結果取代實際字形驗收。

- 背景、視窗底板、卡片底板與自己的文字／圖示重疊是「有意的父子層級」，必須明確列入 allowlist。
- 不同卡片、不同操作按鈕、不同文字區塊不得有正面 AABB 重疊；邊界相接不算重疊。
- 按鈕的上下延伸命中區只能服務同一個 action，不能跨到相鄰按鈕。
- modal scrim 可以覆蓋背景，但必須位於詳情視窗之下；詳情視窗內的關閉／買入／取消按鈕彼此不能重疊。
- 每個互動節點都要檢查 bounds、命中區域與同層 sibling overlap，不只檢查肉眼看到的文字。
- 卡片必須完整包含在視窗內，內容也必須完整包含在卡片安全區內；完全落在父框外也必須報錯，不能只檢查相交的項目。
- 測試截取正式 Canvas 的每次 `fillText`，用實際字形邊界驗證 clipping。裝飾與字框分開；不能靠裁掉字形來通過。

## 5. 共用元件／Atlas 契約

- `presentation/ui-components.mjs` 是共用切片與文字規則，`ui-skin-data.mjs` 是切圖器生成的來源尺寸；`ui/formal-ui.luau` 的 `nineSlice`／`button`／單一商品模板負責組裝原生 image、text、button 節點。
- Atlas 是來源區域管理，不會自動排版。本次沿用引擎支援的獨立切片；不為了打包成一張圖而新增一套 renderer。
- 視窗按設計像素等比縮放邊框；商品卡保留完整上方徽章比例，只延展中段；按鈕按統一高度計算角落比例，只沿寬度延展中段。禁止用目標寬高的 16% 同時當四角尺寸。
- 按鈕來源先去除透明留白，所有商店按鈕統一 `5.5h`。長寬可依用途不同，但同列高度、四角比例、字級和文字安全區一致。
- 按鈕字形避開左右固定角；完整底板都可點，文字帶與上下 hit 區使用同一 action。
- 卡片內容左／右至少 `1.75`，上方徽章保留 `8.5`。名稱最多一行，摘要桌面三行、短橫版兩行，超出加省略號；詳情保留完整效果，不無限制縮小字體。
- 字寬以實際 Canvas `measureText` 測量，字型必須與正式 renderer 相同。英文／數值如 `12`、`30%` 不拆成零碎行。
- 卡片框、圖片、說明、數值和按鈕為同一動畫組。遮罩和視窗底材不套 hover/press 放大。
- 視窗使用安靜的不透明深綠底材，外圍保留模糊遊戲背景；不要把小塊紋理整張放大。
- 官方參考：[Unity 9-slicing](https://docs.unity.com/en-us/engine/6000.3/manual/unity2d/sprite/9-slice)、[Godot StyleBoxTexture](https://docs.godotengine.org/en/stable/classes/class_styleboxtexture.html)。區分 texture margin 與 content margin。

## 6. 交付前 checklist

1. 更動素材切線時先執行 `node tools/slice-shop-assets.mjs`。
2. `node tools/build-formal-ui.mjs`；成功後才執行 `node tools/finish_export.mjs`，任一步失敗不可繼續交付。
3. `node tools/verify-shop-components.cjs`：四解析度 × 商品列／四件詳情、購買／回執、六個進場時間點和長文案；報告為 `tests/shop-layout/components-report.json`。
4. `node tools/verify-formal-ui.cjs`：真實滑鼠購買、換裝、出戰回歸。若 native CLI 存在，另跑 `verify-shop-layout.mjs`；全局歷史 findings 與本次變更分開記錄。
5. 目視 `components-1440.png`、`components-844.png` 及詳情截圖，與已確認的 v4 視窗排版對照；AABB 通過不代表美術驗收自動通過。
