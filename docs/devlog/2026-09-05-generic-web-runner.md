# Generic Web game runner

日期：2026-09-05

現有 `web/live/` 是固定 bundle smoke project；為了讓七類 business slice 使用同一套 host，新增 `web/runner/`，由 host 讀取各遊戲自己的 project config、scene、Luau source，再交給同一個 Emscripten/Wasm runtime。這保留 engine／業務端邊界，不複製 simulation 或把遊戲資料搬進 engine repo。

本輪補上 Web ABI 的完整 `InputFrame` JSON setter，讓 keyboard/UI action 不只支援 scalar pointer；Rust 仍用 `EngineRuntime::tick_with_input` 做唯一 frame boundary。Web renderer 現在可消費既有 2D snapshot 與最小 3D debug cube projection，並以 DOM overlay 消費遊戲端 UI tree。

瀏覽器 smoke 已實際載入並持續跑過 `3d-racing`、`red-alert-rts`、`fish-machine`；3D Racing 畫面包含紅色 player cube、藍色 rival cube、透視賽道、UI 與 semantic state。這是 generic game host evidence，不是 production asset、CDN/bundle 或 final gate pass。3D Racing browser screenshot 已在本輪瀏覽器驗證中取得，但目前沒有把瀏覽器產出的暫存圖片冒充成本地 devlog artifact；既有可點擊的截圖仍保留在 `docs/devlog/`。
