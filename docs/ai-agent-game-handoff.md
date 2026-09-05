# AI game handoff contract

這份規格定義「只拿到引擎封裝結果與一份遊戲企劃」的子代理如何製作驗證遊戲。子代理不應讀取其他遊戲的實作來猜 API；它必須從 engine package 的文件、engine.d.luau、CLI/MCP 的語意結果取得做法。

## 子代理輸入

每個任務只提供：

1. 一份 GAME_PLAN.md，只描述該款遊戲的玩法閉環、必要畫面、語意 action、可重播測試與驗收 evidence。
2. 一份 immutable engine package：`bin/game.exe`、同目錄的 `bin/luau-analyze.exe`、`docs/engine.d.luau`、CLI/MCP 操作文件、`project.schema.json`／`scene.schema.json`／`test.schema.json`、Web runner/wasm host 與必要的 engine decision 文件。
3. 一個乾淨的 game output directory。不可把其他驗證遊戲的程式碼當範本，也不可直接修改 engine source。

遊戲端擁有玩法規則、數值、資料 catalog、ViewModel、View tree、hit-test、save schema/migration 與內容。engine 只擁有 fixed tick、input、ECS/world primitive、Luau 執行／reload、observation/UI/save transport、bundle integrity 與平台 host boundary。

## 第一個動作：先學會引擎

在修改遊戲前，子代理必須先在自己的空 output directory 執行一次 project init，再依序執行並保留 JSON 結果。所有命令都從 package root 執行，CLI 路徑固定是 `bin/game.exe`：

~~~
bin/game.exe --project <game-root> --json project init --name "<企劃名稱>"
bin/game.exe --project <game-root> --json project inspect
bin/game.exe --project <game-root> --json platform capabilities
bin/game.exe --project <game-root> --json api search "<企劃中的第一個動詞>"
bin/game.exe --json api describe <實際找到的 API>
bin/game.exe --project <game-root> --json systems list
bin/game.exe --project <game-root> --json systems search "<企劃不需要的機制>"
bin/game.exe --project <game-root> --json asset inspect --strict
bin/game.exe --project <game-root> --json check --types
bin/game.exe --project <game-root> ui preview --strict
~~~

`project init` 只接受明確的 project name，在空目錄建立 `project.unone.json`、`scripts/main.luau` 與 `scenes/main.scene.json`，不會覆蓋既有檔案，也不會替遊戲猜測玩法。設定檔、場景與 deterministic test manifest 的 canonical JSON Schema 分別在 `docs/project.schema.json`、`docs/scene.schema.json` 與 `docs/test.schema.json`。UI rect 固定使用 normalized 0..100 × 0..100 logical design space，host 不可猜測 960×540；`project.unone.json.test_files` 只列出 project-relative `.test.json`；測試支援 fixed frames/seed、semantic input 或 input sequence、opaque `load_save`，以及 entity transform、observation、UI tree assertions。CLI 內建的 `bin/luau-analyze.exe` 會由 `bin/game.exe` 自動找到，因此 `check --types` 不需要額外安裝或設定環境變數。CLI 沒有的能力不能自行發明；先查 api search，找不到就回報。

最小測試檔範例（完整 schema 仍以 `docs/test.schema.json` 為準）：

~~~json
{
  "name": "replayable opening action",
  "frames": 3,
  "seed": 42,
  "input_sequence": [{"actions": {"Confirm": true}}, {"actions": {}}, {"actions": {}}],
  "load_save": {"version": 1},
  "assertions": [
    {"observation": {"key": "view_model", "equals": {"screen": "opening", "step": 1}}},
    {"entity": "player", "field": "transform.x", "greater_than": -100.0}
  ]
}
~~~

資產真的能被 host 取出，必須用 `bin/game.exe --project <game-root> --json bundle install content` 加上 `bin/game.exe --project <game-root> --json asset read --id <asset-id>` 證明：它回報已驗證的 `size_bytes`、`sha256` 與 `bundle_generation`，與 Web host 解析同一個 asset id 的結果必須一致。子代理必須先用 systems list／systems search 決定這款遊戲要用哪些引擎系統，並用 `systems set --id <id> --enabled false` 關掉企劃不需要的機制（例如老虎機、AVG、自走棋通常不需要 physics2d）。未宣告的 system 使用引擎預設；不可自行發明 system id，也不可啟用 status 為 not_implemented 的 system。asset inspect 是作者檢查用的 advisory report；asset inspect --strict 是 handoff/release gate，任何靜態 reference、source、manifest、bundle 或目前不支援的 manifest kind/version 問題都必須 ok=false。bundle pack 也會拒絕未解決的主場景 asset reference。

## 遇到問題的立即回報協定

**畫面必須用 `ui preview --strict` 檢查過。** 子代理看不到畫面，其他 gate 全部只檢查語意狀態，所以遊戲可以通過每一個測試、同時把控制項疊在一起。`ui preview` 會把 UI tree 畫成字元格並回報 `UI_NODES_OVERLAP` 與 `UI_TEXT_EXCEEDS_RECT`；`--strict` 讓它變成失敗的 gate。它只檢查結構，不判斷美觀。

任何一項下列情況都算 blocker：命令與文件不一致、semantic diagnostic 不足以判斷下一步、API 找不到、typed Luau contract 不成立、同一問題在兩個以上遊戲會重現、host 不能載入／reload／儲存、或企劃需要 engine 未宣告的 primitive。

發現 blocker 後，子代理必須立刻：

1. 停止依賴該問題的後續實作，不用 workaround 把 gate 偽裝成通過。
2. 在遊戲 output 建立 validation/blockers/<id>.md，記錄首次發生時間、命令、完整 JSON/錯誤、影響範圍、已確認事實、推論、需要的決策。
3. 立即在自己的 task thread 回報主代理，標題包含 [BLOCKER] <id>；不得等到整個遊戲完成才集中回報。
4. 標明分類：game-logic、engine-contract、architecture、docs/tooling 或 host。若可能影響兩款以上遊戲、跨平台、reload/bundle/save 邊界，優先標成 architecture，由主代理處理。
5. 收到主代理的處置或明確允許後，記下決策，再繼續並補回歸測試。

「先繼續做其他不依賴的工作」可以，但必須在同一則回報明確列出哪些工作被暫停、哪些工作不受影響；不可默默跳過 blocker。

## 每個遊戲的交付 gate

子代理只能把自己的遊戲報告為 ready_for_review，不能自行把七款總矩陣標成 passed。至少要有：

- project inspect、asset inspect --strict、check／check --types 的結果。
- deterministic game test，涵蓋企劃的最小完整閉環、失敗路徑、save restore 與必要的 input replay。
- bundle pack、bundle inspect，並確認 project/script/scene/asset-manifest/content bundle 的 hash、依賴與大小。
- generic Web runner 的 source 與 packaged bundle smoke；若需 UI/資產，確認 semantic state 與 resolved asset count，不以截圖取代 state assertion。
- native preview／可用的 mobile host smoke；缺少平台能力要寫 blocker，不得改成「完成」。
- validation-report.json、README/AI workflow、開發日誌與必要截圖；所有命令都要能從乾淨輸入重跑。
- 最後回報仍列出未完成的 final-gate 項目與「需要主代理決定」清單。

目前 package 內有 generic Android x86_64 smoke host；命令與限制見 `docs/mobile-package-host.md`。子代理可以用自己的 game output 建 APK 並跑 lifecycle smoke，不需要 engine source。這只證明 Android package/JNI/FFI/lifecycle/runtime startup，不證明 production renderer、asset/bundle content 或 iOS；沒有 emulator/device 或沒有 macOS/Xcode 時，分別保留 host blocker。

## 最小回報格式

~~~
[BLOCKER] <id>
分類: engine-contract | architecture | docs/tooling | host | game-logic
影響: <這款遊戲 / 多款遊戲 / 跨平台>
命令: <可重跑命令>
事實: <引擎 JSON facts 與觀測>
推論: <若有，明確標推論>
已停止: <哪些依賴工作>
不受影響: <哪些可繼續工作>
需要主代理: <修 engine / 修文件 / 接受遊戲端方案 / 其他>
~~~

這個協定的目的，是讓子代理先回饋再繼續，而不是讓每個遊戲自行複製一套「看似能跑」的 engine adapter。
