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

## 0. 先取得專案與 API 語意

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json project inspect
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json api search "move entity"
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json api describe entity.setPosition
```

`project inspect` 回報引擎看見的設定與檔案事實；`api search` 是依用途找能力；`api describe` 會回傳參數、回傳值、side effects、frame semantics、常見錯誤、範例與相關 API。AI 應先讀這些資料，再修改遊戲腳本，不要猜測 API。

需要可重播的遊戲隨機性時使用 `api.random.nextFloat()` 或 `api.random.nextInt(min, max)`。CLI 的 `--seed` 會成為該 runtime 的 Luau random seed；同一個 seed、輸入順序與 random 呼叫順序才保證同一結果。它不是安全隨機數，也不應用於金流或密碼。

## 1. 先檢查專案

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json check --types
```

`check` 保證 Luau syntax 與 Engine entrypoint contract；它會確認入口腳本回傳 `Game` table，且有 `start` / `update` function。`--!strict` 會被回報為 contract metadata。加上 `--types` 才會呼叫官方 `luau-analyze`；若工具不存在，命令會回傳 `LUAU_ANALYZER_NOT_FOUND`，不會把缺少型別檢查的狀態藏起來。`UNONE_LUAU_ANALYZER` 可指定 analyzer 可執行檔路徑。

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

`--action` 與 `--input-sequence` 互斥；sequence 不足的 frame 會清空 actions 與 pointer down 狀態。`pointer.position` 是 world space；需要 UI 點擊時可另提供 `pointer.screen_position`，兩者都由 adapter 正規化，遊戲腳本不讀 key code、像素、DPI 或 safe-area 座標。未提供 `screen_position` 時，engine 明確以 `position` 作為 headless fallback。

## 3. 執行測試

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json test
```

Test manifest 放在遊戲專案，包含 frames、seed、input、可選的逐 frame `input_sequence` 與 assertion。每個 `input_sequence` frame 可包含 `actions` 與 `pointer`；未提供的 frame 會清空 action 與 pointer down 狀態，避免 sticky input。測試失敗時要先判斷是：

- game logic：改 `Unone_Games` 的 Luau 或內容。
- engine contract：改引擎、測試與文件。
- architecture：重複阻塞多個遊戲或無法支援平台/reload，改架構。

需要驗證 restore 時，test manifest 可額外提供 `load_save` JSON payload；runner 會在第一次 tick 前注入，輸出也會帶 `save_payload`，但不會替遊戲判斷版本或 migration。
- tooling/docs：CLI、診斷或教學有噪音，改 protocol/metadata/文件。

若遊戲有對話、戰鬥結果或其他不適合塞進 Entity Transform 的狀態，使用 `api.observation.set(key, value)` 發布 typed ViewModel 的 semantic projection；test assertion 可用 `{"observation":{"key":"view_model","equals":{...}}}` 做完整 JSON equality。需要 host 顯示時，遊戲端以 `api.ui.setRoot(root)` 發布只含 screen/text/button/rect/action 的最小 View tree，test 可用 `{"ui":{"equals":{...}}}` assertion。ViewModel、View、hit-test 與 action 意義仍屬遊戲端；engine 只驗證／傳輸 tree，host 處理 viewport 與實際 render。

需要存檔時使用 `api.save.set(value)`／`api.save.get()`，payload 由遊戲端定義版本與 migration；引擎只做 JSON-like transport，host 負責檔案／平台儲存。不要把 observation 當 save，也不要在引擎增加 save slot、cloud sync 或遊戲專用 schema。

## 4. 檢查 bundle

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/3d-racing --json bundle pack
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/3d-racing --json bundle inspect
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/3d-racing --json bundle install script
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json bundle inspect
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json bundle install base
```

新專案先用 `bundle pack` 生成最小的 project/script/scene manifest，並自動把 `bundle_manifest` 寫入 `project.unone.json`；內容沒有變更時不增加 manifest version，內容變更時才遞增版本。bundle 成功不是只代表檔案存在：要確認 manifest hash、cache hash、active generation、dependencies 與 `available`。引擎的 `BundleFetcher` 只接收 host 提供的 reader，再負責 streaming size/hash verify、staging 與 atomic activation；native CLI 使用 local source，Web/mobile 的 fetch、重試、storage quota 與背景下載政策留在 host adapter。Web sample 的 browser generation/cache smoke 另見 `docs/decisions/0016-bundle-generation-and-browser-storage.md`。

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
