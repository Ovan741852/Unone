# Live Web host smoke

這是 snapshot bridge 之後的第一個 live Web vertical slice。Emscripten binary 透過明確的 C ABI 暴露 project payload load、script reload、pointer、tick 與 snapshot read；browser host 每個 animation frame 將 pointer frame 傳入，同一個 Rust/Luau runtime tick，再以 WebGPU render 回傳的 world state。

它使用 browser 提供的 `project.json` 與 `reload.luau` fixture，已驗證 host-provided source/scene load 與 script hot reload；仍不代表任意遊戲專案已經有 bundle manifest、驗證下載、generation activation 或 browser storage adapter。

建置並啟動：

```powershell
.\scripts\build-web-live.ps1
python -m http.server 8000
```

開啟 `http://127.0.0.1:8000/web/live/`。成功時 status 會持續更新 `passed: live WASM frame …`，右側 `frame` 會遞增；拖曳 canvas 會將 browser pointer 經 Camera2D 轉換後送進 Rust runtime；按 `Reload Luau script` 可驗證保留 world state 的 source reload。
