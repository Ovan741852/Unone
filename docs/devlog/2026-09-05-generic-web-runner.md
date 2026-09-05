# Generic Web game runner

日期：2026-09-05

現有 `web/live/` 是固定 bundle smoke project；為了讓七類 business slice 使用同一套 host，新增 `web/runner/`，由 host 讀取各遊戲自己的 project config、scene、Luau source，再交給同一個 Emscripten/Wasm runtime。這保留 engine／業務端邊界，不複製 simulation 或把遊戲資料搬進 engine repo。

本輪補上 Web ABI 的完整 `InputFrame` JSON setter，讓 keyboard/UI action 不只支援 scalar pointer；Rust 仍用 `EngineRuntime::tick_with_input` 做唯一 frame boundary。Web renderer 現在可消費既有 2D snapshot 與最小 3D debug cube projection，並以 DOM overlay 消費遊戲端 UI tree。

瀏覽器 smoke 已實際載入並持續跑過 `3d-racing`、`red-alert-rts`、`fish-machine`；3D Racing 畫面包含紅色 player cube、藍色 rival cube、透視賽道、UI 與 semantic state。這是 generic game host evidence，不是 production asset、CDN/bundle 或 final gate pass。3D Racing browser screenshot 已在本輪瀏覽器驗證中取得，但目前沒有把瀏覽器產出的暫存圖片冒充成本地 devlog artifact；既有可點擊的截圖仍保留在 `docs/devlog/`。

本輪新增 `game bundle pack` 與 MCP `unone_bundle_pack`。它只生成 project/script/scene 三個 runtime bundle，計算 size/SHA-256，內容未變更時保持 manifest version，內容變更時才遞增，並自動設定 `project.unone.json.bundle_manifest`。3D Racing 已生成 `bundles/manifest.json`；native `bundle inspect` 與 `bundle install script` 通過，active generation 同時包含 project 與 script 依賴。

瀏覽器首次接入 3D Racing bundle 時發現 Web host 將 `source` 錯解成 manifest directory-relative，造成 project 404；修正為依照跨平台 manifest contract 由 host 解析 project-root-relative source，並以每個 project 獨立 IndexedDB database 避免不同遊戲互相覆蓋 active generation。修正後瀏覽器持續跑到 frame 1636，bundle state 顯示 `already_active`, generation 1，按鈕 reload 通過 Luau hot reload；按 Save 後重載頁面，`restored` 與原 save payload 均可見。問題記錄於 `docs/issues/2026-09-05-web-bundle-source-root.md`。

接著在瀏覽器保持 3D Racing generation 1 時，將遊戲端啟動 log 改為 `racing_3d_bundle_v2_ready`，再執行 `bundle pack`。manifest version 由 1 變為 2，只有 script hash 改變；project/scene hash 沒變。runner 的 reload 實際啟用 generation 2，讀取 cache 中未變更的 bundle、重新取得並驗證 script，再在同一 runtime 執行 Luau hot reload；native `bundle install script` 也建立 generation 3。修改是 behavior-compatible 的內容變更，3 個 3D Racing deterministic tests 仍通過；完整 asset hot update、失敗回滾的實際遊戲頁面證據仍待補。

依既定流程執行 Claude CLI `2.1.260` 第 24 次 read-only review；約 65 秒沒有任何 stdout/stderr，Ctrl+C 中止，沒有可判讀 findings，故不算 review 通過。詳見 `docs/issues/2026-09-05-claude-cli-review-timeout-24.md`。
