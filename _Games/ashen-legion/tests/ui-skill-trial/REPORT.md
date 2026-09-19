# UI skill 實測：Impeccable

日期：2026-09-19。對象：森林領主正式 Web 商店（Unone Canvas UI）。

## 修正後驗證 · 2026-09-19

**原報告的三項確認問題已修正並通過本次範圍驗證。** 下方原始分數與問題證據保留作為修改前基準，不代表目前仍未修正，也未將局部修正誇大成全遊戲無障礙認證。

- P1 鍵盤／語意：新增遊戲自己的 Canvas fallback 語意投影，使用同一套正式 action。實測 Tab、Enter／Space 購買、modal 焦點限制、Escape 返回實際商品、出售頁返回、停用購買／重骰；Space 不會穿透為派兵。焦點框跟隨正式 tree 的位置，僅鍵盤操作顯示。Edge 原生 accessibility tree 與 Codex 內建瀏覽器均讀到商品名稱、售價、派兵費及操作按鈕；不是只驗證 DOM 有標籤。
- P2 短橫版：保留榛姨、水平四卡、精細九宮格和置中視窗。低於 500px 高度時重排名稱／圖片／數值／操作，卡面摘要移至完整詳情；不再縮到約 10px。最小輔助字級 14px，主要名稱／價格／操作 16px。圖示不代替完整語意描述。
- P2 卡片可點：圖片、正文與底部按鈕共用整卡 `ShopDetail` action，與卡片同步動畫；modal 遮罩依然攔住下層卡片。已用實際滑鼠及 Edge 合成觸控檢查。
- 追加重骰規則：不限次數，依次消耗 2、4、6、8…結晶。成功才加價；不足不扣款、不換商品。新造訪重設，UI 切頁不重設。費用由 Luau 狀態提供，UI 只讀取，不另算商業規則。已同步 `tests/CURRENCY-SPLIT.md` 與設計準則。

| 尺寸 | 商品列／頁籤／主要操作按鈕高度 | 最小實際字級 |
| --- | ---: | ---: |
| 1440 × 900 | 49.5 px | 16 px |
| 1280 × 720 | 44 px | 14.22 px |
| 900 × 600 | 44 px | 14 px |
| 844 × 390 | 44 px | 14 px |

本次重新執行：

1. `build-formal-ui.mjs`、`finish_export.mjs`：正式 Luau UI 及 Web 匯出成功。
2. `verify-shop-components.cjs`：**29 個案例全部通過**。四尺寸 × 商品列／四商品詳情、購買／回執／遞增重骰、六個進場時間點與長名稱；包含實際字形、不重疊、等高、44px、九宮格比例、全卡命中、視窗安全區。結果 `tests/shop-layout/components-report.json`。
3. `verify-shop-accessibility.cjs`：**5 組操作路徑通過**，含真實鍵盤、合成觸控、直向旋轉、無障礙樹與遮罩攔截。結果 `tests/shop-layout/accessibility-report.json`。
4. `verify-currencies.mjs`：28 項既有 Luau 資源檢查及實際買賣／符文／研究／附魔／重骰動作通過；另以有標示的資源 fixture 連續重骰 8 次，確認沒有一次限制，並驗證不足、切頁與新造訪。舊測試中硬編碼的商品價格和已淘汰的符文直接購買動作改為讀取報價及實際「買入→配置」流程，沒有為測試改掉商品或符文規則。
5. `verify-formal-ui.cjs`：滑鼠購買、換裝、出戰、手動／自動派兵、暫停回歸通過。`git diff --check` 通過。

本輪 Impeccable detector 手動執行一次，仍只有原有載入進度條 `loading-sweep` 的 marquee 誤判；已確認 reduced-motion 替代及完成後隱藏，未改掉合理載入提示。目視核對桌面／中尺寸／短橫版及詳情，保留原核准美術方向，沒有重做設計。

限制：未測實體手機、Safari、NVDA／VoiceOver、200% 文字縮放或 native player；尚未全面量測對比、效能及其他頁面，因此不重算或宣稱完整 20/20 分數。原生 CLI 不在目前路徑，本次驗證為正式 WASM Web player。

---

以下為修改前的原始審核紀錄。

## 結論

**可用，定位是審核助手，不是 Canvas 自動驗收器。** 它的 audit 清單讓本次檢查從「不重疊、不爆框」延伸到實際命中尺寸、鍵盤操作及文案與操作是否一致。這些發現來自按清單檢查程式、瀏覽器和測試資料，不是 detector 自動找出的。

實作一致性判定：**通過（有局部問題）**。保留榛姨、四張水平商品卡、生成素材九宮格、置中視窗與詳情購買；它們是使用者確認的遊戲風格，不套用一般網站的「去裝飾」建議。共用切片、統一按鈕高度、字形量測與動畫群組已有實作。尚缺整張卡片的點擊行為。

正式版已推至 master：遊戲 checkpoint `4a498eb`，整合遠端後 `b100069883db0bd15a54b63298c341bb6b6d0f79`。本次試用只新增本報告與證據摘要，沒有改正式介面、遊戲規則或引擎，也沒有啟用自動修改 hook。

## 候選與安裝

- 選用 [Impeccable](https://github.com/pbakaus/impeccable)：實際安裝並依其 `audit` 指南試用。Skill 4.3.1，來源固定為 `f2c7051853848826aac2f4646581d62a732155ad`，目錄 `.agents/skills/impeccable`。本機位於 `C:/Users/liNao/.codex/skills/impeccable`。
- 比較候選 [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)：偏風格、配色與設計系統搜尋；本次只查閱，未安裝或測試。
- 執行 Impeccable context 與 detector，launcher 使用 engine 0.1.5。沒有 PRODUCT.md／DESIGN.md，但已有 FORMAL-UI.md、UI-DESIGN-GUIDELINES-20260919.md 和正式元件，因此依 skill 的既有介面窄範圍審核路徑繼續，沒有重做設計。
- 下一輪對話可使用 `$impeccable audit` 等指令。

## 健康分數

這是本次人工審核的暫定分數，不是工具自動評分、視覺美感評分或完整無障礙認證。效能未做硬體 profiling，對比未做逐像素量測；不能解讀成全部通過。

| 面向 | 分數 / 4 | 依據 |
| --- | ---: | --- |
| 無障礙 | 1 | 畫布有總體描述，但商店操作沒有可聚焦、可讀取的按鈕語意 |
| 效能 | 2（暫定） | 首屏圖片準備有重用；每次 draw 仍重新量測／排版文字，未量測實際耗時 |
| 響應式 | 2 | 四尺寸幾何檢查通過，但短橫版字與點擊目標太小 |
| 風格系統 | 3 | 共用 skin 契約一致；字型／字色仍分布於 host 與文字量測處。此遊戲未要求換主題，不以缺少亮色模式扣分 |
| 實作一致性 | 3 | 共享元件與真實操作成立；「點選卡片」提示與實際命中區不一致 |
| **總計** | **11 / 20** | **Acceptable：已有可用基礎，仍有易用性缺口** |

確認問題共 3 件：P0 0、P1 1、P2 2、P3 0。最優先補鍵盤／語意操作，其次是短橫版易讀性與卡片命中區。

## 確認的問題

### [P1] 商店沒有完整的鍵盤與輔助閱讀操作

- 位置：`index.html:12`、`host.mjs:80`、`host.mjs:126`。
- 分類：無障礙。
- 證據：實際商店的 accessibility tree 只有畫布影像；DOM 可見可聚焦元件為空。按 Tab 沒有進入商品或操作按鈕。host 僅處理 Space、Digit1–3、Escape 等快捷鍵，沒有商店逐項焦點導航。
- 影響：僅使用鍵盤／讀屏的玩家無法完成「查看商品、買入」流程。Escape 能關閉詳情，不等於整個商店可用鍵盤操作。
- 建議：由正式 UI adapter 提供與既有 action 共用的語意、焦點與確認路徑，包含可見焦點、modal 範圍及返回焦點；不要新增另一套不同步的購買規則。若涉及引擎能力，先依專案 AGENTS.md 分類需求。
- 指令：`$impeccable harden`，完成後重新 audit。未在此宣稱完成 WCAG 全項檢測。

### [P2] 短橫版不爆框，但按鈕和文字仍太小

- 位置：`ui/formal-ui.luau:657`、`presentation/adaptive-ui.mjs:26`、`tools/verify-shop-components.cjs:66`。
- 分類：響應式／易讀性。
- 證據：以已提交的正式渲染 tree 合併 `stock_detail_1` 文字帶與上下 hit 區，計算完整按鈕命中高度，不只計算文字本身。

| 測試尺寸 | 按鈕命中高度 | 最小實際字級 |
| --- | ---: | ---: |
| 1440 × 900 | 49.50 px | 16.00 px |
| 1280 × 720 | 39.60 px | 14.22 px |
| 900 × 600 | 33.00 px | 10.24 px |
| 844 × 390 | 21.45 px | 10.24 px |

- 影響：手指較難命中，派兵費、價格和技能摘要難讀。既有檢查的字級下限 9.8px 及相同按鈕高度，無法證明易讀易點。
- 建議：保留水平卡片方向，另定短橫版最小字級和足夠的命中區；優先讓整張商品卡可開詳情，底部主要操作則調整佈局空間。擴大 hit 區後仍要跑同層 AABB，不能覆蓋旁邊 action。44px 可作本專案易用性目標，不把「低於 44px」直接等同 WCAG AA 違規。
- 指令：`$impeccable adapt`，必要時接 `$impeccable typeset`。

### [P2] 提示說「點選卡片」，但只有底部按鈕有反應

- 位置：`ui/formal-ui.luau:649`、`:657`、`:664`。
- 分類：實作一致性。
- 證據：實際瀏覽器點第一張卡的裝備圖片沒有開啟詳情；點同卡的「查看詳情」成功開啟，Escape 成功關閉。程式也只為底部 button 配置 `ShopDetail` action。
- 影響：玩家按提示點卡片卻沒有回應，小螢幕更難找中底部窄按鈕。
- 建議：把同一個 ShopDetail action 擴至整張卡片，維持 modal 的遮罩／層級攔截；這也符合原本使用者需求，不應只改提示掩蓋行為差異。
- 指令：`$impeccable harden`。

## Detector 結果與誤判

本次只執行一次：

```text
impeccable.cmd detect --json ui/formal-ui.luau presentation/ui-components.mjs presentation/adaptive-ui.mjs host.mjs index.html
```

回傳 1 件 warning：`marquee`，指向 `index.html` 的載入動畫 `loading-sweep`。人工排除：實際是載入中的不定進度條，不是自動滾動內容；`presentation/landscape-host.css:16` 已提供 reduced-motion 靜態替代，完成後載入層隱藏。原始結果保存在 `evidence.json`。

它沒有回報 Canvas 商品的 AABB、字形、安全區或 hit target 問題；因此此次 detector **不能替代** `verify-shop-components.cjs`。沒有 warning 也不代表遊戲介面合格。

## 已做得好的部分與證據範圍

- 正式元件檢查的既有報告有 28 個通過案例，涵蓋四尺寸、四商品詳情、購買回執、長文案與動畫時間點；本輪讀取並核算資料，沒有宣稱重新跑完整套件。
- `host.mjs` 與 `adaptive-ui.mjs` 的來源、目前 Web export SHA256 一致；受審檔案與剛推送版本無差異。
- 本輪實際開啟商店、測 Tab、點卡片與詳情按鈕、Escape 關閉；沒有購買、重骰或改存檔。
- 九宮格四角保留比例、同列卡片等高、文字避開裝飾、完整按鈕底板可點；繼續保留這些專項測試。
- 商店 motion 有 reduced-motion 路徑，重要數值／控制項不等待打字動畫；pointercancel 和 blur 有釋放輸入。
- 小螢幕證據來自既有 Edge 模擬視窗 capture 與本輪讀圖，不是實體手機觸控測試；本次沒有覆蓋 Safari、Android、縮放 200%、全遊戲所有頁面或 native player。

未列為確定故障、留待驗證的風險：Web 的微軟正黑體在非 Windows 上會 fallback；每次 draw 重做文字量測可能浪費時間，但未測出卡頓，不能直接當效能 bug。

## 後續順序

1. `$impeccable harden`：補商店焦點／語意操作，以及卡片本體 hit 行為。
2. `$impeccable adapt`：短橫版最小字級與命中區；保留已確認的美術與商品資訊層級。
3. `$impeccable audit`：結合原有 AABB／字形回歸驗證，重新量測，不只跑網頁 detector。
4. `$impeccable polish`：最後核對視覺與細節。

可逐項、合併或調整順序執行；修正後重跑 audit。若要擴展到其他頁面，再用 `$impeccable init` 記錄產品情境／`$impeccable document` 整理既有設計，而非自動重設整個遊戲風格。
