# Live Web host smoke

這是 snapshot bridge 之後的第一個 live Web vertical slice。Emscripten binary 透過明確的 C ABI 暴露 `init`、`set_pointer`、`tick` 與 snapshot read；browser host 每個 animation frame 將 pointer frame 傳入，同一個 Rust/Luau runtime tick，再以 WebGPU render 回傳的 world state。

它使用固定的 `WebLiveSmoke` fixture，不代表任意遊戲專案已經有通用的 WASM loader、hot update 或 browser storage。那些仍由 host contract 的下一階段負責。

建置並啟動：

```powershell
.\scripts\build-web-live.ps1
python -m http.server 8000
```

開啟 `http://127.0.0.1:8000/web/live/`。成功時 status 會持續更新 `passed: live WASM frame …`，右側 `frame` 會遞增；拖曳 canvas 會將 browser pointer 經 Camera2D 轉換後送進 Rust runtime。
