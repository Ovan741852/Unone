# Frame Atelier 拆解流程紀錄

這份紀錄用來回答兩個問題：目前工具採用哪一種拆解方案，以及錯誤發生在流程的哪一段。每次改動後，測試輸出會追加到 `evidence/evaluation-log.jsonl`。

## 目前方案：atomic semantic pipeline v2

目標是把「看見什麼、它叫什麼、它做什麼、會不會變、包含什麼、能不能重用、能不能九宮格、尺寸多大」拆成最小責任。Gemma 3 每次只處理一個語意欄位；流程仍由瀏覽器依序串接。

1. `element_scan`：只決定有哪些可獨立處理的元素，不輸出尺寸。
2. `label`：只替已核准元素命名，不改 id、不增加元素。
3. `purpose`：只描述每個元素的用途。
4. `behavior`：只判斷 fixed 或 dynamic 類型。
5. `dynamic_fields`：只列出會變的內容；例如數值、清單、冷卻、槽位內容。
6. `fixed_fields`：只列出固定 label、按鈕文字、icon 位置與版面結構。
7. `children`：只列出已核准元素中屬於它的子元素；不允許創造不存在的 id。
8. `component`：只判斷是否為可重用元件與元件類型。
9. `nine_grid`：只判斷是否適合生成九宮格素材，控制項與文字一律不列為素材。
10. `icon`：只判斷是否需要 icon，以及 icon 代表什麼。
11. `size_confirmation`：最後才估算每個元素的 rect；不能改語意欄位。
12. `rule_review`：前端檢查 rect 是否在父 frame 內、是否過度拆分，交給使用者採用或保留。

## Vision hierarchy pipeline v1

目標不是還原文字，而是把一張 UI 截圖變成 renderer-neutral 的介面樹，供 HTML、Unity Prefab、Godot 或其他 renderer 使用。

1. `pixel_parent_scan`：用像素幾何先找父面板，作為穩定的掃描範圍。
2. `vision_full_scan`：Vision 找畫面的主要元件；文字只回傳 `contains_text`，不把 OCR 文案當結構主鍵。
3. `vision_children:<parent>`：一次只掃一個父面板內的子元件，降低小元件漏檢。
4. `recursive_container_scan`：對子結果中的 `panel / card / list / nav` 再開一層掃描，最多深度 2、最多 24 次局部掃描；子框使用父框裁切後的座標轉換。
5. `hierarchy`：輸出 `layout-hierarchy.v1`，每個節點包含 `id`、`parent_id`、`children`、`rect`、`role`、`label`、`contains_text` 與信心分數。

目前已提供單一 `stage: hierarchy` API；輸入一張 screenshot，回傳 `hierarchy`、扁平 `elements`、每段 pipeline 結果與原始回答。HTML／Unity 轉換層只需要消費這份樹，不需要依賴 Vision 模型。

## 為什麼改成這樣

先前的語意階段同時要求 label、用途、動態性、子元素、共用元件與九宮格，Gemma 3 可能只完成其中一部分，且很難知道漏在哪裡。現在每個 micro-stage 都只回傳 `id` 加一個欄位，後端保留前一階段結果，任何單段失敗都不會清掉其他段結果。

## Guided hierarchy pipeline v1

這一版加入「人類粗框當父節點」的互動方式，對應使用者實際標記 panel 的習慣：

1. 使用者在畫布上粗略拉出一個或多個 panel，名稱與用途可以先寫得很粗。
2. `human_rough_panel_roots` 把粗框轉成 `screen` 底下的根節點；粗框不是要求像素級精準，而是告訴 AI 掃描範圍與父子關係。
3. `vision_children_per_panel` 一次只讀一個 panel，找出它直接包含的 heading、list、card、button、icon、metric 等單位。
4. `recursive_container_scan` 對子結果中仍像容器的 `panel / card / list / list_row / nav` 再往下掃，直到葉節點或深度／掃描上限。
5. `composition_summary` 為每個節點保留直接子項目，回答「這個單位由什麼組成」；每個節點也保留 `purpose`，回答「這個單位負責什麼」。
6. 輸出仍是 `layout-hierarchy.v1`，所以 HTML、Unity Prefab、Godot 或其他 renderer 都只需要消費同一份樹。

目前前端的「⌘ 依粗框展開整張畫面」會把畫布上的頂層 frame 送到 `stage: guided_hierarchy`；不用 Computer Use，也不用把 DOM 傳給模型。`y` 座標在送出前會從畫布的 bottom-origin 轉成影像的 top-origin。

實跑證據：`evidence/guided-hierarchy.json`。以 3 個粗框、最大深度 3、最多 12 次局部掃描測試，輸出 3 個根 panel、36 個節點、深度 4；第二次修正後局部 JSON 不再因回覆過長而整層遺失，並為遞迴節點加入 parent namespace，避免同名 card 互相覆蓋。

## Frame-first generation pipeline v1

這次把主流程從「圖片反推介面」改成「人類需求先定義，AI 逐層安排」：

1. `human_brief`：人類只填介面名稱、畫面要做什麼、最重要資訊、系統／數值／必須出現；不要求人類先想 panel 或座標。
2. `panel_plan`：Gemma 3 只決定 3–6 個 panel、每個 panel 的責任、優先級與 16:9 版面位置；不處理子元件。
3. `panel_children`：一次只處理一個已核准 panel，決定 2–8 個直接子元件、用途、資料來源、動態性與相對位置。
4. `frame_first_hierarchy`：把 panel 與子元件轉成可供 HTML／Unity／其他 renderer 消費的樹；圖片分析不參與這條主流程。
5. `generated_preview`：用 hierarchy 產生不依賴截圖的介面骨架，讓人類先檢查責任與版面，再進入美術／素材生成。

測試案例：`英雄裝備介面`。人類輸入「查看英雄狀態、替換裝備並準備出戰；強調英雄身分與目前裝備；包含生命、攻擊、防禦、裝備槽、背包、出戰按鈕」。最新實際產生 5 個 panel、16 個子元件、21 個 hierarchy nodes；結果已保存於瀏覽器 local state，可由 Frame Atelier 的 command bridge 查詢。Gemma 產生的 panel JSON 本次格式不穩，panel／子元件內容使用受控 fallback 補足，來源會保留在 hierarchy provider 欄位，不能視為純 Gemma 結果。

本次新增 `panel_review` 與 `geometry_governor`：Gemma 先提出 panel，下一階段只檢查幾何，不允許改 panel 語意；若模型把主要內容擠在左上或留下明顯空白，geometry governor 只修正位置與大小，不改 panel 名稱、責任或角色。最新根 panel 版面為左側英雄狀態、右側上下堆疊裝備／背包、底部行動區、頂部導覽區，已填滿 16:9 工作範圍。

跨 panel 去重試驗：`panel_children` 仍維持「一個 panel 一次 API 呼叫」，但每次會收到前面 panel 已完成的 `component_registry`。registry guard 會攔截未標記的重複元件；本次 `裝備槽` 使用「裝備清單／裝備列表」，`背包` 改為「背包內容／物品格／物品格位」，不再把同一組子元件直接複製。若未來真的要共用，必須明確回傳既有 component id 或 reuse 標記。

## 評測規則

- 幾何：每個可比對區域的 IoU，平均值乘 100。
- 語意：分別記錄 label、purpose、role、behavior、dynamic/fixed fields、children、component、nine-grid、icon；不把語意錯誤藏在單一總分裡。
- 每次評測固定使用 `evidence/hero-loadout.png` 與 HTML ground truth。
- `blind` 路徑只讀截圖像素；不能讀 DOM、HTML 或測試答案。
- Gemma 3 文字模型不會直接讀像素，因此像素框由 CV 候選產生，Gemma 3 負責受控的語意分類。

## 已知限制與下一步

- Vision 3B 已接通；它對小元件可以產生區域與粗分類，但目前仍可能把一個元件框估得過大或漏掉技能列，需用 renderer-neutral hierarchy 與 HTML ground truth 持續校正。
- 下一個待試版本：保留原圖給 Vision 做元素／用途判斷，同時把同一張原圖轉成灰階與邊緣圖；灰階用來降低色彩干擾，邊緣圖用來尋找 panel、卡片、按鈕與列表的實際幾何邊界，最後再把校正後 bbox 回填 hierarchy。
- OCR 目前刻意採 `region_only`：文字是否存在、文字區塊在哪裡比內容本身重要；具體文字可在後續由 OCR adapter 選配。
- 若某個 micro-stage 的正確率低，可以只重跑該 stage，不必重做整個流程。
- 後續每次調整都應同時保留：版本名稱、pipeline stages、latency、幾何分數、語意分項與失敗欄位。

## 歷史

- v1：元素掃描 → 語意分類 → 尺寸確認；一次回傳多個語意欄位。
- v2：拆成上述 atomic micro-stage；加入可查詢工作紀錄與欄位級評測。

## 實跑紀錄摘要

- F01：4 個元素、12 個 stage、約 104 秒；成功保留裝備槽與角色的 dynamic、共用元件、九宮格候選與 icon。
- F02：2 個元素、12 個 stage、約 123 秒；辨識出裝備卡列為 `dynamic_list`、卡片操作為 `fixed`，並列出 `DETAILS`／`EQUIP`。
- F03：1 個元素、12 個 stage、約 73 秒；辨識出主要操作為 `dynamic_state`、可重用、需要 icon 且不做九宮格。
- F03 另發現 Gemma 偶爾會把父元素自己列入 children；現在 schema review 會刪除 self-reference 與未核准 id。
- Gemma3 在部分 micro-stage 會回合法 JSON 但漏掉要求的欄位；解析器現在保留已知候選值並標記 `gemma3-local+fallback`，不再把不完整答案誤報成完整模型答案。
- F03 修正後重跑：1 個元素、12 個 stage、約 48 秒；`children` 已變成空陣列，且 `lastAnalysis` 已保存到 frame state，可透過 command bridge 查詢。
- Vision hierarchy v1 實跑：全圖 1 段 + 父面板子掃描，共輸出 59 個 Vision 元件；目前小元件區域召回約 21%，可用來作為第一個可追蹤基準。
- Recursive hierarchy trial：節點由 71 增至 81，最大樹深由 2 增至 3；發現子掃描常回傳 0–100 百分比而非 0–1，已加入百分比／像素自動判斷。修正後目前輸出 65 個 Vision 元件，召回仍約 21%，表示下一步應做「候選元素辨識」與「單元件尺寸確認」分離，不能只增加遞迴深度。
- Grayscale + edge geometry trial：原圖轉灰階、GaussianBlur 3x3、Canny 35/110、3x3 close 一次；24 個幾何候選的 mean IoU 為 77.15%、通過率 75%，低於目前盲拆 86.80%／100%。它對角色區、裝備槽、軍械庫與屬性面板貼合良好，但容易漏掉 topbar、hero-panel 與 ability-panel；因此下一版採原圖／灰階／邊緣混合，不會完全改成 edge-only。
- Semantic virtual grouping trial：先固定 `hero-panel` 為父節點，再把 6 個 Vision 子元件交給 Gemma 3 推測隱形群組；Gemma 本次回覆不是有效 JSON，因此啟用語意幾何 fallback。只在角色相容、水平重疊至少 0.55、垂直間距不超過 5% 時建立群組。結果產生 `數值與進度區`（level + XP bar，confidence 0.78）與 `摘要與操作區`（set summary + equipment card，confidence 0.779），沒有新增重複 hero panel。證據：`evidence/hero-panel-virtual-groups-result.json`。
