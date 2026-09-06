# Unone 引擎 roadmap

這份文件記錄**引擎**還缺什麼、順序，以及每一項為什麼在那個位置。遊戲是量具，不是交付物：驗證遊戲存在的目的是找出引擎的缺口。正式驗收 gate 仍以 `D:/Projects/Unone_Games/validation/acceptance-matrix.json` 為準（目前 `not_passed`，七款 final gate 全部 `in_progress`）。

## 判斷標準

1. **提供驗證遊戲真正需要的通用引擎機制。** 音訊、碰撞、渲染等必要能力不能丟給遊戲重造；不因別家引擎有某功能就自動納入。不需要的遊戲可用 `systems` 關掉已支援的系統，關閉開關不是增加無必要功能的理由。
2. **投機性抽象不做。** 指的是照抄別家引擎、對本引擎沒有意義的抽象——例如支援 Unity prefab 或 Cocos2d-x `.csb`。這類需求用**擴充 pipeline** 解決，不進核心契約。基本機制（碰撞事件、摩擦、音訊、旋轉）不適用這條，見[現行資產契約的引擎邊界](asset-workflow.md)。
3. **缺事實時補契約，不要猜。** 檢查工具只能建立在引擎擁有的事實上；需要猜常數的東西輸出**測量值**而不是判決，見 [Decision 0029](decisions/0029-text-layout-gate.md)。
4. **可以做成工具的就不要寫成文件。** 降低判斷、降低出錯率。交接流程已由 `game verify` 取代逐條清單。

## 已具備

三條軸都有工具：

| 軸 | 工具 |
|---|---|
| 操作 | `verify`（一次跑完全部 gate）、`systems list/search/set`、`api search/describe/typings` |
| 除錯 | `ui preview`（ASCII 版面圖 + 重疊偵測 + 修法建議）、`replay record/diff`（指名第一個分歧 frame 與欄位）、語意 diagnostics |
| 效能 | `perf`（script/physics/observe 階段拆解、p50/p95、最慢格、計數、Luau heap） |

引擎機制：fixed timestep、deterministic 重播與 observation digest、seeded random、2D 剛體（重力／damping／地面摩擦與反彈／圓形碰撞／**contact 事件**）、Camera2D（含 `view_height` 取景宣告）、Camera3D 與 Mesh3D、UI tree（絕對 rect 或具名 anchor，自適應）、observation／save 傳輸、Spine／Effekseer 語意表現層、bundle hash/cache/generation、asset manifest 與 archive 讀取、Luau 型別契約（`check --types` 真的會擋）。

Host：native wgpu preview、Web runner／presentation host、Android package host。

## 待辦

新收到的 AI authoring 回饋已逐項核對，見
[分析與第一切片計畫](work-packages/2026-09-06-ai-authoring.md)（v2 已完成限定複審，Luna/max 分工實作中）。
`project init`／位置斷言／observation／trace／replay 已存在，不能標成「完全沒有」。
已重現的缺口是 starter 沒有 tests、API 空搜尋缺指引，以及 scene typo／重複 id
被靜默接受。既有 asset 回歸與封裝限定 gate 已完成，現按審查後的計畫推進；
不因此把下列音訊／host/3D 缺口視為已解決，也不新增整套 prefab/editor。

### P0 — 遊戲做不出來

| # | 項目 | 現況 | 形狀 |
|---|---|---|---|
| 1 | **音訊** | 完全沒有。所有驗證遊戲都是靜音的 | 語意層：`api.audio.play(assetId, opts)` / `stop(handle)`，snapshot 發布正在播的音源清單，host 負責解碼與混音。asset kind 加 `audio`。與 Effekseer 同一個模式（[0028](decisions/0028-semantic-presentation-systems.md)） |
| 2 | **2D rotation / scale 的 host 呈現** | core、Luau API、型別與 schema 已完成；host 繪製尚未接線 | 見 [工作包](work-packages/2026-09-06-2d-transform-layer.md)；顯示變換與碰撞體獨立設定（[0034](decisions/0034-independent-2d-colliders.md)），物理暫不加角速度 |
| 3 | **繪製順序** | core 已有 sprite.layer；host 排序尚未接線 | signed i32 layer ascending，再以 entity id 的 UTF-8 bytes ascending 穩定排序 |

### P1 — 每個遊戲都在重寫

| # | 項目 | 現況 | 形狀 |
|---|---|---|---|
| 4 | **計時器 / tween** | 老虎機、小瑪莉、憤怒鳥都自己數 frame | fixed-frame 計時器：`api.timer.after(frames, key)`，到期以 observation 或事件回報。不做 coroutine |
| 5 | **場景切換** | 只有一個 `main_scene`，不能在 runtime 載入或切換 | `api.scene.load(name)`，project 宣告可用場景；狀態歸屬與 save 的關係要先定義 |
| 6 | **raycast / 區域查詢** | 有 contact 了，但不能主動問「這條線打到什麼」 | `api.physics.raycast(from, to)` / `overlapCircle`，回傳排序後的命中清單 |
| 7 | **sensor / trigger 碰撞體** | 只有實體碰撞 | rigidbody 補 `sensor: bool`：產生 contact 但不解算 |

### P2 — 擴充與精確度

| # | 項目 | 現況 | 形狀 |
|---|---|---|---|
| 8 | **擴充 pipeline** | 沒有。外部格式無處可去 | project 宣告 import 步驟，把外部檔案轉成引擎的 scene/asset 格式；產物再走同一套 `verify`。引擎不學外部格式語意。這是 prefab/csb 類需求的正解 |
| 9 | **非圓形碰撞體** | 只有圓 + 一條地平線；方塊是用圓近似的 | AABB 與線段，先做能表達現有驗證遊戲的最小集合 |
| 10 | **多點觸控 / 手勢** | 只有單一 pointer | 多 pointer id；手勢留給遊戲端 |
| 21 | **可靠的 authoring 起點** | 五檔 scaffold／示範 tests、嚴格 scene 與搜尋回饋實作中，尚未驗收 | [限定計畫](work-packages/2026-09-06-ai-authoring.md) 已完成計畫複審與前案 gate，強化 existing init 與 shared scene ingestion，不另造 scene CRUD 框架 |
| 22 | **通用 sprite frame animation** | 已有 Spine 語意動畫，不等於 sprite frame/UV animation | 根據 2D 遊戲需求另做 fixed-tick frame/state 與 host frame/UV 呈現，不先做 timeline editor |

### P3 — 盲測回報但未修

這些來自兩次盲測（[小瑪莉](issues/2026-09-05-blind-xiao-mary-findings.md)、憤怒鳥），已確認屬實：

| # | 項目 | 說明 |
|---|---|---|
| 11 | 完整 generation 與資產工作流 | 修正候選已通過 Rust/clippy、新 CLI/Wasm/Android 編譯、封裝維護盲評與主代理 native/Web 限定覆核。見[退出證據](evidence/2026-09-06-ai-authoring/predecessor-gate.json)；首輪raw保存缺口及未測平台明列，不等於全平台熱更／七款遊戲通過 |
| 12 | `API_SEARCH_EMPTY` 沒有 `suggested_actions` | 玩法動詞可能沒有匹配，不等於缺少引擎能力。現有 `api search ""` 可列完整索引，但缺 help/feedback 指引；[第一切片 C](work-packages/2026-09-06-ai-authoring.md) 將補共同 CLI/MCP 提示，不新增 api list 同義命令 |
| 13 | `verify` 沒有 host parity gate | package 層已擋下 CLI/wasm 契約不一致（[issue](issues/2026-09-05-package-ships-two-engine-builds.md)），但 `verify` 本身仍只驗證 native build |
| 14 | Web observations 與共用 digest | 已實作並通過 ABI、純 JS output 和新 wasm 瀏覽器 source-mode smoke；immutable package 發行仍待完成。見 [驗收紀錄](devlog/2026-09-06-digest-integration.md) |
| 15 | 世界層沒有 ASCII 地圖 | UI 有 `ui preview`，世界層沒有等價工具；憤怒鳥 sprite 畫到畫布外時沒有任何 gate 抓得到（已由 `view_height` 修掉根因，但仍缺檢查） |

### P4 — 平台

| # | 項目 | 說明 |
|---|---|---|
| 16 | native UI renderer | native preview 完全不畫 UI，只畫純色方塊；Android host 也不畫。UI 目前只有 Web 會呈現 |
| 17 | native 貼圖渲染 | preview 會解析並解碼 `sprite.asset`（印出 verified digest），但不畫出來 |
| 18 | Spine / Effekseer 的 native 與 mobile host | 目前只有 `web/presentation/` 會播；兩個系統狀態是 `host_required` |
| 19 | iOS host | 完全沒有。ABI 契約已定義，尚無實作 |
| 20 | 大型資產串流、CDN、OPFS/quota policy | bundle 目前一次讀入整份；正式發布需求未做 |

## 不做

- 照抄別家引擎的資產格式或場景抽象（Unity prefab、Cocos `.csb`）——走第 8 項的 pipeline。
- 完整 CSS 排版或嵌入式瀏覽器 UI runtime（RmlUi、Gameface）。Web host 已經有真正的 DOM/CSS；native 若之後需要，那是 **host 的實作選擇**，不是引擎契約。決策點推遲到 AVG／RTS 那兩輪，屆時捲動清單與大量文字流會提供實證。
- 使用者可插拔的 verdict 規則。rendering 可以擴充，判決不行——一個因人而異的 gate 不是 gate（[0029](decisions/0029-text-layout-gate.md)）。
- UI 變成 mesh 進入 3D 場景。會失去 DOM 的文字排版、IME、無障礙與「沒有 GPU 也能跑」。

## 驗收

七款遊戲的 final gate 未變：3D 賽車、RTS、放置戰鬥、AVG、自走棋、老虎機、魚機。
憤怒鳥是中期壓測；`4a128d7` CLI 實測 headless verify 6/6 gates 通過，
不代表最新未驗證 patch、host 畫面或不可變封裝已通過，詳見
[本輪驗證紀錄](devlog/2026-09-06-asset-workflow.md)。

每加一項能力，順序固定是：**補契約 → 補工具 → 用一款遊戲驗證 → 盲測確認 AI 能自行操作**。
