# Unone 使用手感紀錄

## 最新補充：人物生活、背包與日夜

- 不改 Rust：Luau `Life` 管時辰、疲勞／睡眠和心情摘要；`Economy` 管真實行囊數量；NanoJev 選擇意圖；Three.js 表示層根據 `day_cycle` 改月光／日光／黃昏色溫與強度。Native inspector 同時增加人物生活欄。
- UI 沿用紙色／玉色；人物面板 330px，六项 meter 有名稱與數字，不只依顏色。日夜時間在窄螢幕也保留。夜景驗收發現標題原先直接疊在暗場景難讀，已補不透明底色。新增內容沒有產生或下載圖片。
- 正式 Luau 道具、購買／消耗、守恆、返家才恢復、白天休息／夜晚睡眠及跨日測試通過；合成指令不當模型品質證據。新模型輸入的真實紀錄：93 次／40 人重播通過，含買乾糧、備藥、吃乾糧、用藥、休息，金錢差額 0。
- 實際夜晚觀察到林墨由 NanoJev 選擇回家休息並熟睡，疲勞降至 0；顧行舟／余小石吃掉乾糧。這只證明機制實際發生，不證明每人會合理作息。職業工具尚無加成，睡覺尚無躺床動畫。
- 本輪在同一 agent 內完成桌面／390px 窄屏畫面檢查，沒有獨立 reviewer。既有小字／裝飾／部分對比 detector 警告未借此擴大成整站重設計；新增文字使用 11–15px、狀態不偽裝為模型內心推理。

## 最新：2026-09-19 NanoJev 人物決策與封閉經濟

本節取代後文關於 heuristic fallback、職業權重和自動社交的歷史描述；模型素材與鏡頭紀錄仍適用。

- 真正載入本機 NanoJev checkpoint（Qwen3-0.6B + decision head），40 人的行為與互動對象改由其機率分布決定，預設 T=1 抽樣。沒有手工權重或模型離線時的規則 AI。模型未就緒時等待，請求未回覆時保留已批准行為。
- Luau 保有世界權威：感知／候選、請求驗證、格路、碰撞、工作與交易、傷害、人際效果。Python 只推論，JS 只顯示。求婚、合作、攻擊、偷竊都要先收到對應模型選擇，不再由遭遇規則自動觸發。
- 120-frame 錯開排程是提交資格，不是回應時間保證。RTX 5080 實測兩人一批約 0.4–0.7 秒，40 人約 10–15 秒一輪，GPU 不阻塞 Luau 更新。根 checkpoint 為導航訓練，尚不具備已驗證的小鎮生活判斷品質；T=1 可能做出不合理行為，不用規則偷偷修正。
- 真實模型紀錄重播：410 次決策、40 人、10,318 frames、16 類行為，總資金差額 0；證據在 `tests/evidence/nanojev-410-*`。這是模型接線與狀態一致性驗證，不是模型智慧評分。
- 封閉經濟含五商號、公庫、四商品、工作工資／生產、消費、稅及急難救濟；起始 6,415 文只轉移不憑空增減，死者遺產仍納入守恆。商品補貨為帳戶交割，未實作實體貨運、銀行或貸款。
- 經濟測試直接執行正式 Luau 函式，覆蓋無錢／無貨、破產雇主、配方耗材、未到站不發薪、遺產及日切。真實決策重播至 21,600 frames／第 3 日／340 筆交易，資金差額仍為 0。導航離散取樣最小間距 2.0，四向路徑與建築避障通過。
- `check --types` 通過（既有非 strict warning）、`verify` 4/4、`test` 4/4；另有相機回歸。合成 transport fixture 只測過期／重複／多選拒絕，不冒充模型推論。
- 人物面板顯示 NanoJev 來源、採用行為／對象與候選機率；小鎮帳本顯示實際交易與守恆。UI 保留既有紙色／玉色風格，新增資訊採可展開明細並檢查窄螢幕。由同一 agent 進行畫面審查，沒有獨立審查者；既有對比／字級警告未宣稱全部修完。
- Windows 同時讀取狀態 JSON 可能短暫擋住 atomic replace；只對 telemetry 做有限重試，不改變或替代人物選擇。

### 給 Unone 的本地能力需求（尚未確認其他 agent 收件）

- 現有 InputFrame 只有布林動作／pointer。NanoJev 回覆暫以帶居民、世代、請求 frame 的唯一 action prefix 傳入，Luau 驗證後採用。希望有通用的具 schema／大小上限／request-id／ack／可重播的結構化外部訊息佇列，避免大量一次性 action 名稱；人物 AI 本身仍屬業務層，不應寫進 Rust。
- 模型機率目前經 sidecar 只讀展示，native inspector 無法完整顯示。上述通用入口與有型別觀測輸出可使 native／browser debug 一致，而不讓表示層接管世界狀態。

## 歷史：2026-09-19 真實模型素材／大鎮／頭頂文字

這一節取代後面歷史記錄的素材數量、場地大小與量測值。

- 遊戲在 `http://127.0.0.1:8088/`，55433 仍是 native debug panel。以 Python 標準庫做 loopback-only、same-origin bridge，重用 Unone `web/renderer/three.js`，不另外實作遊戲引擎。
- 下載兩套 Kenney CC0，匯入 36 個 manifest assets（含 texture）、場景 146 entities；40 NPC 用 12 個人物款式、20 戶住宅與 13 工作地點。來源與限制見 `assets/SOURCES.md`。
- town 80 × 64、walking grid 41 × 33、grid step 2。來源素材曾移到 C:，專案用 junction 保留路徑；没有刪除原始素材。
- renderer 只做表示層：模型／UV／燈光、接地陰影、鏡頭、snapshot 插值、DOM 名牌與詳情。所有需求、A*、佔格、行為及社會事件仍由 native Luau 執行。
- 實際 UI 驗證：名字＋行為 icon 跟隨人物；點選沈長安可見身世、成長背景、喜好、武學、情緒及原因；點「定位這位居民」可近看模型與金色路線。當人多時名牌會避讓，以細線連回角色；懸停暫停標籤位移，pointer-down 就完成選取，避免滑鼠按下與放開間目標移走。
- 修復 Luau empty table 可能回傳 `{}` 的邊界，候選與路徑必須 normalize 為 array，避免點已故居民時 render loop 中斷。
- 發現角色飢餓／疲勞達上限仍被職業分數壓住；增加需求緊迫權重與行為完成遲滯，讓住家→工作→客棧／醫館往返真正在發生。未到站不執行工作、也不隔空交友。
- A* 只在目的變化或受阻時重算；靜態障礙 cache、reroute 使用一次 occupancy map，不在每個鄰居上掃 40 人。
- 回歸 `check-town.py`：1/120/600/1200/2400/4800/7200 frames 全過；相鄰取樣之間移動的人數 40/40/39/36/39/38，活人最小取樣間距 2.0；四向格路、住宅／工作站碰撞檢查通過。並非全 frame 形式證明。
- 最新 headless p95 約 1.1–3.1 ms；4800-frame 一輪有 1 個超預算 frame，不宣稱完全沒有尖峰。瀏覽器實際畫面約 58–60 FPS（cap 60），完整 mesh 已可見。
- `check --types` 通過（原本非 strict warning 仍在）；`verify` 4/4、`test` 3/3 通過。當前 browser reload 之後 console error 0。

### 尚未解決的引擎／美術邊界

- Native CLI preview 仍非完整 UV renderer，native screenshot API 不會拍到這個瀏覽器的 DOM labels；不要把本次 UI 成果當成 native host parity 已完成。
- 目前是 static OBJ mesh 的平移與轉向，尚無 skeletal walk cycle；衣著為通用低模，非歷史武俠定裝。
- NanoJev checkpoint 未載入，當前是可追溯的 heuristic fallback。
- 頭頂 label projection、hit testing、snapshot 平滑與 typed empty arrays 是值得提供共用能力的 Unone 缺口，已在引擎專案 issue 記錄，沒有聲稱另一位 agent 已收件或完成修復。

日期：2026-09-19  
專案：`D:\Projects\Unone\_Games\wuxia-sandbox`  
引擎入口：`D:\Projects\Unone\target\debug\game.exe`

## 實際走過的流程

1. `project init` 很快建立五檔 starter：project、scene、entry Luau、兩個 tests。
2. `systems list` 能一次看見可用／預設開關／Luau API／限制，對決定「這次要不要 physics、jobs、audio」很有幫助。
3. 用 `scripts/main.luau` 寫 gameplay，`api.entity.setTransform3D`、`api.observation.set`、`api.ui.setRoot` 足以做出第一個可觀察的 3D simulation slice。
4. `asset init` 不猜美術也不產生來源；先把既有 mesh／palette 放進專案，再宣告 manifest，接著 `bundle pack`，流程可預期。
5. `check --types`、`test`、`ui preview` 與 `verify` 都能直接從同一個 CLI 跑，尤其 UI preview 會直接指出重疊 node，修正速度很快。
6. `run --frames 120 --seed 42` 可看到 final observation、UI、trace、performance，足夠拿來做 AI agent 的 deterministic feedback loop。

## 順手的地方

- 一個 `Game.start / Game.update` 入口就能快速從空專案走到 NPC simulation。
- observation 是很好的中間層：同一份 `view_model` 同時服務 headless tests、UI、AI 觀察與未來 host。
- deterministic seed + JSON test 讓「NPC 確實選了工作／比武、關係事件有出現」可以被驗證，不必靠肉眼看畫面。
- 3D transform API 很低摩擦；不需要先建立 scene graph runtime，直接用預先放好的 entity id 即可讓 NPC 移動。
- `verify` 把 types、assets、layout、tests 分開報告，失敗原因很容易定位。

## 摩擦與發現

- `project init` 不會自動建立 asset manifest；一旦 scene 使用 mesh，必須自己走 `asset init → bundle pack → asset inspect --strict`。這是正確的責任邊界，但第一次容易以為 starter 已經能直接通過完整 verify。
- primitive mesh 在 strict asset inspect 仍需要被 manifest／bundle 流程解決；本原型改用既有 `blue-infantry` mesh 加 palette 來驗證完整資產鏈。
- UI 的 logical rect 是 0..100，而且 y 軸向上；第一次把右側事件欄放在頂部時被 `UI_NODES_OVERLAP` 擋下，`ui preview` 的診斷很清楚，但需要記住這個座標約定。
- 預設 starter 的 `check --types` 提倡 `--!strict`；本原型為了先快速迭代資料模型保留非 strict，check 會給 warning 但 verify 仍通過。下一輪若接入更複雜的 NPC schema，應補回 strict types。
- `api.ui.setRoot` 是 transport／schema，不是完整 UI framework；文字、按鈕與 normalized rect 很好用，但視覺 styling、字體、互動路由仍由 host／更上層處理。
- `run` 的 debug performance 數字只適合做 smoke，不可當 shipping benchmark；40 人／54 entities、21 UI nodes 在 1200 frames 沒有超過 frame budget。
- native preview 會真的走 host asset decoder；mesh texture 現在使用 PNG palette，preview console 會回報 verified sha256 與 decode 尺寸。
- 建築 manifest 已從 `building-cube.mesh.json` 切到專案內較完整的 `building.mesh.json`；CLI preview 仍是 silhouette host，所以完整幾何要在支援 mesh presentation 的 host 才會看見。
- 格子巡路放在 Luau：40 名居民各自拿唯一出生格與目的格，只走四方向；移動中的下一格也會先 reservation，死亡後的墓位同樣避開活人與其他墓位。
- native preview 會開 tools panel；能看到 frame、54 entities、Lua／render ms，並直接操作「暫停、加速模擬、重設雲水鎮」及切換 Console／Profile／Memory／武俠沙盒分頁。這對 agent 驗證比只開遊戲畫面更有用。
- Unone 的 `game preview` 目前是 CLI 內建的 deterministic mesh-silhouette renderer：它會把 3D entity 畫成有深度排序、面向陰影、地面／建築／NPC 分色的低模盒狀原型，但不載入 mesh UV 材質，也不繪製 semantic UI。完整 textured native player 是另一個 host target。
- native tools 已提供 `POST /request` 的 `{"method":"screenshot","max_width":960,"max_height":540}`；回傳 native renderer fresh PNG data URL、frame、observation digest，且明確標記 `includes_ui:false`。因此 agent 可以直接比對畫素，不需要 Computer Use 或桌面截圖。
- 角色點擊與居民分頁採用 engine 提供的 normalized `0..100` screen pointer，在 Luau 對宣告的 UI rect 做一次命中；這讓 headless replay 與 native host 走同一條路徑，也不需要新增 Rust picking 專用 API。選取變更會立即重新 publish，不等下一個 30-frame simulation publish。
- 40 人版本證實低頻批次是足夠的第一個優化：每個 NPC 的決策冷卻是 120 frames，並用 index phase 分散在不同 frame；數值／關係狀態每 30 frames 執行一次，但 transform movement 每 frame 更新，避免角色視覺瞬移。完整 observation 仍保留 40 人資料，UI 只渲染當前 8 人頁面。
- 「每 120 frames」現在是每人的獨立排程，不是全鎮 broadcast tick；這避免 40 人同時做候選評分造成尖峰，也讓事件時間線更像小鎮日常。
- 關係系統的操作感是「同場才會發生因果」：每 30-frame simulation tick 把同一建築的居民配對，更新好感／信任／怨恨／戀愛／合作／嫉妒；事件會用中文直接寫出動機，例如生存壓力、快錢、舊怨或害怕被取代。
- 600-frame deterministic smoke 已觀察到 102 段關係、98 次合作、6 次謀財、4 次吃醋、2 對結婚與 1 起比武害命；selected NPC detail 同時提供 `motive`、`relationship_summary`、`death_cause`。
- 因果狀態留在 Luau observation contract，不靠 Rust hidden state；之後業務 agent 可替換 `scoreAction` 或 `onEvent`，而不必改 Unone core。
- UI action 名稱在 headless input sequence 中不應假設 host 已完成 action registry；因此角色按鈕保留 semantic action，同時以 pointer hit-test 作為跨 host 的可靠 fallback。這是遊戲層互動，不是引擎缺陷的 workaround。

## 本輪結論

Unone 很適合用來讓 AI agent 迭代「可觀察、可重播的 NPC 規則」：Luau 迭代速度快，Rust 不必被 gameplay 細節污染，verify feedback 也夠具體。它目前最需要 agent 自己記住的是 asset bundle workflow、UI y 軸和 strict typing 的邊界；這些不是做不到，而是需要在專案 README／skill 裡寫成固定 checklist。

這一輪把「角色差異」具體化成可觀察 contract：40 人各有職業、名字、avatar、成長背景、喜好、性格、簡介、武學流派、當下情緒、目的與目標建築；`view_model.selected_npc_detail` 是詳情面板的單一資料來源。建築 occupancy 與 `world_resources` 也會隨行為更新，之後業務 agent 可以在不改 Unone core 的前提下接入尋路、決策或任務系統。

## 驗證紀錄

- `game --project ... --json check --types`：passed，非 strict warning。
- `game --project ... --json asset inspect --strict`：passed，5 assets、54 scene references。
- `game --project ... --json ui preview`：passed，0 findings、21 nodes。
- `game --project ... --json test`：passed，3/3 deterministic cases（含 40 人分頁與 NPC pointer selection）。
- `game --project ... --json verify`：passed，4/4 gates。
- `game --project ... --json bundle pack` + `bundle install --all`：passed，active bundle generation 20，5/5 entries available。
- 格子不重疊 smoke：frames `1/60/120/240/600/1200` 全部 `duplicate_cells=0`；1200 frames 含 4 起死亡，墓位仍無重疊。
- `game --project ... preview --tools-port 0` + native `screenshot`：passed，960x540 PNG、native renderer frame 與 observation digest 可取得。
