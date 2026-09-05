# AI 開發流程

這是目前 AI 或人類操作 Unone 的最小流程。CLI 與 `game mcp` 都是 Developer Protocol client；MCP 只做 stdio 薄轉接，不在另一層重做引擎邏輯。

## -0. MCP stdio（可選）

需要 MCP host 時，先建立 CLI binary，再以固定 project 啟動：

```powershell
cargo build -p unone-cli
target/debug/game.exe --project D:/Projects/Unone_Games/minimal-2d mcp
# 可重跑的 protocol smoke
.\scripts\mcp-smoke.ps1
```

MCP host 設定可使用同一個 command 與 args。連線後先完成 `initialize` 與 `notifications/initialized`，再 discovery `tools/list`；工具名稱以 `unone_` 開頭。`unone_run` 的 arguments 直接接受 `frames`、`seed`、單一 `action` 或 `input_sequence`，後者與 CLI 相同，使用語意 action 與 world-space pointer。工具結果內的 `content[0].text` 是完整 `EngineResult` JSON；錯誤也會保留 `code`、`explanation`、`facts`、`likely_causes` 與 `suggested_actions`。

## -1. 先確認平台能力

```powershell
cargo run -p unone-cli -- --json platform capabilities
```

先讀 `target_family`、`project_loaders`、`hot_reload_modes` 與 `pending_host_work`。`wasm` 的 capabilities 仍是 binary-level 資訊；目前 Web live 的 browser/WebGPU/bundle storage 證據來自 `web/live/` smoke，不要把 library compile 或單一 smoke fixture 推論成完整 Web 發布包。

## 0. 先建立或取得專案與 API 語意

子代理只拿到 engine package 與企劃時，先在自己的 game output directory 建立 scaffold：

```powershell
powershell -File scripts/verify-ai-engine-package.ps1 -PackagePath .
bin/game.exe --project D:/Projects/Unone_Games/<game-output> --json project init --name "<game-name>"
```

`project init` 只建立最小的 `project.unone.json`、`scripts/main.luau` 與 `scenes/main.scene.json`，不覆蓋既有檔案。可直接使用 package 內的 [project.schema.json](project.schema.json)、[scene.schema.json](scene.schema.json) 與 [test.schema.json](test.schema.json) 驗證格式；它們是目前 canonical authoring contract。UI `rect` 固定是 normalized 0..100 × 0..100 logical design space，Web/native host 只做 viewport/DPI/safe-area 映射，遊戲不可寫 960×540 或其他未宣告尺度。

```powershell
bin/game.exe --project D:/Projects/Unone_Games/<game-output> --json project inspect
bin/game.exe --project D:/Projects/Unone_Games/<game-output> --json asset inspect
bin/game.exe --project D:/Projects/Unone_Games/<game-output> --json api search "move entity"
bin/game.exe --project D:/Projects/Unone_Games/<game-output> --json api describe entity.setPosition
```

`project inspect` 回報引擎看見的設定與檔案事實；`api search` 是依用途找能力；`api describe` 會回傳參數、回傳值、side effects、frame semantics、常見錯誤、範例與相關 API。AI 應先讀這些資料，再修改遊戲腳本，不要猜測 API。

`asset inspect` 會列出主場景的靜態 sprite／mesh3d asset reference，並對照遊戲端 `asset_manifest` 的 id、project-relative source 與 bundle。它是 authoring 時的 advisory report；交接、CI 或 release 必須使用 `asset inspect --strict`，讓 `ASSET_MANIFEST_MISSING`、`ASSET_REFERENCE_MISSING`、`ASSET_SOURCE_MISSING` 與 `ASSET_BUNDLE_NOT_DECLARED` 變成 `ok=false`。目前只支援 manifest version 1 與 kind `texture2d`／`mesh3d`；不會把未知版本或 typo 靜默當成可用格式。source 必須使用 project-relative、正斜線路徑，且現有檔案的 canonical path 必須留在專案內。它不會假裝能發現 Luau 動態選 asset，也不會代替 host 做下載、解碼或 GPU 資源管理。若沒有任何 scene asset reference，沒有 manifest 也不算錯誤。

需要可重播的遊戲隨機性時使用 `api.random.nextFloat()` 或 `api.random.nextInt(min, max)`。CLI 的 `--seed` 會成為該 runtime 的 Luau random seed；同一個 seed、輸入順序與 random 呼叫順序才保證同一結果。它不是安全隨機數，也不應用於金流或密碼。

## 0.5 決定這個遊戲要用哪些引擎系統

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/slot-machine --json systems list
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/slot-machine --json systems search "物理"
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/slot-machine --json systems set --id physics2d --enabled false
```

`systems list` 會回報每個 system 的預設值、目前生效值與來源（`default` 或 `project`）、它擁有的 Luau API 與 observation 欄位，以及關閉後會失去什麼。`systems search` 依用途找系統，習慣與 `api search` 相同。決定後用 `systems set` 寫進該遊戲自己的 `project.unone.json`：

```json
{ "systems": { "physics2d": false } }
```

未宣告的 system 使用引擎預設。三種情況會直接失敗：`SYSTEM_UNKNOWN`（引擎沒有這個 id，typo 不會被當成關閉）、`SYSTEM_NOT_OPTIONAL`（`world`／`input`／`observation` 不可關閉）、`SYSTEM_NOT_IMPLEMENTED`（只有契約沒有實作，目前是 `spine`、`effekseer`）。

關閉是有實際效果的：`physics2d` 關閉後引擎不再推進剛體；被關閉系統的 Luau API 仍然存在，但呼叫時會回報 `SYSTEM_DISABLED` 並附上重新啟用的命令，不會變成 `attempt to index nil`。`systems` 只決定引擎機制要不要跑，遊戲數值、關卡與內容開關仍屬遊戲端。

## 1. 先檢查專案

一次跑完全部 gate：

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/slot-machine --json verify
```

`verify` 依序執行 `check --types`、`asset inspect --strict`、`ui preview --strict`、`test`，回傳單一結論與每個步驟的結果；任何一步失敗都不會中斷其他步驟，且每個步驟都附上可單獨重跑的 `command`。以下小節說明各個 gate 單獨使用的方式。

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json check --types
```

`project init` 產生的入口腳本會**內嵌引擎的 Luau 型別契約**，因此 `check --types` 真的會擋下不存在的 API（引擎 runtime 沒有 module require，單檔遊戲必須自帶型別）。引擎升級後用 `game api typings --output <path>` 取得最新契約，或 `game api typings` 直接印出來。型別契約與 API 索引由測試保證不會漂移。

`check` 保證 Luau syntax 與 Engine entrypoint contract；它會確認入口腳本回傳 `Game` table，且有 `start` / `update` function。`--!strict` 會被回報為 contract metadata。加上 `--types` 才會呼叫官方 `luau-analyze`；engine package 的 `bin/game.exe` 會自動尋找同目錄的 `bin/luau-analyze.exe`。若自行開發 engine 或替換工具，可用 `UNONE_LUAU_ANALYZER` 指定 analyzer 可執行檔路徑；工具不存在時，命令會回傳 `LUAU_ANALYZER_NOT_FOUND`，不會把缺少型別檢查的狀態藏起來。

`.test.json` 的完整欄位與 assertion 結構以 package 內的 `test.schema.json` 為準；`game test` 會把每個 test file 當成一個獨立 deterministic case，最後回傳 observation digest、save payload 與 assertion failures。不要把 UI screenshot 當成 test assertion。

例如 `project.unone.json` 可設定 `"test_files": ["tests/opening.test.json"]`，而 test file 由 `name`、可選 `frames`/`seed`/`input`/`input_sequence`/`load_save` 與 `assertions` 組成。assertion 三選一：`observation` 做完整 JSON value 比對、`ui` 做完整 flat UI tree 比對，或 `entity` + `field`（目前 `transform.x`／`transform.y`）做數值比較。

若只要驗證 runtime contract，可移除 `--types`。本機可用官方 Luau release 的 Windows binary，或先設定：

```powershell
$env:UNONE_LUAU_ANALYZER = 'D:/tools/luau-analyze.exe'
```

## 1.5 mobile host contract

Android/iOS host 先以 `unone-mobile-ffi` 的窄 ABI 驗證 lifecycle，不要在遊戲腳本處理 JNI、UIKit、View、螢幕像素或 safe area：

```powershell
cargo test -p unone-mobile-ffi
.\scripts\check-android-engine.ps1
```

native host 的基本順序是 `init → resize → load_project → set_pointer/set_action → tick → observe → pause → surface_lost/resize → resume → tick → shutdown`。`pause` 期間不送 tick；`resume` 不把過期 wall-clock 偷塞進 simulation。ABI 的 JSON observation、C header 與 ownership 規則見 `docs/mobile-host-abi.md`。這些命令只驗證 adapter contract 與 Android cross-compile，沒有 APK、emulator/device 或 iOS 實機證據時，不得標記 mobile 完成。

在 Windows 若 Android SDK build-tools 與 JDK 已可用，可再驗證最小 APK host：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:/Projects/Unone/scripts/build-android-apk.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File D:/Projects/Unone/scripts/run-android-apk-smoke.ps1
```

這會把指定遊戲的 project/script/scene 放入 APK，由 Java/Canvas host 讀取並透過 `unone-mobile-ffi` 執行；它只證明 package/JNI/lifecycle/input 邊界，不代表 production Android renderer、asset/bundle 或正式遊戲 gate。

## 2. 跑 deterministic simulation

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json run --frames 60 --seed 42 --action Right
```

AI 應優先讀 `world`、`observation_digest`、`diagnostics`，再看 screenshot。相同 project、seed、frames 與 input 應產生相同 digest；不要用畫面像不像取代 state assertion。

要重播逐 frame input，可使用 JSON 陣列。每 frame 明確分成語意 actions 與可選的 world-space pointer：

```json
[
  {"actions": {"Right": true}},
  {"actions": {"Right": true}},
  {"actions": {}},
  {"actions": {"Right": false}},
  {"pointer": {"position": {"x": 2, "y": 1}, "down": true}}
]
```

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json run --frames 4 --seed 42 --input-sequence D:/Projects/Unone_Games/minimal-2d/tests/input-sequence.json
```

`--action` 與 `--input-sequence` 互斥；sequence 不足的 frame 會清空 actions 與 pointer down 狀態。`pointer.position` 是 world space；需要 UI 點擊時可另提供 `pointer.screen_position`，兩者都由 adapter 正規化到 normalized 0..100 UI space，遊戲腳本不讀 key code、像素、DPI 或 safe-area 座標。未提供 `screen_position` 時，engine 明確以 `position` 作為 headless fallback。

## 3. 執行測試

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json test
```

Test manifest 放在遊戲專案，包含 frames、seed、input、可選的逐 frame `input_sequence` 與 assertion。每個 `input_sequence` frame 可包含 `actions` 與 `pointer`；未提供的 frame 會清空 action 與 pointer down 狀態，避免 sticky input。測試失敗時要先判斷是：

- game logic：改 `Unone_Games` 的 Luau 或內容。
- engine contract：改引擎、測試與文件。
- architecture：重複阻塞多個遊戲或無法支援平台/reload，改架構。

需要驗證 restore 時，test manifest 可額外提供 `load_save` JSON payload。它在 `Game.start` **之前**就已還原，所以遊戲可以在 `start` 裡用 `api.save.get()` 重建狀態，不必等到第一次 update；輸出也會帶 `save_payload`，但引擎不會替遊戲判斷版本或 migration。
- tooling/docs：CLI、診斷或教學有噪音，改 protocol/metadata/文件。

若遊戲有對話、戰鬥結果或其他不適合塞進 Entity Transform 的狀態，使用 `api.observation.set(key, value)` 發布 typed ViewModel 的 semantic projection；test assertion 可用 `{"observation":{"key":"view_model","equals":{...}}}` 做完整 JSON equality。需要 host 顯示時，遊戲端以 `api.ui.setRoot(root)` 發布最小 View tree。每個節點的位置**二選一**：

- `rect`：0..100 設計空間的絕對座標。適合不是貼邊的版面，例如用三角函數排出來的燈環。
- `anchor` + `size`（可選 `offset`、`pivot`）：貼邊定位。`anchor` 是九個具名位置之一（`top_left`…`bottom_right`），數字**兩軸都是垂直單位**（畫面高度的百分比），所以同一份宣告在任何螢幕比例都保持形狀與邊距。引擎會依 host 回報的 viewport 解析成 rect，host 收到的仍然是純 rect。

兩者同時宣告或都不宣告都會被拒絕。headless 測試使用 16:9 參考比例；host 用 `unone_web_set_viewport_aspect` 回報實際比例，test 可用 `{"ui":{"equals":{...}}}` assertion。ViewModel、View、hit-test 與 action 意義仍屬遊戲端；engine 只驗證／傳輸 tree，host 處理 viewport 與實際 render。

需要存檔時使用 `api.save.set(value)`／`api.save.get()`，payload 由遊戲端定義版本與 migration；引擎只做 JSON-like transport，host 負責檔案／平台儲存。不要把 observation 當 save，也不要在引擎增加 save slot、cloud sync 或遊戲專用 schema。

## 3.5 骨骼動畫與特效（Spine／Effekseer）

這兩個系統預設關閉，狀態是 `host_required`：引擎這一半可用，但目前沒有任何 host 會畫出骨骼或粒子。需要時先開啟：

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/slot-machine --json systems set --id spine --enabled true
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/slot-machine --json systems set --id effekseer --enabled true
cargo run -p unone-cli -- --json api describe animation.play
cargo run -p unone-cli -- --json api describe effect.spawn
```

遊戲以 `api.animation.play(id, name, {loop = true, speed = 2.0})` 選擇某個 Entity 要播的片段，snapshot 的 `world.entities[].animation` 會帶 `started_frame`；重複播放同一組 asset/name/loop/speed 不會重設它，host 因此不會每 frame 重新開始。`api.effect.spawn(asset, {x = 0, y = 1})` 回傳 handle，`world.effects` 是目前存在的特效實例，handle 依建立順序決定，同時上限 256 個。scene 也可以直接宣告 entity 的 `animation`。

資產方面，asset manifest 支援 kind `spine` 與 `effekseer`，並以 `files` 宣告不可缺少的附屬來源（Spine 的 atlas 與 texture page）。它們與 source 打進同一個 bundle，可用 `asset read --id <id> --file <declared file>` 取出；未宣告的檔案回報 `ASSET_FILE_NOT_DECLARED`。

測試用 `{"animation": {"entity": "reel-3", "equals": {...}}}` 與 `{"effects": {"equals": [...]}}` 做完整 JSON equality，表現狀態因此可被 assertion，不必看畫面。

要看到它們實際播放，使用 `web/presentation/`：先跑 `scripts/build-web-live.ps1`，從 `D:/Projects` 啟動 `python -m http.server 8001`，再開 `http://127.0.0.1:8001/Unone/web/presentation/?project=/Unone_Games/slot-machine/`。它以 spine-webgl 與 Effekseer for WebGL 播放同一份 snapshot；native preview 與 Android host 目前都不會畫。vendored runtime 與授權條件見 `web/vendor/README.md`（Spine 需要授權，Effekseer 是 MIT）。

引擎不評估骨骼、不混合動畫、不回報動畫是否播完、不模擬粒子，也不含任何 Spine／Effekseer 程式碼。遊戲若要「動畫播完才結算」，必須自己以 fixed frame 計算。

## 3.8 讀懂自己的畫面

AI 看不到畫面。其他每一個 gate 都在檢查語意狀態，所以遊戲可以全部通過，同時把控制項疊在一起。把 UI tree 畫成字元格是最便宜的補救：人和模型都讀得懂、確定性夠高可以進測試、不需要 GPU、字型或視窗。

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/xiao-mary ui preview
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/xiao-mary --json ui preview --frames 60 --strict
```

不帶 `--json` 會輸出 markdown：一張 ASCII 圖、一張節點表、以及 findings。`--frames` 決定先跑幾格再畫（預設 1），`--cols`／`--rows` 調整格線大小。

目前只有一條 finding：`UI_NODES_OVERLAP`（兩個節點的 rect 相交，圖上以 `#` 標出，附重疊的設計空間單位）。`--strict` 讓它變成 `ok=false` 與非零 exit code；交接與 release 應該使用它。

節點表另外附 `text fit`：文字約佔宣告寬度的幾倍。它假設 16:9 viewport 與 0.5 字寬比例，所以是**測量值不是判決**——超過 1.0 表示 host 必須縮小、換行或裁切，值得看一眼，但引擎不會因此判定失敗。加規則的入場條件見 Decision 0029。

它只檢查**結構**：不重疊、放得下。它不會、也不打算判斷畫面好不好看。世界層（sprite、實體位置）目前還沒有對應的文字檢查。

## 4. 檢查 bundle

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/3d-racing --json bundle pack
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/3d-racing --json bundle inspect
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/3d-racing --json bundle install script
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json bundle inspect
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json bundle install base
```

新專案先用 `bundle pack` 生成最小的 project/script/scene manifest；若有 asset manifest，它還會產生 deterministic、未壓縮的 content bundle，並拒絕未解決的主場景 asset reference。工具會自動把 `bundle_manifest` 寫入 `project.unone.json`；內容沒有變更時不增加 manifest version，內容變更時才遞增版本。bundle 成功不是只代表檔案存在：要確認 manifest hash、cache hash、active generation、dependencies 與 `available`。引擎的 `BundleFetcher` 只接收 host 提供的 reader，再負責 streaming size/hash verify、staging 與 atomic activation；native CLI 使用 local source，Web/mobile 的 fetch、重試、storage quota 與背景下載政策留在 host adapter。Web generic runner 會由 verified content bundle 解析 image asset，並將 URL lifetime 留在 host；production CDN、OPFS、大檔 streaming 與 quota policy 仍不是 engine core。Web sample 的 browser generation/cache smoke 另見 `docs/decisions/0016-bundle-generation-and-browser-storage.md`。

## 4.5 由已啟用 generation 取得資產

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/angry-birds-2d --json bundle install content
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/angry-birds-2d --json asset read --id asset://characters/bird/red
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/angry-birds-2d --json asset read --id asset://characters/bird/red --output D:/tmp/red.svg
```

`asset read` 會由目前 active generation 的已驗證 bundle 取出一筆宣告資產，回報 `size_bytes`、`sha256` 與 `bundle_generation`；加上 `--output` 才會寫檔。它與 Web host 的 `readActiveAsset` 使用同一個 archive 契約與同一組錯誤碼：`BUNDLE_GENERATION_MISMATCH`（尚未安裝／manifest 已變更）、`BUNDLE_CACHE_MISS`、`BUNDLE_CACHE_CORRUPT`、`ASSET_ID_NOT_DECLARED`、`ASSET_NOT_IN_BUNDLE`、`ASSET_ARCHIVE_INVALID`、`ASSET_CONTENT_CORRUPT`。兩端都會另外驗證 archive entry 自己的 sha256，因此同一個 asset id 在 Web 與 native 必須得到相同的 `sha256`；不同就是 bundle 或 host 的問題，不是畫面問題。

引擎只回傳已驗證位元組與事實。解碼、貼圖上傳、下載、重試、快取容量與 CDN／OPFS policy 仍在 host。`game preview` 目前不會讀取 `sprite.asset`，所以 `asset read` 通過不代表 native 貼圖渲染通過。

## 5. native preview

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d preview --watch
```

`--watch` 會在檔案 metadata 變更後，於下一個等待 frame 嘗試載入入口 Luau。成功會保留 Rust-owned world state 並切換腳本 generation；失敗會輸出語意診斷，繼續使用上一份可運作腳本，直到檔案再次變更。方向鍵或 A/D 會更新 Luau input。Escape 或關閉視窗結束。這個 preview 是 runtime smoke client，不是 Editor。

不帶 `--watch` 也可以啟動一次性的 native preview；AI 需要快速修改與觀察時使用 `--watch`。

3D 專案使用 `Transform3D`／`Camera3D` 的 semantic API；先查語意再寫腳本：

```powershell
cargo run -p unone-cli -- --json api describe entity.getTransform3D
cargo run -p unone-cli -- --json api describe entity.setTransform3D
cargo run -p unone-cli -- --json api describe camera3d.setTarget
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/3d-racing --json test
```

要驗證實際遊戲專案的 Web host，可從 `D:/Projects` 啟動 `python -m http.server 8001`，再開啟 `http://127.0.0.1:8001/Unone/web/runner/?project=/Unone_Games/3d-racing/`。有 bundle manifest 的專案會由同一個 runner 安裝 content-addressed generation、讀取驗證後的 project/script/scene、消費 2D/3D snapshot 與 UI，並可按 `Install / reload active bundle` 重新安裝目前 generation、執行 Luau hot reload；save payload 會以 project-isolated IndexedDB store 持久化，輸出 `save_store.loaded` 讓 AI 確認是否真的載入；`?bundle=0` 只用於排查 source fallback。這是 generic host smoke；沒有 asset CDN、OPFS/production quota policy、實際 mobile host 與內容變更 hot-update evidence 時，不可標記 Web final gate 通過。

## 輸出規則

- 需要 machine action 時使用 `--json`。
- `facts` 是引擎觀測到的事實；`likely_causes` 是推論；`suggested_actions` 必須能對應下一個 CLI/protocol action。
- 預設 trace 只記錄語意事件，不記錄每一幀，避免 AI context 被噪音淹沒。
- `run` 會保留 runtime load／reload 期間的 lifecycle trace，例如 `api.log` 與 `script_reloaded`；這些事件不是逐 frame telemetry。
- 任何教學命令若不能在乾淨 checkout 重跑，必須修文件或建立 issue，不保留錯誤說法。
