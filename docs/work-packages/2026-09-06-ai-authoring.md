# AI authoring 回饋判讀與第一個可交付切片

版本：v1 / plan_review_pending。Baseline：`c187df8`（上一輪 asset 修正仍待
Rust 回歸／平台重建／封裝盲驗）；本文件不是已交付功能或取代現行契約的規格。

## 判斷，不照單全收

主代理已讀現有 CLI/MCP、project/world/runtime/verify/UI/API source、schema、
roadmap，並用現有 CLI 做獨立小型 probe。CLI 是 `4a128d7` 的 build，相關
init/search/scene 路徑在 c187df8 未變；不宣稱新 asset patch 已編譯。
[實測資料](../evidence/2026-09-06-ai-authoring/initial-probes.json)。

| 第三方主張 | 核對結果 | 決策 |
|---|---|---|
| 沒有建立新遊戲的單一入口 | 不成立：`project init`／`unone_project_init` 已有。但只產生 config/script/空 scene，test_files=[]；實跑 verify 回 TESTS_NOT_CONFIGURED | 補完原入口的 starter test 與下一步，不能另造 game new/create/scaffold 同義入口 |
| scene 只能改 JSON，需 mutation/template/prefab | 沒有 authoring CRUD/prefab 屬實；但 JSON 本身不是 AI 缺陷，已有 scene schema、runtime entity.spawn/despawn/get/set。實測誤寫 position 卻成功留在原點，真正風險是 silent input loss | 先收緊共用 scene ingestion，不加任意 JSON patch/CRUD、prefab graph 或第二套 scene truth |
| 沒有音訊 | 成立：公開 API/types/system 沒有 audio；roadmap #1 未交付 | 保持必要引擎能力的高優先級，獨立垂直切片，不偽裝成遊戲端播放音效 workaround |
| 缺通用動畫 | 部分成立：animation.play/stop 與 Spine state 已有，但不是通用 sprite frame/UV animation，沒有通用 timeline/atlas pipeline | 基本 fixed-tick sprite animation 另案；不因而先做 timeline editor 或全功能圖形動畫系統 |
| Web/native/Android 畫面驗證不一致 | 成立，不能用 digest 相同推論貼圖/字型真的畫對；native 解碼尚未上屏，host rotation/scale/layer 尚有缺口 | host 分層建立相同 fixture 的呈現驗證，先 2D，不要求不同 GPU/字型輸出逐像素完全相等 |
| 3D 不夠完整 | 成立於 production pipeline，不是完全沒 3D：Camera3D/Mesh3D/Transform3D 已有，資產/材質/光照/碰撞工作流未完整 | 以賽車驗證所需的 mesh/material/light/collision 最小集合推进，不在此次 onboarding 切片實作 |
| UI 只剩最小功能 | 部分成立：已有 text/button、anchor、100x100 logical coordinates、hit-test、layout/text-fit 觀測；native/mobile renderer 缺口更大 | MVVM 狀態/flow 在遊戲，幾何/輸入/傳輸在引擎，繪製/字型在 host。不補完整 CSS/widget framework |
| 動態內容逃過檢查 | 成立，但靜態檢查不可能證明任意 Luau 路徑。runtime 已有 typed/API/input/observation 檢查 | 保留 static/runtime 範圍；測真正使用的 input/save/branch，不做猜字串的全域 validator |
| 缺狀態與除錯工具 | 過度概括：run/observe world、api.log lifecycle trace、replay record/diff、perf/UI preview 已有；缺持續 session stepping/聚焦 entity inspector | 先改善現有 discovery／文件；只有最小重播仍定位不了的實例才推 persistent debugger，不先做 runtime eval console |
| 不容易測碰撞與物件位置 | 位置可直接用 transform.x/y assertions；contacts/ground_contacts 可觀測，input_sequence 可重播。但內建斷言範圍有限、沒有完整像素 gate | 不把所有測試重寫成圖像比較；之後依物理反例擴窄 assertion vocabulary，不做任意 eval 判決插件 |

## 本輪推進順序與 gate

0. **先完成既有資產工作流 gate。** c187df8 是明示 WIP，不能在未編譯候選上
   再堆大量功能。D 槽仍約 0.27 GB；清理唯一 incremental cache 的授權待回覆。
   本輪可完成查證、計畫盲審與文件修訂，計畫獲准不等於繞過此依賴開工。
1. **本工作包第一切片：可靠 authoring 起點。** 改 existing init、scene ingestion、
   API search 空結果 feedback；製作由 Luna/max，主代理規劃/整合/驗收。
2. **後續 engine/host 排序，不是本輪偷偷開工範圍：** 先關閉已開的 2D
   transform/layer/asset 上屏差距，以同 fixture 逐 host 驗證；音訊隨後為獨立
   垂直切片，與通用 sprite animation 分開。不能將能力缺口永久降成 docs 問題。
   這些 host 切片不含一次性補完所有 UI/3D/iOS；不可因尚無 iOS 而无限阻塞
   可用 host 的小切片，也不可把未測的 iOS 宣稱通過。
3. runtime debug / test vocabulary 以具體重播卡點決定；UI 與 3D 由 AVG／RTS／
   賽車的真實需求逐項拉出契約。完整七款 final gates 仍維持原驗收矩陣，不降格。

第一切片的價值是「初次使用成功、打錯時不能假成功」，不是「已有完整商業引擎」。
不接受外部建議的絕對排序：scaffold 已有，不能因缺 prefab 就把音訊/渲染無限延後。

## A：既有 project init 成為可測試的起點

不新增命令或 template registry，保留 `project init --name` 與 MCP 同一 core。
只接受不存在或真正空的目錄；已有任何內容（包括 .git / GAME_PLAN.md）均拒絕，
不能自動清理或 merge。企劃與 package 放在 output 之外；git 可在 init 成功後建立。
此為明確 empty-root contract，不提供 force/overwrite/容舊模式。

只產生五個 game-owned authoring files：

- project.unone.json：明示 entry_script/main_scene 和兩個 test_files。
- scripts/main.luau：維持由 canonical engine typings 內嵌的 strict EngineApi；
  start 為空，update 僅示範按住語意 Right 時用 dt 推進 example 的 x（一 unit/秒）。
- scenes/main.scene.json：一個 id=example 的非剛體、無 sprite/asset 的 entity，
  transform=(0,0)。它是 headless starter marker，不宣稱畫面上有圖片。
- tests/bootstrap-idle.test.json：60 frames/seed42，沒有輸入，x/y 保持 0。
- tests/bootstrap-input.test.json：60 frames/seed42，Right 按住，x=1/y=0。

測試使用既有 assertions，不能空 assertions 或只 assert true 來湊 verify 綠燈。
它們只證明 starter 可執行與输入/位置路徑，**不**證明新遊戲玩法已驗收。
example id、Right 行為、兩份 tests 都是可替換的 starter 檔案，不進 engine runtime。
移除 marker 時作者須相應換掉示範 tests，不能保留冒充真遊戲覆蓋。
不產生未用到的 asset manifest、美術、empty bundle、UI/save/下載 policy。
authoring creation 與 bundle activation 分離，不在 init 隱式 pack/install。

成功 report 以實際 files 為準，補 `workflow_scope=new_unmodified_scaffold`、
每份檔案的 project-relative path/用途，以及 `suggested_next_actions`：
初始 verify → bundle pack → bundle install --all → bundle inspect。
每個 action 使用 logical executable=game + argv array（--project 絕對 root、--json）
與 prerequisite/reason，不拼 shell 字串，不自動執行。文件說明此順序只適用
剛產生且未改內容的 starter；開始新增資產後回到 asset-workflow 的
pack → verify/strict → install 流程，不能造出先 strict 後首次 pack 的死結。
這只是小型 command 資料，不抽全域 workflow service/狀態機，也不借用
AssetWorkflowAction 之名使 project tooling 看起來屬於 asset subsystem。

寫入安全：預先準備 bytes/檢查 root；用 create_new 防覆寫；錯誤要列出已建立
的 files/directories（effects/facts），不能稱跨檔案 atomic 或零副作用。
不自動 rollback/delete，失敗時先報真實狀態。不存在 root 的祖先與 canonical
path 要可定位；在本操作單 writer 假設下防既有 symlink/reparse 路徑逃逸，
不宣稱能防任意第三方同時替換 filesystem 的 transaction。

## B：共用 scene ingestion 嚴格，不新建 scene editor

禁止本場景 JSON 的未知欄位被悄悄忽略：root/entity/transform2d及3d/sprite/
rigidbody/camera/physics/animation 等目前 scene authoring 物件逐層納入。
依既有 typed wire model 與 schema 處理；優先用 serde deny_unknown_fields，
不是另維護一份 allowed-field 名單或加入通用 JSON Schema runtime。
共享 Vec2/Vec3 等若也用於其他入口，製作者需核對受影響 caller，新增對應回歸；
不得為 scene 特製一堆平行 DTO 或意外改變 runtime Lua table 任意欄位的規則。
若兩個邊界真的需要不同契約，回報主代理處置，而不是默默擴規格。

entity id 不可空白且同 scene 不可重複。集中在純 scene validation，包含現有
semantic checks，在 World 修改前拒絕；不得讓後一筆默默覆寫前一筆。
shared parsing/validation 要覆蓋 disk runtime、payload host、pack/靜態 reference
的 scene 入口，從同一 SceneFile 契約得到相同拒絕，不在 CLI 補獨有 guard。
只抽既有 scene validation，不做場景切換、prefab inheritance、批次 mutation
或 scene graph transaction。也不新增物理 shape/rotation solver。

語意錯誤至少含 code、source file（若有）、serde line/column、未知欄位與允許
欄位的 explanation；id 錯誤含 entity_id、index/first_index、JSON pointer。
禁止把 position 猜成 transform 後代修，因為猜錯看起來也會成功。
不能宣稱本輪實作完整 JSON Schema validator 或涵蓋所有動態 Lua 分支。

## C：找不到 API 時能回到正確入口

不新增 api list 同義命令、不改 search 的匹配策略。已存在的空字串查詢
`api search ""` 是完整索引；CLI help/MCP description 明說此用途。
API_SEARCH_EMPTY 保留成功查詢 + warning（無匹配不是 engine 壞掉），但
facts 標示 search_scope=public_engine_api、query、match_count=0；explanation
提醒玩法動詞可能是 game-owned composition，無匹配不能證明引擎缺少能力。
suggested_actions 提供現有全索引查詢與 systems list；不能捏造近似 API，
也不能要求呼叫未知名稱的 api describe。命令是固定字串，不插入使用者 query。
core 共用結果建構，CLI/MCP 不複製同一 warning 規則；不另建 embedding 搜尋或 ontology。
教學移除「任何 API 找不到都必然 blocker」的絕對說法：先依現有索引拆成
primitive；企劃確實需要不存在的 engine capability 才立即回報，不自行重造引擎。

## 文件、分工、審查與證據

- 主代理：本分析/計畫、原反例、問題分類、review disposition、roadmap/devlog。
- 計畫 reviewer：全新 Luna/max，不繼承對話，只讀計畫、必要 repo 契約與 source。
  檢查最小性、AI 可操作性、source/host 邊界、未知欄位影響、no-overwrite 與驗收。
  回報具體反例/阻礙，主代理採納或附依據駁回，再限定覆核；不要求零缺陷背書。
- 製作 gate 放行後，Luna/max 依非重疊 write sets 做 A、B、C；共用 project/world/
  API 入口先指定 owner，不能同時改同檔。主代理只做整合，不把所有權模糊丟給代理。
- README/ai-workflow/ai-agent-game-handoff/MCP/help/packaging 同步改成實際產物；
  舊三檔空場景規格直接移除，不留 obsolete/deprecated 副本。歷史只保留於
  Git 與有日期的 devlog，不改舊 immutable package。新 current contract 一份。
- periodic Claude CLI review 與 source-only/package-only 審查分開；不能用未實跑的
  code review 抵掉平台/test gate，也不能用 #30 抵掉既有 deferred #29。

## 驗收（不能降低）

1. 先完成 asset WIP 回歸/平台封裝盲验依賴；再開始本輪功能開發。
2. unit/integration：新/空 root、空 name、已存在 file/dir/link、重跑 init
   均拒絕覆寫；故障注入後 report/effects 對得上已寫入內容。含空白與Unicode路徑，
   argv 直接給 subprocess 可執行。CLI/MCP 完整結果一致；不修改原始 probe。
3. 新 starter：官方 analyzer types pass、兩份 deterministic tests pass、verify
   不再 TESTS_NOT_CONFIGURED；不同 Right/no-input 的位置有差，修改成錯誤移動量
   時 test 真會 fail。同 seed/input digest 相同。沒有 asset/UI 的狀態明確不適用。
4. scene：正確 JSON 原行為不變；root/深層 typo/空或duplicate id 拒絕且 world
   不變；typed runtime/payload host/pack/reference reader 使用共同入口。盲評者
   不須靠猜欄位、讀 engine source 或自造 scene tool 才能修正。
5. 新候選本地 commit 後重建 CLI/Wasm/mobile，產生來源版本一致的新 immutable
   package；hash/inventory 驗證與該候選 source review 均完成。
6. **全新 package-only Luna/max 盲評**：只給包、玩法企劃與空 output，做一個
   2D 位置/輸入小遊戲；自行找初始入口、改 scene/Luau、寫不同於 starter 的
   成敗測試，發佈完整 generation；第一次 typo/no-match/重跑 init 都保留證據。
   立即回報 blocker 後停依賴步驟，可繼續不受影響案例，不給答案或 source。
7. browser/host 實跑與新截圖有各自 scope：starter 的無 sprite marker 不能
   冒充畫面驗證，真正盲測遊戲的 asset/render 用已驗證 package 能力實測。
   保留首次失敗、修正、再測與開發日誌，七款總驗收不因本輪通過而變 passed。
