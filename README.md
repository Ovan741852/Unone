# Unone

Unone 是 AI-native 遊戲引擎原型：Rust 負責遊戲引擎機制，Luau 負責遊戲規則與內容。引擎目前仍在早期開發，最終必須通過七類遊戲驗證，才算完成長期目標。

## 工作區

- Engine：`D:/Projects/Unone`
- Validation games：`D:/Projects/Unone_Games`
- 技術草案：[docs/ai-native-game-engine-plan-v0.1.md](docs/ai-native-game-engine-plan-v0.1.md)
- AI CLI 流程：[docs/ai-workflow.md](docs/ai-workflow.md)
- Code review 流程：[docs/review-process.md](docs/review-process.md)

## 目前可執行的垂直切片

在 engine workspace 執行：

```powershell
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json project inspect
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json api describe entity.setPosition
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json check
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json run --frames 60 --action Right
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json test
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d preview --watch
```

目前已驗證：Luau entrypoint、`--!strict` contract、官方 `luau-analyze` adapter、headless fixed timestep、seed/input observation digest、failed reload fallback、native wgpu preview、`preview --watch` 腳本熱更、JSON test manifest 與 bundle hash/cache/activation。

完整型別檢查使用 `game check --types`，需要另外安裝並固定版本的官方 `luau-analyze`；工具不存在時引擎會明確回報錯誤，不會把基本 contract check 說成完整型別檢查。

## 邊界

引擎只提供必要的遊戲機制。遊戲規則、數值、ViewModel、UI flow、內容 catalog、下載時機與營運服務留在遊戲專案或服務端。UI 會採 MVVM；ECS + systems 負責高頻模擬。

Bundle 的第一版只包含 manifest、依賴、hash 驗證、content-addressed cache、staging 與 generation activation；不包含 CDN、P2P、差分更新或遠端腳本執行。

## 驗證遊戲

中期先在 `D:/Projects/Unone_Games/` 用憤怒鳥 2D 壓測 2D physics、camera、input replay、scene/prefab、asset、UI、hot reload、headless test 與 AI 教學。最終驗收仍包括 3D 賽車、紅色警戒式 RTS、放置戰鬥、AVG、自走棋、老虎機與魚機。
