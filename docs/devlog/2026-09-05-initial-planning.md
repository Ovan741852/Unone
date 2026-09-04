# 開發日誌：初始規劃

日期：2026-09-05

## 觀察

- `D:/Projects/Unone/` 目前沒有引擎原始碼。
- `D:/Projects/Unone_Games/` 目前是空的，尚未有驗證遊戲。
- 技術初稿已提出 Rust + Luau + wgpu + CLI/MCP + semantic diagnostics 的完整方向。

## 本次決策

- `Unone` 作為引擎工作區；`Unone_Games` 作為遊戲驗證工作區。
- 先做 native 2D 垂直切片，再用 Web smoke build 與憤怒鳥 2D 驗證。
- 不在第一階段同時建立 MCP、完整 Editor、3D、網路與多種測試格式。

## 證據與截圖

本次尚未有可截取的引擎畫面；等第一個 native app 能啟動後補上 screenshot。

## 下一步

建立 Rust workspace、2D sprite、Luau host、check/reload、headless observation 與第一個 regression test。

## 實作進度補記

- Rust workspace 與 vendored Luau host 已建立。
- `minimal-2d` 的 `game check` 通過，入口腳本使用 `--!strict`。
- `game run --headless --frames 60 --action Right` 通過；Player x=0 → x=4，產生 observation digest。
- 已加入 deterministic digest 與 failed-reload regression tests，待 `cargo test` 驗證。

## 工程驗證結果

- `cargo test --workspace` 通過：2 個 engine regression tests、CLI/doc tests 無失敗。
- `game test --json` 通過：`minimal-2d` 的 `player_moves_right` manifest test 成功。
- 移除預設逐幀 trace，避免 AI 觀測輸出被 frame noise 淹沒；只保留語意事件。
- 本地 Git 已初始化，baseline commit：`8a4e598`。
- Claude CLI `2.1.206` 已安裝；兩次 read-only code review 都未完成（一次 OAuth 過期、一次無輸出超時），詳見 `docs/issues/2026-09-05-claude-cli-auth-expired.md`。
- 已確認「只做必要的」是整個產品的全域規則；MVVM 採用於 Luau UI/presentation，不套用到 ECS simulation。
- native preview 已以 winit + wgpu 啟動，並成功顯示由 Luau 更新位置的 Player 矩形；截圖：`docs/devlog/2026-09-05-native-preview.png`。
- wgpu 30 API 適配完成；依賴版本已寫入 `Cargo.lock`，避免 renderer 編譯環境漂移。
- 對外 observation 將浮點值量化至 6 位小數，內部 simulation 仍保留精度；GPU surface capability 缺失改回傳錯誤，不再直接 panic。
- `cargo clippy --workspace --all-targets -- -D warnings` 通過。
- Bundle runtime 已加入：manifest、依賴安裝、串流 hash 驗證、content-addressed cache、cache 二次驗證與 generation activation；sample bundle inspect/install 通過。
- 已建立 `README.md` 與 `docs/ai-workflow.md`，明確標示目前 `check` 只保證語法與 entrypoint contract，避免把尚未接入的 Luau static analyzer 說成已完成。
- 驗證遊戲 workspace `D:/Projects/Unone_Games/` 已獨立 `git init`；`.unone/` 只保留本機 cache、staging 與 active generation，不進版本庫。
- `game preview --watch` 已加入：以腳本修改時間與檔案大小做輕量輪詢，變更時在等待 frame 嘗試 reload；失敗會只回報一次並保留舊腳本，待下一次檔案變更再重試。
- `cargo test --workspace` 通過 5 個 engine tests；新增 reload success + state preservation regression test。`cargo clippy --workspace --all-targets -- -D warnings`、sample `check`、`test`、`bundle inspect` 均通過。
- 目前仍未宣稱完整型別檢查、Web/mobile、MCP 或七類遊戲驗收完成；這些保留在後續階段，避免把原型能力說成引擎完成。
- 已加入最小 AI 語意入口：`project inspect`、`api search`、`api describe`。API metadata 回報用途、適用／不適用情境、參數、回傳、side effects、frame semantics、常見錯誤與範例；先覆蓋現有公開 Luau API，不做全量 Rust 反射。
