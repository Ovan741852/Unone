# AI 開發流程

這是目前 AI 或人類操作 Unone 的最小流程。CLI 是 Developer Protocol 的第一個 client；MCP 與 Editor 必須在這個 protocol 穩定後再接入。

## 1. 先檢查專案

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json check
```

`check` 目前保證 Luau syntax 與 Engine entrypoint contract；它會確認入口腳本回傳 `Game` table，且有 `start` / `update` function。`--!strict` 會被回報為 contract metadata。完整 Luau static analyzer 尚未接入，不能把這個命令誤稱為完整型別檢查。

## 2. 跑 deterministic simulation

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json run --frames 60 --seed 42 --action Right
```

AI 應優先讀 `world`、`observation_digest`、`diagnostics`，再看 screenshot。相同 project、seed、frames 與 input 應產生相同 digest；不要用畫面像不像取代 state assertion。

## 3. 執行測試

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json test
```

Test manifest 放在遊戲專案，包含 frames、seed、input 與 assertion。測試失敗時要先判斷是：

- game logic：改 `Unone_Games` 的 Luau 或內容。
- engine contract：改引擎、測試與文件。
- architecture：重複阻塞多個遊戲或無法支援平台/reload，改架構。
- tooling/docs：CLI、診斷或教學有噪音，改 protocol/metadata/文件。

## 4. 檢查 bundle

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json bundle inspect
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json bundle install base
```

bundle 成功不是只代表檔案存在：要確認 manifest hash、cache hash、active generation 與 dependencies。下載來源尚未內建；目前 sample 使用 local source，未來由 native/Web adapter 或外部 downloader 提供 bytes。

## 5. native preview

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d preview
```

方向鍵或 A/D 會更新 Luau input。Escape 或關閉視窗結束。這個 preview 是 runtime smoke client，不是 Editor。

## 輸出規則

- 需要 machine action 時使用 `--json`。
- `facts` 是引擎觀測到的事實；`likely_causes` 是推論；`suggested_actions` 必須能對應下一個 CLI/protocol action。
- 預設 trace 只記錄語意事件，不記錄每一幀，避免 AI context 被噪音淹沒。
- 任何教學命令若不能在乾淨 checkout 重跑，必須修文件或建立 issue，不保留錯誤說法。
