# WebGPU host smoke

這是 browser host 的第一個垂直切片：`game run --json` 產出的 `WorldSnapshot` 由 host 載入，瀏覽器以 WebGPU 畫出 engine entities，並把 pointer event 轉成與 native 相同的 world-space semantic shape。

它刻意不是 live WASM game loop：本頁只驗證 snapshot bridge。`web/live/` 已另有 host-provided project loader、bundle verify/IndexedDB generation smoke 與 live WASM frame loop；本頁不把 snapshot bridge 說成完整 Web platform。完整 CDN policy、背景下載與 asset streaming 仍留在後續 host 工作。

在 `D:/Projects/Unone` 執行：

```powershell
.\scripts\export-web-host-snapshot.ps1
python scripts/serve-player.py --directory . --port 8000 --no-cache
```

開啟 `http://127.0.0.1:8000/web/host/`。成功時頁面顯示 `passed: WebGPU rendered 3 engine entities`；在 canvas 拖曳時，右側會顯示最近的 world-space pointer frame。

這裡以 repo root 為 server root，供 source smoke 使用；正式遊戲請使用
[player export](../../docs/player-export.md) 並 serve export 目錄。Helper 固定
`.js`／`.mjs` 的 JavaScript MIME 與 `.wasm` 的 `application/wasm`；其他
static server 也必須提供這些 MIME types，不能讓 module 回傳 `text/plain`。

若瀏覽器沒有 WebGPU，頁面會明確顯示失敗，不會偷偷退回另一個 renderer。
