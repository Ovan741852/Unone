# Unone

Unone 是 AI-native 遊戲引擎原型：Rust 負責遊戲引擎機制，Luau 負責遊戲規則與內容。引擎目前仍在早期開發，最終必須通過七類遊戲驗證，才算完成長期目標。

## 工作區

- Engine：`D:/Projects/Unone`
- Validation games：`D:/Projects/Unone_Games`
- 技術草案：[docs/ai-native-game-engine-plan-v0.1.md](docs/ai-native-game-engine-plan-v0.1.md)
- AI CLI 流程：[docs/ai-workflow.md](docs/ai-workflow.md)
- Code review 流程：[docs/review-process.md](docs/review-process.md)
- 平台 toolchain：[docs/platform-toolchain.md](docs/platform-toolchain.md)

## 目前可執行的垂直切片

在 engine workspace 執行：

```powershell
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json project inspect
cargo run -p unone-cli -- --json platform capabilities
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json api describe entity.setPosition
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json check
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json run --frames 60 --action Right
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json run --frames 2 --input-sequence D:/Projects/Unone_Games/minimal-2d/tests/input-sequence.json
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json test
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d preview --watch
```

AI host 也可以使用同一個 Developer Protocol 的 MCP stdio 薄轉接：

```powershell
cargo build -p unone-cli
target/debug/game.exe --project D:/Projects/Unone_Games/minimal-2d mcp
# 驗證 lifecycle、tools discovery、deterministic run 與語意錯誤
.\scripts\mcp-smoke.ps1
```

MCP 只位於 `unone-cli`，不成為 engine core 的依賴；工具結果保留完整 `EngineResult` JSON 與語意化 diagnostics。

目前已驗證：Luau entrypoint、`--!strict` contract、官方 `luau-analyze` adapter、headless fixed timestep、deterministic 2D rigid body／重力／地面碰撞、Camera2D state、逐 frame input replay、共用的 `tick_with_input` host boundary、seeded Luau random、seed/input observation digest、failed reload fallback、scene Sprite size validation、與遊戲命名無關的 native wgpu preview、`preview --watch` 腳本熱更、JSON test manifest 與 bundle hash/cache/activation。

完整型別檢查使用 `game check --types`，需要另外安裝並固定版本的官方 `luau-analyze`；工具不存在時引擎會明確回報錯誤，不會把基本 contract check 說成完整型別檢查。

## Web 目前狀態

`unone-engine` 已以 `wasm32-unknown-emscripten` 搭配 Emscripten wrapper 通過 library compile，`unone-web-smoke` 也已完成 link、由 host Node（需 `--experimental-wasm-exnref`）執行 60 frames，並由 `web/smoke/index.html` 在瀏覽器實際載入執行。`web/host/` 已驗證 snapshot bridge，`web/live/` 另以窄 C ABI 驗證 browser animation frame、host-provided project payload、script reload、pointer 驅動同一個 Rust/Luau runtime、WebGPU render，以及 sample bundle verify、IndexedDB cache、generation activation 與 cache-only reopen；目前仍是 smoke fixture，不是完整 production asset packaging。mobile host、OPFS/chunked asset streaming、CDN policy 與正式 error transport 仍未完成。

Android preflight 已用 NDK `27.1.12297006` 通過 `unone-engine` 的 `aarch64-linux-android` 與 `x86_64-linux-android` cross-compile；這不等於 APK、emulator/device 或 mobile lifecycle 通過。

## 邊界

引擎只提供必要的遊戲機制。遊戲規則、數值、ViewModel、UI flow、內容 catalog、下載時機與營運服務留在遊戲專案或服務端。UI 會採 MVVM；ECS + systems 負責高頻模擬。

Bundle 的第一版只包含 manifest、依賴、host-provided fetch、streaming hash 驗證、content-addressed cache、staging 與 generation activation；不包含 CDN、P2P、差分更新或遠端腳本執行。fetch、重試與平台 storage policy 不進 engine core。

## 驗證遊戲

中期先在 `D:/Projects/Unone_Games/` 用憤怒鳥 2D 壓測 2D physics、camera、input replay、scene/prefab、asset、UI、hot reload、headless test 與 AI 教學。最終驗收仍包括 3D 賽車、紅色警戒式 RTS、放置戰鬥、AVG、自走棋、老虎機與魚機。

正式 gate 以 `D:/Projects/Unone_Games/validation/acceptance-matrix.json` 為準；可用以下命令檢查，任何一個 gate 未完成都會以非零狀態回報：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:/Projects/Unone/scripts/validate-game-matrix.ps1 -MatrixPath D:/Projects/Unone_Games/validation/acceptance-matrix.json
```
