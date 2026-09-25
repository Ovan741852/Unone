# 雲水鎮本機直播控制器

這個工具只控制本機已安裝的 OBS WebSocket。它只接受 `WuxiaTown` profile、`WuxiaTown` scene collection、`WuxiaTown` program scene，以及六個白名單來源：雲水鎮 Browser Source、任務列背景、標題、任務文字、授權音樂與 attribution。未知來源、巢狀/group、桌面/視窗/裝置/麥克風/系統音源都會拒絕。

## 指令

```text
node tools/town-broadcast.mjs prepare
node tools/town-broadcast.mjs configure-encoder
node tools/town-broadcast.mjs encoder-status
node tools/town-broadcast.mjs preflight
node tools/town-broadcast.mjs screenshot
node tools/town-broadcast.mjs record
node tools/town-broadcast.mjs stop-record
node tools/town-broadcast.mjs status
node --test tools/town-broadcast-offline.test.mjs
```

`prepare` 只在串流與錄影停止時切到隔離的 WuxiaTown profile/collection，補齊或修復白名單來源，並把既有 stream key 留在 OBS 記憶體設定中；服務型別固定為 `rtmp_custom`、伺服器固定為 `rtmps://a.rtmps.youtube.com/live2`。key 不進 argv、README、測試、診斷輸出或錯誤訊息。

`configure-encoder` 只在 stream/record 都停止時作用於 WuxiaTown：把 Output mode 切為 Advanced、使用 `obs_nvenc_h264_tex`、CBR 6000、`keyint_sec=2`，AAC 160 kbps、48 kHz；會先保留原本的 `streamEncoder.json` 為 `streamEncoder.json.bak`，再透過 OBS API 設定必要的 `Output`/`AdvOut` 欄位並切換 profile 回 WuxiaTown 重新載入。它不修改「無標題」profile，也不改場景構圖。`encoder-status` 只讀取並去敏回報這些欄位。

Browser Source 固定為 `http://127.0.0.1:8088/` 且 muted。唯一可出聲來源是 `assets/audio/Guzheng City.mp3`，SHA256 必須為 `7d117a43cad22ff05b32340f2bd331368c48342f503eab85b1e5c403043d4be6`，loop、-24 dB、監聽關閉；完整作者、來源、CC BY 4.0 與修改資訊會顯示在 attribution。

`record` 是本機試錄入口，不會呼叫 `StartStream`；開始後需另執行 `stop-record`。`screenshot` 直接使用 OBS `GetSourceScreenshot` 寫入 `.runtime/town-broadcast-preview.png`。本輪不操作 YouTube、不建立公開場次、不執行 `stream`。

若日後由主代理完成畫面與本機試錄驗收，公開開播仍需另外執行：

```text
node tools/town-broadcast.mjs stream --confirmed-public
```

這個旗標只是最後的人為門檻，不代表工具會替使用者確認 YouTube Studio 或公開場次狀態。

## 已知限制

- 本輪沒有執行 `stream`，沒有操作 YouTube、建立公開場次或驗證 Studio 收流；由主代理接手最後公開開播。
- 沒有做 2 分鐘收流觀察或 10 分鐘持續穩定性驗證，也不提供自動重啟；OBS/RTMPS 崩潰或斷線會直接回報失敗。
- `rtmp_custom` 與 Advanced NVENC 2 秒 keyframe 已完成本機驗證，但不宣稱已根治 OBS YouTube dock 的歷史 crash。
