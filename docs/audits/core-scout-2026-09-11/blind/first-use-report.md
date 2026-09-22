# Public Core 首次操作報告（定稿，不評分）

這次以公開文件及同機器現有 binary，在全新 C: OS temp 空目錄建立合成 starter，完成以穩定 ID 操作、輸入觀察、錯誤修復、revision 重試、暫時編輯、watch 分頁、recording/replay 與 headless 效能查詢。共 8 次一次性 CLI、1 次 session 程序啟動、22 個 session request；連啟動計 31 次操作。沒有進行第二輪盲測或修改產品。

本報告定稿後不再改寫；後續 probe 或角色審核須使用別的產物。`first-use-seal.json` 記錄首次資料的 SHA-256，並對相關檔案設唯讀屬性。這是可檢查的凍結快照，並非不可變儲存服務或簽章。

## 範圍與前置資訊

- 工作根目錄：`C:/Users/liNao/AppData/Local/Temp/unone-public-core-845180e493514dc38b934b3526692ee2`；遊戲在其 `game/` 子目錄。所有 fixture、harness、raw log 都在 C:。
- 操作 binary：`D:/Projects/Unone/target/release/game.exe`，27,043,840 bytes，最後修改 2026-09-10T07:10:58.450Z，SHA-256 `6af56a589c4a39d3f16e176cfb2fc817ef7fcbbe7836e160c516973e86cc8c8e`。Session 自報 engine version `0.1.0`。本機 Windows x86_64，transport 使用既有 Node v24.14.1。
- 先讀根目錄 AGENTS.md、README.md，再由 README 讀公開的 `docs/ai-workflow.md`、`docs/developer-session.md`、`docs/profiling.md`、`docs/runtime-contracts.md`。沒有讀 Rust/JS 實作、既有 audit、rubric、分數或真實遊戲。Developer-session 公開文件本身含歷史 verification 段落；未開其鏈接證據。
- 讀取公開文件的第一次批次輸出被工具截斷；我把 developer-session 重新讀全，之後對已保存的 CLI schema / search 輸出做欄位選取。此工具顯示限制沒有截斷保存在磁碟上的 CLI raw bytes。
- README 導向的官方 `project init` 足以提供本次極小合成案例：一個 `example` 實體，初始 x/y=0；Luau 持續 Right 時加 dt；兩個 seed42 / 60-frame idle 與 input 測試。沒有新增引擎能力或把 gameplay 移入 Rust。
- 沒有 GPU、瀏覽器、外網、provider、帳號、下載、packaging、bundle install、Rust build、真實遊戲、既有服務重啟或 repo 產品檔寫入。

## 原始證據位置

`events.jsonl` 保存依發生順序的程序開始/結束與 stdin/stdout/stderr chunks。`raw/001-*.json` 到 `raw/008-*.json` 保存每次 CLI 的 executable、argv、cwd、UTC、exit code、完整 stdout/stderr。`raw/009-session.stdin` / `.stdout` 各有 22 行，逐行一對一；`.json` 保存完整 session 程序資訊。PTY 顯示曾有 ANSI 換行/echo，但這兩個 raw 檔記錄的是子程序管線資料，沒有由終端畫面抄錄。

`fixture-before-session.json` / `fixture-after-session.json` 保存五檔原文與 hash。`first-use-session-pairs.json` 是由 raw 逐行解析的方便閱讀版本，原始 raw 保留不變。`binary-identity.json` 保存 binary 身分。

## 真實探索順序：CLI

| 次序 | 命令／動機 | 實際結果 |
|---|---|---|
| 1 | `--help`，確認現有 binary 入口 | exit0；列出 project/api/schema/verify/perf/platform/session/mcp 等，沒有執行 host |
| 2 | 空遊戲目錄 `--json platform snapshot`，依 workflow 的「先看 capabilities」順序 | exit1、`ok=false`、`PROJECT_CONFIG_NOT_FOUND`；仍回 native/windows/x86_64 Core 資訊及 `renderer_probe=not_probed`，project systems 為 null |
| 3 | `--json project init --name PublicCoreProbe` | exit0、五檔成功建立；回明確 effects 與可直接傳 subprocess 的下一步 argv |
| 4 | `--json verify` | exit1；types=`LUAU_ANALYZER_NOT_FOUND`，assets passed，layout not_applicable，tests 2/2 passed；失敗 gate 沒有擋掉其餘 gate 的結果 |
| 5 | `session --schema` | exit0；取得 request/selector/operation/input schema，未知欄位禁止；依 schema 和 session 文件組 request |
| 6 | `--json api search "move entity"` | exit0，19 個 matches，含 getPosition/setPosition 完整語義，也含 remove/spawn/physics 等较寬結果；此查詢 raw 為 24,132 bytes |
| 7 | 再次同名 `project init`，檢查重試邊界 | exit1、`PROJECT_ALREADY_EXISTS`；phase preflight、created_files/directories 空、effects 空 |
| 8 | 建好後再次 `--json platform snapshot` | exit0、`ok=true`，顯示專案系統 default/effective、compiled/host-required 等；仍不探測 renderer |
| 9 | `session`，保持程序以連續送 JSONL | 成功啟動，後續 22 對 request/response 如下 |

第一次工具入口成功是 #1 help。第一次完成作者動作是 #3 init，UTC 2026-09-11T11:39:22.428Z（本地 19:39:22）；從第一個 CLI 開始約 16 秒，這不是包含讀文件及建立 harness 的完整 onboarding 時間。第一次輸入驅動行為成功是下表 P04。

## 真實探索順序：Session

S1=`18d44174db7d5e14-1`；重新 open 後 S2=`18d4418f52aed174-3`。表中 P 編號就是 `009-session.stdin` / `.stdout` 行號。所有 selector 使用 fixture 真正存在的 `example`，没有猜成文件示例的 `player`。

| Request | 操作 | 真實結果與當時判斷 |
|---|---|---|
| P01 | open seed42 | S1、revision0、frame0、cursor1、x0、headless / runtime / temporary_debug_state_patch / luau_and_input |
| P02 | snapshot example `/transform` | x0/y0，仍 revision0/frame0 |
| P03 | step rev0 frames30 Right，故意多給 `framse:30` | `DEVELOPER_REQUEST_INVALID`；explanation 列明 unknown field 和允許欄位，effects 空 |
| P04 | 刪除 `framse`，同 rev0 step30 Right | 成功30 ticks；revision30/frame30/cursor31，example x0.5/y0；說明錯誤 request 沒有消耗 tick/revision |
| P05 | 原樣重送 P04，仍 expected_revision0 | `REVISION_CONFLICT`，facts actual_revision30 / expected_revision0 |
| P06 | snapshot example | frame30/revision30/x0.5、digest 同 P04；重送沒有又移動 |
| P07 | step rev30 frames1 input={} | frame31/revision31，x仍0.5；Right 被釋放，cursor仍31（無純 frame/time delta） |
| P08 | watch after29 limit1 example `/transform/x` | 回 sequence30 / frame29 delta；`cursor=31`、`next_cursor=30`、`has_more=true`，current snapshot 已是 frame31/x0.5 |
| P09 | watch after30 limit1 | 回剩下 sequence31 / frame30 delta，next_cursor31、has_more=false；current 沒有前進 |
| P10 | enact rev31 dry_run=true，set_position x10/y0 | before0.5/after10 的 JSON pointer diff；revision仍31，沒有 tick |
| P11 | snapshot example | x仍0.5、frame31/rev31/digest不變；確認 dry-run 沒有 mutation |
| P12 | 相同 enact rev31 dry_run=false | commit 成功，revision32/cursor32/frame31；位置 diff0.5→10 |
| P13 | step rev32 frames1 Right | frame32/revision33，x10.016667；Luau input 繼續作用於暫時狀態 |
| P14 | perf | 32 frames，1 entity / 0 rigidbody / 0 UI；timing、memory 和 measurement_scope 成功返回 |
| P15 | recording | 4 個 accepted commands：step30、release step1、enact、step1；包含32個 tick digests及 enact digest；沒有 queries、dry-run、兩個被拒 request |
| P16 | 用 P15 value 原樣組 replay | `identical=true`、script_changed=false、engine_version_changed=false；獨立 replay world 的 x10.016667/frame32 |
| P17 | snapshot 原 S1 | frame32/revision33/x10.016667、digest 同 P13；replay 沒有改動當前 session |
| P18 | close S1 | closed=true |
| P19 | open seed42 | S2，frame0/revision0/x0，初始 digest 同 P01；暫時 edit 丟棄 |
| P20 | 用舊 S1 snapshot | `SESSION_MISMATCH`；explanation 要求使用 open 回的 session，cursors/revisions 屬於該 session |
| P21 | 用 S2 snapshot example | x0/y0，frame0/revision0；scene 提供的 entity ID 仍可用 |
| P22 | close S2 | closed=true |

P01/P19 初始 digest：`sha256:f851964c2dcf02d0c010c21eac19599128f3463898f6b9ef4f6456c1f179e52e`。P13/P17 最終 digest：`sha256:6e52462fc36b2f9a033da59dd0d44faed8d246ae01625538243135a877eb341b`。

## Wrong guess、缺檔與修復

真正的首次順序落差是 #2：我按「先 platform snapshot」在未 init 的空目錄執行，得到 project config 缺檔。它還提供了有範圍標記的 binary 能力資訊；init 後 #8 相同 snapshot 成功。這不是 engine crash。

沒有非故意的 API 方法名稱誤猜；方法、欄位、selector 都來自公開 docs、schema、search 或生成 fixture。P03 的 `framse` 是刻意負例，不能充當自然發生的使用者錯誤。P05 的舊 revision、P20 的舊 session、#7 init retry 也是刻意邊界測試。

`verify` 缺少 official analyzer 是未解的依賴限制。結果給安裝脚本及 UNONE_LUAU_ANALYZER 指向既有工具的建議；本任務明確禁止下載/build，且沒有提供可用 analyzer 路徑，所以不尋找或安裝外部工具、不更改 verify gate。這次沒有通過完整 verify，也沒有驗證完整 Luau 靜態型別檢查。

## Headless 效能資訊

P14 的真實單次數值為 mean_frame_ms=0.009、p95_frame_ms=0.044、luau_memory_bytes=457288、luau_positive_heap_delta_bytes_per_frame=511、frames=32、frames_over_budget=0。資料有 script / physics / observe phase，release profile，明示排除 rendering、transport、developer diff overhead；timing 不進 observation digest。

這證明此 binary 的 session perf 查詢能提供對 headless 調查有用的成本和規模資料。它不是負載測試或效能基準，沒有暖機/重複控制；一個無畫面 entity 的 32 ticks 不能外推容量、真實遊戲瓶頸、穩定 FPS 或跨平台速度。回傳欄位另有 `sustained_fps=113675.1`，只能在上述 headless timing scope 閱讀，不能解讀為已顯示的畫面 FPS。Replay 有自己的 timings，沒有把兩個小樣本的差距當改善。

## 主觀首次體驗與能力邊界

完成這個案例時，公開入口足以讓我不翻 source 操作。init 的五檔與下一步 argv、session 的 generated schema、每次回應的 session/revision/frame/digest，以及具體錯誤代碼，讓後續動作可根據先前結果決定。`example` 的穩定 ID 與相對 JSON pointer 很直接；watch 特別需要讀文件，因 newest cursor 與 next_cursor 不同，且最新 snapshot 可比 page 內事件新。

發現的摩擦是首次閱讀資料量大：#2 snapshot 23,338 bytes，#8 snapshot 36,631 bytes，schema 26,000 bytes，搜尋 move entity 24,132 bytes且含多個 remove 類項目。自製 capture/欄位選取讓本次可讀，這些 transport 工具不是產品提供的圖形體驗。錯誤回應有時 facts / suggested_actions 為空，但 `framse`、revision、session 的 explanation 已足以完成這次修復。

本次實際驗證的是同 binary、同 Windows 主機、這個 starter、固定 seed、指定 input/enact 序列。Platform 回報的 compiled/available/verified 是它的 scoped 自述；我沒有逐一執行 physics3d、jobs、audio、Spine、Effekseer、particle、asset decoding、Web、Android、iOS、renderer 或 MCP。也沒有測 pointer、script fault 後的部分狀態、journal overflow、跨 process session、任意 entity lifecycle。成功 replay 是這四個 accepted commands 的等價，不是所有平台或所有遊戲的 determinism 證明。

Revision 防止本次原樣重送造成重複 mutation；它不是 request-id 結果快取，也不代表任意逾時重試會自動成功。Enact 在本次沒有永久寫入能力：五檔 before/after SHA-256 全部相同，重新 open 從原場景恢復。

## 收尾

P22 已正常關閉 owned runtime；stdio transport 仍等待 EOF。自製互動 harness 沒有預設 EOF 控制捷徑，因此查驗父子程序與精確命令列後，只停止自己的 idle `game.exe` PID30216（父 Node PID22000）。父 harness 隨子程序結束退出，查驗兩 PID 均已不存在。`009-session.json` 的 exitCode=4294967295 是這個收尾 termination，timedOut=false；不能把它當成 session request crash。未停止既有服務，沒有刪資料；fixture 和 raw 全數保留。

首次紀錄到此結束。另行撰寫且尚未執行的 `replay-probe.mjs` 不屬於首次探索原始證據。
