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
- 加入 `TestSpec.input_sequence` 與 `run_with_input_sequence`：第一版測試可逐 frame 注入語意 action snapshot，序列不足的 frame 會清空 input；新增 regression test 證明序列以本次 run 為相對起點且不會 sticky。這是 Angry Birds input replay 的引擎機制，觸控／滑鼠座標轉換仍留在 platform adapter。
- CLI 已加入 `run --input-sequence <json>`，第一版沿用 action snapshot 格式；`--action` 與它互斥，檔案讀取／JSON 格式錯誤會回傳可行動 diagnostic。後續已演進為明確的 `InputFrame`（`actions`／`pointer`），讓 AI 不需要操作 GUI 就能重播多 frame 輸入。
- Web toolchain 第二輪驗證：改用 Rust `wasm32-unknown-emscripten` target 搭配完整 Emscripten wrapper；`cargo check -p unone-engine --target wasm32-unknown-emscripten` 通過。先前 `wasm32-unknown-unknown` 的 `No thread API` 被判定為 target override／sysroot 不匹配，不是引擎邏輯問題。
- 為 native／Web 共用 runtime 補上 `EngineRuntime::load_source`：Web host 負責 fetch／cache 後以記憶體提供 scene 與 Luau source；引擎仍只負責 Luau、world、physics、input 與 observation。新增 regression test 證明沒有 project files 也能執行同一 runtime。
- Web compile 的證據仍只到 engine library；瀏覽器 WebGPU host、平台 capability report 與固定 CI toolchain 尚未宣稱完成，避免把編譯通過誤報成跨平台運行通過。
- 依重大切片節奏再次執行 Claude CLI read-only review；CLI 可啟動但 60 秒無輸出，已中止且不算 review 通過，詳見 `docs/issues/2026-09-05-claude-cli-review-timeout-4.md`。
- 建立 `D:/Projects/Unone_Games/angry-birds-2d/` 第一個遊戲型驗證切片：三個 scene entities、Luau `Launch` action、拋射與落地測試通過；`check --types`、headless `test` 與 input replay `run` 均通過。native preview 已截圖至 `docs/devlog/2026-09-05-angry-birds-preview.png`。
- 手動 replay 初次使用了尚未建立的 `launch-sequence.json`，雖然 test manifest 內嵌 sequence 已通過，仍造成教學命令失敗；補上可重播 fixture 並在 game README 寫入完整命令，避免測試與教學使用不同輸入來源。
- 累積至下一個 review 間隔後再次執行 Claude CLI read-only review；連續 60 秒無輸出後中止，沒有 findings，故不算通過，詳見 `docs/issues/2026-09-05-claude-cli-review-timeout-5.md`。
- 發現 `RunReport.seed` 原本只被記錄、沒有進入 runtime；分類為引擎 deterministic contract 問題。加入 seeded Luau `random.nextFloat`／`random.nextInt`、inclusive range validation、unbiased rejection sampling 與 seed regression test，並更新三個 sample 的 contract types。
- 新增 `platform capabilities` Developer Protocol query，讓 AI 可先讀 target family、可用 project loader、hot reload mode、已驗證 runtime 與待完成 host work；native 輸出明確列出 iOS／Android wrapper 尚未完成，避免平台能力被猜測。
- pointer input slice 完成：`InputFrame` 改為明確的 `actions`／world-space `pointer` schema，Luau 暴露 `getPointerPosition`／`isPointerDown`，native preview 完成滑鼠到 world 的 Camera2D 反轉，Angry Birds 新增 pointer drag/release headless test 並通過。邊界記錄於 `docs/decisions/0009-semantic-pointer-input.md`。
- Web smoke／seeded RNG／platform query 切片後依節奏執行 Claude CLI read-only review；連續 60 秒無輸出後中止，沒有 findings，故不算通過，詳見 `docs/issues/2026-09-05-claude-cli-review-timeout-6.md`。
- Web smoke host 首次 cdylib link 發現 side module 需要 PIC；依影響範圍判定為 Emscripten/C++ exception model 的 platform architecture 問題，改用主模組 executable，清理舊 `mlua-sys` cache 後加上 `-fwasm-exceptions` 重建成功。Node 執行 `.js + .wasm` 完成 60 frames 並輸出 observation digest；瀏覽器 WebGPU page 仍未宣稱完成。
- Node 直接執行 Web smoke 時發現預設未開啟 Emscripten exception section 所需的 exnref；分類為 host runtime 條件問題，不是引擎邏輯問題。以 `node --experimental-wasm-exnref .../unone_web_smoke.js` 重跑成功，並將 flag 寫入 toolchain 文件與 issue，避免普通 `node` 命令被誤記為可用。
- pointer input 與 Web toolchain 文件切片後依流程執行 Claude CLI `2.1.260` read-only review；約 60 秒完全無輸出後中止，沒有可判讀 findings，故不算通過，詳見 `docs/issues/2026-09-05-claude-cli-review-timeout-7.md`。
- bundle runtime 補上 `BundleFetcher` host boundary：引擎以 reader 做 streaming size/SHA-256 verify、`.part` staging、sync、cache commit 與 generation activation；native local file 是 adapter，Web/mobile fetch 與 storage policy 留在 host。新增 cache-only source 與驗證失敗保留上一代的 regression tests，決策記錄於 `docs/decisions/0010-bundle-fetch-boundary.md`。
- 建立 `web/smoke/index.html` 並以本地 browser 實際載入 Emscripten `.js + .wasm`；DOM 顯示 `passed: 60 deterministic frames executed`，observation digest 與 Node smoke 一致。截圖保存於 `docs/devlog/2026-09-05-web-browser-runtime-smoke.png`；這只通過 browser runtime smoke，WebGPU game host、browser input 與 storage adapter 仍未完成。
- 依官方 MCP 2025-11-25 lifecycle／stdio 邊界建立 `game mcp` 薄轉接：initialize、initialized、ping、tools/list、tools/call，工具只呼叫既有 CLI/engine operations，stdout 僅輸出 JSON-RPC。整合 smoke 驗證 10 tools、project inspect、deterministic run、API describe；邊界記錄於 `docs/decisions/0011-mcp-thin-adapter.md`。
- 將 MCP stdio 驗證收成 `scripts/mcp-smoke.ps1`，避免人工解析 response 行列造成假成功；目前輸出為 `protocol=2025-11-25, tools=10, conflict=MCP_ARGUMENT_CONFLICT`。
- MCP adapter 切片後依流程執行 Claude CLI `2.1.260` read-only review；約 60 秒完全無輸出後中止，沒有可判讀 findings，故不算通過，詳見 `docs/issues/2026-09-05-claude-cli-review-timeout-9.md`。
- bundle slice 後依流程執行 Claude CLI `2.1.260` read-only review；約 60 秒完全無輸出後中止，沒有可判讀 findings，故不算通過，詳見 `docs/issues/2026-09-05-claude-cli-review-timeout-8.md`。
- 修正 Angry Birds README 的過時說法：pointer drag 已有 headless regression test，不再列為未完成。引擎新增 `SpriteData.size` scene contract 與 `SCENE_SPRITE_INVALID` 語意診斷；native preview 依 scene 尺寸畫 procedural quad。此切片只補必要的幾何契約，沒有把真實 asset pipeline 或遊戲規則塞進 engine。截圖：`docs/devlog/2026-09-05-angry-birds-sprite-size-preview.png`。
- 依重要垂直切片執行 Claude CLI `2.1.260` 第十次 read-only review；約 60 秒完全無輸出後中止，沒有 findings，故不算 review 通過，詳見 `docs/issues/2026-09-05-claude-cli-review-timeout-10.md`。
- 建立 `web/host/` 第一個 WebGPU snapshot bridge：由 engine CLI 產生 Angry Birds `WorldSnapshot`，browser host 以 WebGPU render 3 個 entities，並以實際 pointer drag 驗證 `{position, down}` world-space semantic frame。瀏覽器 DOM 顯示 `passed: WebGPU rendered 3 engine entities`、console 無 warning/error；明確記錄這仍不是 live WASM game loop。截圖：`docs/devlog/2026-09-05-webgpu-host.png`。
- 依重要垂直切片執行 Claude CLI `2.1.260` 第十一次 read-only review；約 60 秒完全無輸出後中止，沒有 findings，故不算 review 通過，詳見 `docs/issues/2026-09-05-claude-cli-review-timeout-11.md`。
- 發現 browser snapshot host、native preview 與 headless replay 缺少單一 host-to-runtime frame boundary；分類為 engine contract 問題。新增 `EngineRuntime::tick_with_input(InputFrame)`，讓各 host 共用「套用已正規化 input → fixed tick → 回傳 WorldSnapshot」順序；`run_with_input_sequence` 已改用同一入口並加入 regression test，決策記錄於 `docs/decisions/0014-runtime-input-frame-boundary.md`。
- 依 runtime contract 切片執行 Claude CLI `2.1.260` 第十二次 read-only review；約 60 秒完全無輸出後中止，沒有 findings，故不算 review 通過，詳見 `docs/issues/2026-09-05-claude-cli-review-timeout-12.md`。
- 建立 `unone-web-live-smoke` 與 `web/live/`：以窄 C ABI 暴露 init、set pointer、tick、observation pointer/length；實際瀏覽器 animation frame 呼叫同一個 Rust/Luau runtime，pointer drag 後 `web_probe` position 更新，WebGPU render 持續顯示 live frame。固定 fixture 的 page status 從 frame 301 持續遞增至 5,381，DOM/console smoke 通過；截圖：`docs/devlog/2026-09-05-webgpu-live-host.png`。首次 export flag 錯誤已記錄並修正於 `docs/issues/2026-09-05-web-live-export-build-flags.md`。
- live bridge 改為 browser-provided JSON project payload，新增 source reload fixture 與 native C ABI regression test；瀏覽器實測 load、pointer drag、reload 均通過。初次 seed 使用 Number 造成 BigInt ABI error，已修正為 `42n` 並記錄於 `docs/issues/2026-09-05-web-live-seed-bigint.md`；host output 截圖：`docs/devlog/2026-09-05-webgpu-live-project-loader.png`。
- live observation 改為 `{ project, world }` semantic envelope，避免 AI 只看到匿名 `engine-snapshot`；browser 回歸曾因 module cache 暫時顯示舊的 `frame undefined`，已加入版本 query 並記錄於 `docs/issues/2026-09-05-web-live-module-cache-feedback.md`。最新 reload、hot reload、pointer drag 仍通過。
- bundle generation slice 完成：engine 新增共用 `BundleVerifier`，Web C ABI 以 bounded chunks 驗證 size/SHA-256；`web/live/bundle-store.js` 以 IndexedDB content-addressed cache 與 atomic generation transaction 保存 project/script bundles。瀏覽器先通過 v1 activation，再用 v2 只更新 script、保留 project cache，最後以 cache-only reopen 驗證不需要 fetch；DOM/console smoke 通過。Windows `sync_all` 曾回 `os error 5`，已依平台影響範圍改成 `.part` flush/close/rename 並記錄於 `docs/issues/2026-09-05-windows-generation-sync.md`；目前 sample 截圖：`docs/devlog/2026-09-05-webgpu-live-bundle-storage.png`。大型 asset 的 OPFS/chunk writer 仍是 host follow-up，見 `docs/issues/2026-09-05-browser-bundle-memory-buffer.md`。
- bundle generation slice 後依流程執行 Claude CLI `2.1.260` 第十三次 read-only review；約 60 秒完全無輸出後中止，沒有可判讀 findings，故不算 review 通過，詳見 `docs/issues/2026-09-05-claude-cli-review-timeout-13.md`。
- mobile host 前置盤點：Windows 有 Android SDK/`adb` 但沒有 Gradle，沒有 iOS `xcodebuild`，Rust 也尚未安裝 Android/iOS targets；因此只完成 lifecycle/FFI/storage 邊界草案，沒有把 iOS/Android 宣稱為已 build 或實機通過。契約記錄於 `docs/decisions/0017-mobile-host-lifecycle-boundary.md`，環境問題記錄於 `docs/issues/2026-09-05-mobile-host-toolchain-audit.md`。
- Android toolchain follow-up：安裝 `aarch64-linux-android` 與 `x86_64-linux-android` targets，使用 NDK `27.1.12297006` 完成 `unone-engine` cross-compile check；`adb devices -l` 沒有實機或 emulator，Gradle 與 iOS Xcode 仍缺少，所以只更新 Android engine build evidence，不把 host packaging/lifecycle 或七類遊戲驗收標成完成。
- 將 Android target 固定進 `rust-toolchain.toml`，新增 `scripts/check-android-engine.ps1` 自動選擇可用 NDK/clang wrapper 並檢查 `aarch64-linux-android`、`x86_64-linux-android`；腳本只負責 engine cross-compile，不假裝是 APK 或 mobile lifecycle 測試。
- Android cross-compile slice 後依流程執行 Claude CLI `2.1.260` 第十四次 read-only review；約 60 秒完全無輸出後中止，沒有可判讀 findings，故不算 review 通過，詳見 `docs/issues/2026-09-05-claude-cli-review-timeout-14.md`。
- 依使用者最終驗收要求建立 `D:/Projects/Unone_Games/validation/acceptance-matrix.json`：3D 賽車、紅色警戒式 RTS、放置戰鬥、AVG、自走棋、老虎機、魚機是七個 required final gate；Angry Birds 2D 明確標為中期 capability smoke，不可代表 engine 完成。新增 `scripts/validate-game-matrix.ps1`，以 semantic JSON、required evidence 與 fail-closed exit code 檢查矩陣；第一次執行發現 Windows PowerShell 對無 BOM UTF-8 中文腳本解析不穩定，已將 CLI 診斷字串改成 ASCII 並在 Windows PowerShell 實際驗證。決策記錄於 `docs/decisions/0018-seven-game-acceptance-gate.md`。
- 驗收 gate 切片後依流程執行 Claude CLI `2.1.260` 第十五次 read-only review；約 63 秒完全無輸出後中止，沒有可判讀 findings，故不算 review 通過，詳見 `docs/issues/2026-09-05-claude-cli-review-timeout-15.md`。
- mobile host slice：新增獨立 `unone-mobile-ffi` C ABI 與 `include/unone_mobile.h`，覆蓋 opaque session、load、scalar touch/action、semantic input replay、pause/resume、surface lost/resize/safe area、semantic observe 與 script reload；native contract tests 驗證 pause 不推進 frame、surface recreation 不丟 world、scalar pointer bridge、壞 reload 回報 Luau diagnostic 且成功 reload 保留 state。touch normalization、bundle cache/update、package 與實機 lifecycle 仍屬 Android/iOS host smoke，沒有被提前宣稱。這是 host adapter，不是把 mobile API 塞進 `unone-engine`；Android check script 同步驗證 engine 與 adapter。ABI 說明記錄於 `docs/mobile-host-abi.md`。
- mobile FFI 編譯初次抓到 raw pointer lifetime 與 `Vec<u8>`／slice 邊界問題，已改成 FFI call 內 owned payload、明確 `unsafe` helper contract，並保留 scalar input path 避免每幀 JSON；問題分類為 FFI tooling/contract，修正與回歸證據記錄於 `docs/issues/2026-09-05-mobile-ffi-compile-feedback.md`。
- mobile bundle slice：將 engine 共用的 `BundleVerifier` 以 `bundle_begin`／bounded `bundle_write`／`bundle_finish` 暴露給 mobile adapter；host 仍負責 fetch、staging、cache、generation activation 與 rollback。新增成功分塊驗證與 tampered bundle semantic diagnostic tests，避免 Android/iOS 各自重寫 hash 規則；ABI 不暴露任何平台儲存或 CDN API。
- mobile bundle slice 後依流程執行 Claude CLI `2.1.260` 第十六次 read-only review；約 63 秒完全無輸出後中止，沒有可判讀 findings，故不算 review 通過，詳見 `docs/issues/2026-09-05-claude-cli-review-timeout-16.md`。
