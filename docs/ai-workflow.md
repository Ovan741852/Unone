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

先讀 `target_family`、`project_loaders`、`hot_reload_modes` 與 `pending_host_work`。`wasm` 回報的是可用 memory-source runtime 與待完成的 browser host；不要把 library compile 直接推論成 WebGPU 頁面完成。

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

`--action` 與 `--input-sequence` 互斥；sequence 不足的 frame 會清空 actions 與 pointer down 狀態。`pointer.position` 已是 world space，平台觸控／滑鼠只需在 adapter 層完成像素到 world 的轉換；遊戲腳本不讀 key code 或螢幕座標。

## 3. 執行測試

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json test
```

Test manifest 放在遊戲專案，包含 frames、seed、input、可選的逐 frame `input_sequence` 與 assertion。每個 `input_sequence` frame 可包含 `actions` 與 `pointer`；未提供的 frame 會清空 action 與 pointer down 狀態，避免 sticky input。測試失敗時要先判斷是：

- game logic：改 `Unone_Games` 的 Luau 或內容。
- engine contract：改引擎、測試與文件。
- architecture：重複阻塞多個遊戲或無法支援平台/reload，改架構。
- tooling/docs：CLI、診斷或教學有噪音，改 protocol/metadata/文件。

## 4. 檢查 bundle

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json bundle inspect
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json bundle install base
```

bundle 成功不是只代表檔案存在：要確認 manifest hash、cache hash、active generation、dependencies 與 `available`。引擎的 `BundleFetcher` 只接收 host 提供的 reader，再負責 streaming size/hash verify、staging 與 atomic activation；native CLI 使用 local source，Web/mobile 的 fetch、重試、storage quota 與背景下載政策留在 host adapter。詳見 `docs/decisions/0010-bundle-fetch-boundary.md`。

## 5. native preview

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d preview --watch
```

`--watch` 會在檔案 metadata 變更後，於下一個等待 frame 嘗試載入入口 Luau。成功會保留 Rust-owned world state 並切換腳本 generation；失敗會輸出語意診斷，繼續使用上一份可運作腳本，直到檔案再次變更。方向鍵或 A/D 會更新 Luau input。Escape 或關閉視窗結束。這個 preview 是 runtime smoke client，不是 Editor。

不帶 `--watch` 也可以啟動一次性的 native preview；AI 需要快速修改與觀察時使用 `--watch`。

## 輸出規則

- 需要 machine action 時使用 `--json`。
- `facts` 是引擎觀測到的事實；`likely_causes` 是推論；`suggested_actions` 必須能對應下一個 CLI/protocol action。
- 預設 trace 只記錄語意事件，不記錄每一幀，避免 AI context 被噪音淹沒。
- `run` 會保留 runtime load／reload 期間的 lifecycle trace，例如 `api.log` 與 `script_reloaded`；這些事件不是逐 frame telemetry。
- 任何教學命令若不能在乾淨 checkout 重跑，必須修文件或建立 issue，不保留錯誤說法。
