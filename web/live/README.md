# Live Web host smoke

這是 snapshot bridge 之後的第一個 live Web vertical slice。Emscripten binary 透過明確的 C ABI 暴露 bundle incremental verify、project payload load、save payload injection、script reload、pointer、tick 與 snapshot read；browser host 用 IndexedDB 保存 content-addressed bundle，所有 bundle 驗證完成後才以 transaction 啟用 generation，每個 animation frame 再將 pointer frame 傳入同一個 Rust/Luau runtime tick，最後以 WebGPU render 回傳的 world state。

`bundle-manifest-v1.json` 會安裝 `project` 與依賴它的 `script` bundle；`Apply bundle update` 載入 v2 manifest，只重新下載變更過的 script，驗證並啟用新 generation 後，再以同一個 runtime 的 source reload 保留 world state。啟動失敗不會切換 active generation。這是 browser storage/generation contract 的 smoke，不代表任意遊戲專案已經有完整 CDN、差分更新、背景下載或 asset streaming。

建置並啟動：

```powershell
.\scripts\build-web-live.ps1
python -m http.server 8000
```

開啟 `http://127.0.0.1:8000/web/live/`。成功時 status 會持續更新 `passed: live WASM frame …`，右側 `frame` 會遞增；拖曳 canvas 會將 browser pointer 經 Camera2D 轉換後送進 Rust runtime；`Reload Luau script` 讀取目前 active generation 的 script，`Apply bundle update` 驗證、快取並啟用 v2 generation，再驗證 hot reload。

`bundle-store.js` 是 host adapter，不是 engine core：它負責 fetch、IndexedDB、cache miss、瀏覽器 transaction 與 storage 生命週期；Rust/Wasm 只負責以 bounded chunks 驗證 manifest 的 size/SHA-256。瀏覽器 WebCrypto 不作為唯一 hash 來源，避免 native/Web 演算法漂移；大 bundle 也不要求一次塞進 WebCrypto digest。

Host 可在第一次 tick 前呼叫 `unone_web_set_save_payload` 注入 JSON；每次 semantic snapshot 會帶目前 `save_payload`。持久化檔案、schema/version/migration 與 IndexedDB key 仍由 host／遊戲端負責。
