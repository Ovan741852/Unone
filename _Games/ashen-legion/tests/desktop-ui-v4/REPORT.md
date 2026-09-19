# 固定桌面 UI 修訂 · 2026-09-19

本輪對應使用者四張圈選截圖與「電腦遊戲，不用自適應」。正式來源已建置並匯出，未 commit／push，未修改使用者存檔。入口：[桌面 v4](http://127.0.0.1:8190/?seed=42&ui=desktop-v4-20260919)。

## 完成的差異

- 唯一 1920×1080 設計構圖；移除手機旋轉及視窗斷點重排。場景、載入、UI、焦點共用 stage 等比縮放與留黑邊；滑鼠使用同一轉換。保留既有模組名稱以減少無關改動，不引入第二套 renderer。
- 研究卡 72px 等比圖示、36px 費用圖示；名稱與效果共用左軸，費用和圖示同垂直中心。建材餘額使用 48px 圖示，與數字緊鄰，不再分居大片空間兩端。
- 新建材圖示依榛姨的精細木材／皮革／舊金語言生成，保留原圖透明度，不以向量圖替代。原稿、runtime、匯出 SHA-256 相同：`894eab1a01be3a99efbefe6c6b71f370b5cb206adfa1c1684940a7d8d8b321f7`。提示詞、風格參照與資源映射見 [manifest](../../design-v1/desktop-ui-v4-manifest.json)。城鎮後景沿用核准的精細商店背景。
- 讀取進度／刪檔確認／設定不顯示或朗讀局內金幣、結晶。城鎮只顯示永久建材；商店仍顯示正確餘額。已同步 YesSir 遊戲內 [資源規格](../CURRENCY-SPLIT.md)，没有改經濟或存檔規則。
- 存檔使用共用精細九宮格卡：標題、提示、三卡共同置中軸；進入／刪除同列等高，但保留主要／次要樣式。文字避開徽章與內金邊。
- 景點三選一改為三張等高直式商人卡，水平排列；整張卡包含肖像皆可點。寬故事底板移除，短句保留在卡列上方；章節、候選景點與隨機規則不變。
- 修正滑鼠離開畫布時未清空 hover 的問題：留黑邊視窗下，開詳情不再讓背景卡片殘留不同高度。

## 實際驗證

| 驗證 | 本輪結果 | 證據 |
| --- | --- | --- |
| 桌面固定構圖與實際操作 | 8 組通過；1920×1080、1280×720、1600×1000、2560×1440 的節點矩形、文字完全相同；等比與置中、點擊、焦點、資源隱藏、三直卡、hover 清除 | [report.json](report.json) |
| 全 UI 狀態、AABB、真實字形及命中底線 | 98 個 Luau/WASM fixture × 唯一 1920×1080；零失敗 | [全頁結果](../all-ui/report.json) |
| 商店正式畫布 | 29 組通過，含四種桌面視窗、四件詳情、購買／回執／重骰、6 個進場時間點與長文案；真實案例最小字級 22 設計像素 | [商店結果](../shop-layout/components-report.json) |
| 商店鍵盤與合成觸控 | 5 組通過，焦點限制、Escape 返回、停用／重骰、留黑邊焦點 | [操作結果](../shop-layout/accessibility-report.json) |
| 全遊戲實際輸入流程 | 7 組通過；存檔／設定、研究確認、地圖、購買、配裝、出戰、暫停／AUTO、按住事件 | [流程結果](../all-ui/interactions.json) |
| 正式 Canvas 滑鼠回歸 | 通過，購買／換裝／符文／戰鬥操作 | [滑鼠結果](../formal-ui-browser.json) |
| 經濟與出戰規則 | 28 項資源規則與真實語意 actions 通過；6 個直接出戰地點與決策守衛通過 | `verify-currencies.mjs`、`verify-quick-deploy.mjs` 本輪輸出 |
| 素材來源 | 8 個角色、3 個核准重用素材、地圖來源及7條路線映射通過 | `verify-character-art.mjs`、`verify-map-art.mjs` 本輪輸出 |

四種視窗是同一桌面畫面的整體縮放，不宣稱四套自適應版面。全頁 fixture 使用正式 renderer，但不是自然遊玩，且不含完整 3D 場景；本目錄 `*-desktop.png`／`*-letterbox.png` 則來自獨立瀏覽器以真正操作走到的畫面。測試存檔只存在隔離的測試頁，不讀取或更改使用者頁面的存檔。

## 目視與設計核對

第一輪一次性彙整問題後作一批修正，最後一輪核對：

- [讀取進度](profiles-saved-desktop.png)：沒有右上錯誤餘額，三張完整精細卡，所有文字／按鈕在內框安全區。
- [三選一直卡](choice-desktop.png)：三卡水平、肖像等比、不碰頂部徽章、簡介在金邊之上，整卡可點。
- [研究頁與留黑邊](town-letterbox.png)：圖示與數字成組、文字同軸、研究卡等高。
- [商店](../shop-layout/components-1920.png)、[詳情與留黑邊](../shop-layout/components-detail1-1600.png)：沿用核准材質和水平卡列，按鈕四角不拉扯，實際字形沒有裁切。

Impeccable 的獨立版面審核與主代理機械掃描共同決定對齊、距離、裝飾安全區；frontend-design 沿用既有美術而非新主題；Ponytail 使修正留在共用組版／輸入而不新增框架。Imagegen 只補建材點陣素材。前後 layout scan 均為 `[]`，只代表掃描沒有命中項目，不能代替以上 Canvas／目視驗收。Git diff whitespace check 通過。

範圍限本機 Edge Web player；未驗證 native 發行版、實體讀屏、200% 文字縮放或其他瀏覽器。此輪不宣稱已完成所有歷史 UX 審核待辦，亦不將既有 `.impeccable/critique` 整份結案。

重現：遊戲目錄執行 `node tools/build-formal-ui.mjs` → `node tools/finish_export.mjs`，開啟 8190 預覽，再執行製作規範列出的測試。新版規範見 [DESIGN](../../DESIGN.md)、[UI-PRODUCTION](../../UI-PRODUCTION.md)、[商店詳細規格](../../design-v1/UI-DESIGN-GUIDELINES-20260919.md)。
