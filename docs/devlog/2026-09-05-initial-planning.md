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
- 依 review 流程重試 Claude CLI：本次執行 60 秒無輸出後中止，沒有 review 結果，不算通過；詳見 `docs/issues/2026-09-05-claude-cli-review-timeout-2.md`。
- 官方 Luau 0.734 Windows `luau-analyze` 已在本機 tool cache 對 sample 通過；`game check --types` adapter 已加入。若 analyzer 不存在會回傳 `LUAU_ANALYZER_NOT_FOUND`，不把 `--!strict` 字串誤稱為完整型別檢查。
- 物理 sample 初次 run 發現 `run()` 清空 trace 會吃掉 `Game.start()` 的語意 log；已移除清空行為，讓 lifecycle trace 可被 AI 觀察，避免「腳本確實記錄但輸出為空」的誤導。
- 建立 `minimal-2d-physics` 驗證專案：Luau 只負責 launch policy，engine 負責 dynamic/static circle、gravity、ground collision、fixed-step integration；120 frames 後 bird `x=12`、`y=0.5`，且 `physics_launch_applied` trace 可被觀察。
- 新增 physics regression tests：dynamic body 落地停止、dynamic body 與 static circle 的碰撞分離；目前只做必要機制，不先加入 friction、joints、polygon solver 或遊戲專用名詞。邊界記錄於 `docs/decisions/0006-minimal-2d-physics-boundary.md`。
- 發現 native preview renderer 硬編碼 `player` id，會讓其他遊戲命名無法預覽；分類為 engine boundary 問題，已改成依 stable entity ordering 選取預覽目標，移除遊戲業務命名依賴。
- native physics preview 已啟動並截圖：`docs/devlog/2026-09-05-physics-preview.png`；視窗顯示 `bird` 專案的物件，證明 preview 不再依賴 `player` 這個遊戲專用 id。
- 首次 Web compile check：`wasm32-unknown-unknown` target 已安裝，但 `mlua-sys` 編譯 vendored Luau 找不到 `clang++`；官方 LLVM 安裝嘗試被 Windows 取消。分類為 platform/toolchain issue，詳見 `docs/issues/2026-09-05-wasm-luau-toolchain.md`，因此 Web smoke 尚未通過。
- Camera API 接入後第一次 sample typecheck 發現 physics 腳本的 local `EngineApi` 遺漏 `camera` 欄位；官方 analyzer 回報 `Key 'camera' not found in table 'EngineApi'`。分類為 game-side contract drift，補上 sample 型別定義後重新驗證。
- Camera2D 已加入最小 contract：引擎持有 position／zoom，Luau 持有 follow policy；physics sample run 後 observation 回報 camera position `x=9.9,y=0.5`，`api search "camera zoom"` 可回傳四個 camera API 的語意 metadata。Camera 邊界記錄於 `docs/decisions/0007-2d-camera-boundary.md`。
- 對 `4a46f06` 依流程重試 Claude CLI review，第三次仍 60 秒無輸出，沒有 findings，不算通過；詳見 `docs/issues/2026-09-05-claude-cli-review-timeout-3.md`。
- 加入 `TestSpec.input_sequence` 與 `run_with_input_sequence`：測試可逐 frame 注入語意 action snapshot，序列不足的 frame 會清空 input；新增 regression test 證明序列以本次 run 為相對起點且不會 sticky。這是 Angry Birds input replay 的引擎機制，觸控／滑鼠座標轉換仍留在 platform adapter。
- CLI 已加入 `run --input-sequence <json>`，沿用同一個 action snapshot 格式；`--action` 與它互斥，檔案讀取／JSON 格式錯誤會回傳可行動 diagnostic。這讓 AI 不需要操作 GUI 就能重播多 frame 輸入。
- Web toolchain 第二輪驗證：改用 Rust `wasm32-unknown-emscripten` target 搭配完整 Emscripten wrapper；`cargo check -p unone-engine --target wasm32-unknown-emscripten` 通過。先前 `wasm32-unknown-unknown` 的 `No thread API` 被判定為 target override／sysroot 不匹配，不是引擎邏輯問題。
- 為 native／Web 共用 runtime 補上 `EngineRuntime::load_source`：Web host 負責 fetch／cache 後以記憶體提供 scene 與 Luau source；引擎仍只負責 Luau、world、physics、input 與 observation。新增 regression test 證明沒有 project files 也能執行同一 runtime。
- Web compile 的證據仍只到 engine library；瀏覽器 WebGPU host、平台 capability report 與固定 CI toolchain 尚未宣稱完成，避免把編譯通過誤報成跨平台運行通過。
- 依重大切片節奏再次執行 Claude CLI read-only review；CLI 可啟動但 60 秒無輸出，已中止且不算 review 通過，詳見 `docs/issues/2026-09-05-claude-cli-review-timeout-4.md`。
