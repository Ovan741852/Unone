# AI authoring 回饋判讀與第一個可交付切片

版本：v2 / plan_review_closed, implementation_in_progress。Baseline：`c187df8`；
上一輪 asset build／封裝與限定驗證已關閉，見 predecessor-gate.json。
本文件不是已交付功能或取代現行契約的規格。
Luna/max 限定複審未發現未解的具體計畫 blocker，見
[審查處置](../reviews/2026-09-06-ai-authoring-plan.md)；不代表功能／產品已通過。

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
   再堆大量功能。使用者已手動清空 incremental，D 槽確認恢復約4.48GiB；
   前案 Rust/clippy/CLI、平台重建、封裝盲驗與主代理覆核已完成。
   計畫獲准不等於繞過此依賴開工。
   退出證據指定為 `docs/evidence/2026-09-06-ai-authoring/predecessor-gate.json`：
   必須記錄實際 tested commit（c187df8 或修正它的 descendant）、Rust 回歸結果、
   CLI/Wasm/mobile 各自 build 的 source commit/hash、新 immutable package 的
   identity/inventory、package-only 盲驗證據與未測平台範圍；前案不得仍是
   build_blocked。證據已建立；首輪raw紀錄缺口與重跑證據明確分開，未測平台不填passed。
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

成功 `EngineResult.value` 固定為 project/root/files，加
`workflow_scope="new_unmodified_scaffold"`、`suggested_next_actions`。
root 是檢查過的 absolute path。files 使用專屬 init entry，不改供 inspect 使用的
ProjectFileStatus；每筆 `{path, role}`，path 為 project-relative `/` 路徑，
role 分別為 project_config/entry_script/main_scene/bootstrap_idle_test/
bootstrap_input_test，依 path 排序。只報實際完整寫成的五份檔案。
每個 next action 的固定欄位為 `{executable, argv, reason, prerequisites}`：
初始 verify → bundle pack → bundle install --all → bundle inspect。
每個 action 使用 logical executable=game + argv array（--project 絕對 root、--json）
與 prerequisites（先行 action 的零起算 index array；第一步 []，之後 [0]/[1]/[2]）
及人／AI 可讀的 reason，不拼 shell 字串，不自動執行。文件說明此順序只適用
剛產生且未改內容的 starter；開始新增資產後回到 asset-workflow 的
pack → verify/strict → install 流程，不能造出先 strict 後首次 pack 的死結。
這只是小型 command 資料，不抽全域 workflow service/狀態機，也不借用
AssetWorkflowAction 之名使 project tooling 看起來屬於 asset subsystem。

寫入順序與部分失敗固定如下，不做全域 filesystem transaction service：

1. 先驗證 name、準備五份 bytes。root 轉 absolute path；拒絕含 parent `..`
   component 的路徑，保留一般 `.` 的正常解析。從檔案系統根到目標逐段檢查
   既有 ancestor 與 root：非 directory、symlink/junction/reparse 均拒絕，
   包含 dangling link；不能先 canonicalize 而掩蓋原路徑上的 link。
   root 已存在時必須真正空，列目錄失敗也不能當空。此階段不建立目錄或檔案。
2. root 不存在時，canonicalize 最近的既存真實 ancestor，再接回已驗證的
   缺少 components，得到固定 absolute root。只建立該 ancestor→root 的
   缺少目錄，以及 root 內 scripts/scenes/tests；逐層 create_dir 並記錄。
   所有五份預定輸出須位於該 root。檔案以 path 排序，逐一 create_new/write_all。
   在單 writer 假設下拒絕既有路徑逃逸，不宣稱能防另一行程同時置換整棵目錄。
3. 失敗時 `ok=false/value=null`，diagnostic.facts 固定含 root、phase
   （preflight/create_directory/create_file/write_file）、failed_path、
   created_files、created_directories；無副作用時兩清單 []。
   created_files 每筆 `{absolute_path, project_relative_path, complete}`，
   在 create_new 成功時就記錄，write_all 成功才 complete=true；寫入途中失敗
   的空檔／部分檔不可漏報或稱完整。created_directories 每筆
   `{absolute_path, project_relative_path}`；root 用 "."，root 外的新增
   ancestors 用 null，root 內用 `/` 相對路徑。两清單各依 absolute_path 排序。
   path 報告以可供 OS 使用的 absolute path 為準，不把 Windows extended path
   prefix 隨意裁掉；relative path 才一律 `/`。檢查 path 尚未成功時 root 可 null，
   failed_path 保留原輸入，不能編造 canonical 結果。
4. EngineResult.effects 在成功／失敗都列本次真正建立的檔案／目錄（同上排序，
   固定字串 `created_directory:<absolute_path>`、`created_file:<absolute_path>`）；
   是否完整由 failure facts 決定。不自動 rollback/delete；retry 不恢復寫入，
   若留下內容就按非空 root 拒絕並說明需先由作者處理，不建議 force 覆寫。

fixture 使用局部 writer 故障注入：至少涵蓋第一檔 create 前失敗、一檔完整後
下一檔 create 成功但 write 中途失敗，核對 bytes/complete/effects 與 retry。
不依賴真實磁碟耗盡，不為測試引入通用 I/O 框架；既有非空 root、link/reparse
與空 name 的 preflight failure 前後內容 hash 不變。

## B：共用 scene ingestion 嚴格，不新建 scene editor

禁止本場景 JSON 的未知欄位被悄悄忽略：root/entity/transform2d及3d/sprite/
rigidbody/camera/physics/animation 等目前 scene authoring 物件逐層納入。
依既有 typed wire model 與 schema 處理；優先用 serde deny_unknown_fields，
不是另維護一份 allowed-field 名單或加入通用 JSON Schema runtime。
明確選擇：SceneFile 可達的 typed JSON 物件與共享 Vec2/Vec3 都採 closed
wire contract，在 serde model 收緊。這會一併拒絕 InputFrame/PointerInput
中的 vector 多餘欄位，是有意的契約修正，需同步 input 文件／回歸；不是只修
scene 的特例。Web/mobile numeric pointer FFI 不經 JSON vector deserialize，
正常數值路徑不變。其餘 opaque game/save/observation data 不因此全面改 strict，
Lua 手動讀 table 的 API 不在這次 serde 變更範圍。不製造 SceneVec2 平行 DTO。

entity id 不可空白且同 scene 不可重複。集中在純 scene validation，包含現有
semantic checks，在 World 修改前拒絕；不得讓後一筆默默覆寫前一筆。
`{}` 與 `{"entities":[]}` 仍是合法空 scene；沒有 main_scene/host scene 的既有
optional 行為不變。只拒絕 id.trim().is_empty()，不 trim/rewrite 合法 id；
duplicate 以原字串完全相同判斷，不改跨次 load 的既有 world merge 語意。

只抽一個 raw-text parse + 一個純 semantic validator（重用現有幾何／physics
checks），不引入 Scene DTO framework。各 consumer 必須滿足此矩陣：

| Consumer | 輸入／共同路徑 | 驗證時點／錯誤 |
|---|---|---|
| World::load_scene（CLI/MCP disk run/test/observe 等下游） | 原始 scene text→parse→semantic validate | 修改 World 前；Diagnostic 帶真實 source file |
| EngineRuntime::load_source* / World::load_scene_data | 已 typed SceneFile→同一 semantic validate | load/start/world mutation 前；typed 值沒有可恢復的 JSON line |
| Web/mobile HostProject payload | 原 envelope 中 scene 改為 optional raw JSON fragment，再進共同 parse/validate | 建立／取代 runtime 前；scene 失敗走既有 write_diagnostic，不走 plain error |
| asset::read_scene_references（含 inspect） | 原始 scene text→共同 parse/validate，再取 typed references | 回報有效引用前；保留 scene Diagnostic |
| asset_workflow::scene_references（describe） | 移除 text→Value→from_value 路徑，直接共同 parse/validate；typed entity index 產生 reference pointer | 回報引用前；不靠 Value 重序列化假造 line |
| bundle pack：有／無 asset manifest | 對已配置的 main_scene 無條件先共同 parse/validate；asset reference checks 在其後 | 任何 pack output write 前；不能只有有 manifest 才驗 scene |

Host 保留现有 envelope，scene 欄位用 serde_json `RawValue`（兩個 host crate
各自開啟既有依賴的 raw_value feature）延後 nested parse，無需第二份場景模型。本地已鎖定的
serde_json 1.0.151 source docs 確認可保留 fragment 格式。完整 envelope 若本身
不是合法 JSON／其他非 scene 欄位錯誤，仍走既有 host error；不順帶重寫整個 FFI。
這不要求不同 host 的外層 transport 相同，只要求有效 envelope 中 scene 的
schema/semantic 錯誤共用 diagnostic code/facts（location context 可不同）。
只抽既有 scene validation，不做場景切換、prefab inheritance、批次 mutation
或 scene graph transaction。也不新增物理 shape/rotation solver。

parse/schema rejection 統一 SCENE_INVALID；unknown field 的 explanation 保留
serde 提供的未知欄位及允許欄位，不另維護名單。blank id 為
SCENE_ENTITY_ID_INVALID，duplicate 為 SCENE_ENTITY_ID_DUPLICATE；id facts
含 entity_id、index，duplicate 另有 first_index，json_pointer 指向
/entities/<index>/id。既有 semantic check code 保留，不藉機改名。
各 scene diagnostic facts 加 source_kind=disk_scene/host_payload_scene/typed_scene、
location_scope=scene_file/scene_fragment/typed_value，line/column/json_pointer
沒有證據時為 null。disk source 使用真實 filename；parse line/column 對應原文。
host source=null，parse line/column 相對 RawValue fragment，另以 pointer_base="/scene"
表明 envelope 位置，不冒充原檔或整個 payload 的行數。typed source=null。
id 語意錯誤有 pointer，無 raw token mapping 不捏造行列；syntax/schema parse
未能精確定位 pointer 時留 null，不為這點增加通用 source-map 系統。
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
parity fixtures：query="攻擊" 在 CLI/MCP 相同 core 結果中都是 ok=true、
API_SEARCH_EMPTY warning、上述三個 facts 與兩個固定 suggestions；query=""
回完整 index 且無 empty warning，既有有效 term 的結果／排序不變。
比對解包後 EngineResult，不要求 MCP transport envelope 等於 CLI stdout。
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
- 使用者另要求：本批實作與基本驗證後，以全新、無持續 session 的 Claude CLI
  做 workflow 架構盲評。只交當時有效的 workflow／contract（init、scene ingestion、
  API discovery、asset/bundle publication、test/reload 與 host 邊界），不交製作計畫、
  先前 review 答案或主代理結論。要求具體操作反例與影響範圍，檢查權威來源、
  engine/game/host 責任、失敗原子性、跨平台一致性與不必要抽象。
  這是 contract-level 架構審查，不冒充 source/runtime 驗證；不擅改程式。
  主代理逐項採納／駁回並記錄依據，需架構選擇的問題詢問使用者後再修。

## 驗收（不能降低）

1. 先完成 asset WIP 回歸/平台封裝盲验依賴；再開始本輪功能開發。
2. unit/integration：新/空 root、空 name、已存在 file/dir/link、重跑 init
   均拒絕覆寫；故障注入後 report/effects 對得上已寫入內容。含空白與Unicode路徑，
   argv 直接給 subprocess 可執行。CLI/MCP 完整結果一致；不修改原始 probe。
3. 新 starter：官方 analyzer types pass、兩份 deterministic tests pass、verify
   不再 TESTS_NOT_CONFIGURED；不同 Right/no-input 的位置有差，修改成錯誤移動量
   時 test 真會 fail。同 seed/input digest 相同。沒有 asset/UI 的狀態明確不適用。
4. scene：B 矩陣共用同組 fixture：有效完整場景、合法空 scene、root typo、
   深層 vector typo、blank id、duplicate id、既有 geometry invalid。typed
   caller 只測可表示的 semantic cases，不假稱 typed 值可測 unknown JSON。
   無效輸入後 world/host runtime 不變；pack 有／無 manifest 都不得新增／修改
   輸出；reference readers 不報假有效。核對 diagnostic code/facts 與真實
   location scope。另覆蓋 CLI/MCP 的 InputFrame pointer vector JSON
   多餘欄位拒絕與正確 JSON pass，Web/mobile numeric pointer FFI 原行為 pass。
   平台無法執行時明示未測，不拿 source review 當 runtime 通過。
5. 新候選本地 commit 後重建 CLI/Wasm/mobile，產生來源版本一致的新 immutable
   package；hash/inventory 驗證與該候選 source review 均完成。
6. **全新 package-only Luna/max 盲評**：只給包、[盲測企劃](../validation/ai-authoring-blind-task.md)
   與空 output；其所有交付證據是必要條件。game-owned player/target、自製或
   使用者授權從 itch.io/game-assets 取得且授權明確的相容素材（須來源／授權紀錄）、
   成功/失敗/停止/restart 測試、一次改壞遊戲規則後 test fail 再還原、
   空白/Unicode path、repeat-init hash 不變、deep typo/duplicate 拒絕、
   no-match discovery、完整 generation/read hash 均須實測。
   starter/bootstrap tests **不計入** game-owned evidence；新 starter 的 verify
   只稱 onboarding smoke。第一次失敗／發現過程保留原證據。
   立即回報 blocker 後停依賴步驟，可繼續不受影響案例，不給答案或 source。
7. browser/host 實跑與新截圖有各自 scope：starter 的無 sprite marker 不能
   冒充畫面驗證，真正盲測遊戲的 asset/render 用已驗證 package 能力實測。
   保留首次失敗、修正、再測與開發日誌，七款總驗收不因本輪通過而變 passed。
