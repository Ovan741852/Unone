# WebGPU host smoke

這是 browser host 的第一個垂直切片：`game run --json` 產出的 `WorldSnapshot` 由 host 載入，瀏覽器以 WebGPU 畫出 engine entities，並把 pointer event 轉成與 native 相同的 world-space semantic shape。

它刻意不是 live WASM game loop：目前 Emscripten smoke 是一次性 runtime；本頁不把 snapshot bridge 說成完整 Web platform。下一步才是把相同 `EngineRuntime` 接到 browser-owned frame loop，並由 host 決定 fetch/cache/storage。

在 `D:/Projects/Unone` 執行：

```powershell
.\scripts\export-web-host-snapshot.ps1
python -m http.server 8000
```

開啟 `http://127.0.0.1:8000/web/host/`。成功時頁面顯示 `passed: WebGPU rendered 3 engine entities`；在 canvas 拖曳時，右側會顯示最近的 world-space pointer frame。

若瀏覽器沒有 WebGPU，頁面會明確顯示失敗，不會偷偷退回另一個 renderer。
