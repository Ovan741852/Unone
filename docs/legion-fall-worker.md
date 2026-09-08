# 萬人大戰：真正 Web Worker 與 BlueStacks 實測

先建立可執行的 Worker player，再測同一份匯出遊戲。**Worker 擁有完整的
Luau/WASM 模擬，主執行緒負責 Three 渲染**。遊戲 Lua 沒有改，沒有把戰鬥規則
寫進 Rust 或 JavaScript。這是可重跑的實驗 player，尚未成為正式 export 預設；
輸入、音訊、save、hot reload 與通用 developer API 的非同步橋接仍待整合。
既有 `api.jobs` 在正式 Web player 仍是 inline，不宣稱已變成平行 job pool。

[20 秒 BlueStacks 實錄影片](media/legion-fall-worker-bluestacks.mp4) ·
[錄製條件](media/legion-fall-worker-bluestacks.md) ·
[程式與重跑方式](../experiments/worker-player/README.md)

## 最終對照

固定一萬人存活、廣角、seed 42、空 input、暖機至少 120 tick、每次測 30 秒。
不開主動 profiler、不錄影、不編譯；測試逐一執行。桌面 canvas 1280×720，
BlueStacks canvas 1920×1080（同為 1280×720 CSS，模擬器 DPR 1.5）。
跨裝置解析度不同，應比較各裝置自己的 main/worker 對照。

| 場次 | RAF FPS | 模擬 tick/s | 丟棄 tick | RAF 間隔 p95 | tick mean / p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| desktop-final-main | 162.24 | 59.98 | 0 | 11.10 ms | 6.91 / 10.90 ms |
| desktop-final-worker | 179.87 | 60.00 | 0 | 5.70 ms | 7.09 / 11.20 ms |
| blue-final-main | 60.00 | 60.00 | 0 | 16.80 ms | 6.93 / 11.00 ms |
| blue-final-worker | 60.00 | 59.99 | 0 | 16.80 ms | 6.64 / 10.70 ms |

桌面 RAF 平均約 **162 → 180**，p95 間隔約 **11.1 → 5.7 ms**。模擬本身
沒有變快（6.91 → 7.09 ms）；收益是渲染與模擬能重疊執行。
BlueStacks 兩版都是 **60 FPS、約 60 tick/s、零丟棄 tick**，不能宣稱增加了 FPS。
Worker 讓每 tick 約 6.6 ms 的模擬不再佔主執行緒，增加後續 UI/互動的餘裕，
但這次沒有另外量互動延遲，因此不給它一個虛構的改善百分比。

這些是 RAF 與 CPU render completion，不是螢幕掃描輸出；戰鬥仍以 **20 Hz**
提交姿態，重畫同一狀態不代表 180 個不同戰鬥姿態。最終版本每裝置一組
30 秒對照，不能當跨機器統計保證。較早探索場次的 HUD/量測程式有調整，
不混入最終表格。BlueStacks 也不能代表實體手機。

## 只搬索敵是否值得？

獨立的 Luau safe-point 取樣：`acquire` 823 / 4635，約 **17.8%** 的 Lua 樣本；
`rebuildGrid` 約 20.4%，`publish` 約 35.6%。這些是 inclusive 樣本占比，不能
直接換算成整幀毫秒；取樣可能偏向安全點密集的函式。

索敵仍值得優化，但不是唯一熱點。它目前會讀正在依序移動中的單位；只抽索敵
到 Worker 需要固定 query snapshot，會改變原本的選敵語意。這輪先搬整個模擬，
避免多一份每幀單位快照，也讓 grid、移動、Lua 發布及 canonical 編碼一起離開
主執行緒。**以上 FPS 不是「只搬索敵」的結果。**

## 傳輸與正確性

- 每次 instance revision/layout 改變，Worker 複製 packed bytes 到 transferable
  ArrayBuffer；主執行緒持有該 buffer。不是跨 Worker 共用 WASM 記憶體。
- 一次最多一份 state 等待 ACK；慢的主執行緒不會造成無限制訊息堆積。
  背壓可以省略中間顯示狀態，但不省略模擬 tick。兩端排程各自另有 catch-up
  上限，丟棄計數如上表。
- BlueStacks packed instance 傳輸約 **8.7 MB/s**，不含 metadata/IPC overhead。
  Worker packing mean 約 **0.055 ms**；訊息到主執行緒的平均延遲約 **0.246 ms**，
  p95 約 **0.400 ms**。後者包含 browser queue/clone/delivery，非純 IPC 時間。
- 真實瀏覽器 Worker vs main：180 個 tick 的 canonical digest，以及約
  **72.6 MB** 的 instance bytes 全數相同。
- 最終桌面、BlueStacks、main、Worker 四場的共同 15 個絕對 frame checkpoint
  全數相同。不是只比較同名專案或 binary 內字串。

[原始數字與 hashes](evidence/2026-09-08-worker-player/build.json)：
[桌面 main](evidence/2026-09-08-worker-player/desktop-final-main.json)、
[桌面 Worker](evidence/2026-09-08-worker-player/desktop-final-worker.json)、
[BlueStacks main](evidence/2026-09-08-worker-player/blue-final-main.json)、
[BlueStacks Worker](evidence/2026-09-08-worker-player/blue-final-worker.json)、
[函式取樣](evidence/2026-09-08-worker-player/function-samples.json)、
[逐 byte 驗證](evidence/2026-09-08-worker-player/desktop-parity.json)、
[跨 host checkpoints](evidence/2026-09-08-worker-player/cross-host-checkpoints.json)。
