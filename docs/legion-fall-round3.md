# 萬軍戰場第三輪：精確 hash 重用與效能工具

固定 replay 的平均 CPU 每步成本降低 **9.8%**，維持一萬人不死亡的壓測降低 **10.7%**。正常與壓測各三組、600 tick，逐 tick digest 全部一致。瀏覽器長幀仍存在，這次不宣稱穩定 60 FPS，也沒有量測手機或 native 圖形效能。

## 保留的改動

引擎層新增通用的 [canonical SHA-256 前綴重用](canonical-hash-cache.md)：逐 byte 確認相同前綴後重用 SHA 中間狀態，每次仍編碼完整 canonical world，結果與完整 SHA-256 相同。16 KiB 分段，最多保留 4 MiB 前綴及 SHA 狀態。不是跳過驗證，也不依賴遊戲的 instance revision。

Lua 遊戲層將三個 tick 的單位工作比例由 34/48/18 改成 **37/53/10**，減輕第三個 tick 同時發布新 instance 資料與 hash 的負擔。仍以 20 Hz 完成戰鬥更新，前兩階段不發布半成品；攻擊、尋敵、傷害都留在 Lua。

尋敵的鄰格候選 ID 快取曾在短測出現改善，但 600 tick 三組測試沒有可靠收益，已撤回。沒有為了效能改掉目標選擇規則，也沒有轉換 ECS。工作分配單獨的收益很小，主要收益來自 hash 重用。

## 固定條件比較

Release development export、同 seed 42／空 input、暖機 30 tick、每組 600 tick、三組交錯 AB/BA、新 Node process、關閉 sampling 與主動 profile window。比較實際匯出 host payload 與 WASM；不含 renderer 或 GPU。

| 情境 | 第二輪 mean | 第三輪 mean | CPU 成本降低 | p95 前 → 後 |
|---|---:|---:|---:|---:|
| 正常戰鬥，允許傷亡 | 15.305 ms | 13.799 ms | 9.84% | 18.940 → 17.332 ms |
| 持續一萬人存活 | 15.542 ms | 13.884 ms | 10.67% | 18.948 → 17.690 ms |

正常戰鬥每組改善 9.72–11.58%，三組方向一致。這是有限實驗的觀察，不是所有裝置的保證。完整條件、產物 hashes、環境、每 tick checkpoints 與各次數字保留在 [正常比較](evidence/2026-09-08-legion-round3/final-comparison.json)／[壓測比較](evidence/2026-09-08-legion-round3/stress-comparison.json)。

分項定位的單次 180 tick 視窗：完整 hash 約 2.50 ms，重用後約 0.94 ms；編碼約 0.34 ms、presentation 約 0.21 ms。180 次發布中 120 次重用前綴，約 65.5% canonical bytes 不必重複 hash，快取配置約 544 KB。分項測試有量測開銷，不能用兩個單次視窗代替上表的交錯比較。

## 瀏覽器檢查

同 1280×720、全程一萬人存活、取樣關閉，各一個探索性視窗。第三輪先測 17.78 秒，第二輪後測 29.30 秒；不是相同遊戲 frame 範圍的嚴格 A/B。

| 指標 | 第二輪 | 第三輪 |
|---|---:|---:|
| WASM tick + 發布平均 | 14.35 ms | 12.53 ms |
| WASM tick + 發布 p95 | 19.10 ms | 16.60 ms |
| CPU 繪製完成次數 / 秒 | 69.1 | 92.6 |
| 繪製間隔 p95 | 23.9 ms | 23.4 ms |
| Renderer CPU 平均 | 0.80 ms | 0.70 ms |
| 視窗內丟棄 tick | 無此指標 | 0 |

[瀏覽器記錄](evidence/2026-09-08-legion-round3/browser-comparison.json)。平均繪製完成次數超過 60，不代表畫面每 16.67 ms 穩定呈現，且 60 Hz 模擬可能被多次繪製。GPU query 屬於另一個滾動視窗，不與 CPU 相加。較早一次測試因尺寸不同，沒有納入比較。

## 工具是否夠用

詳見 [AI 效能工具檢視](performance-tools-review.md)。本輪補上 publication 四個分項、hash 工作量與快取配置量、真實 slowest world frame、掉 tick 視窗差值、每組結果波動與 profile 開關對照。AI SDK 打包規則也納入兩支 Node 工具。

主動視窗三組開關比較，中位數成本約增 0.8%，但各組有正有負，不保證固定開銷。Lua 函式仍是 safe-point sample，不是精確的函式毫秒或呼叫次數；取樣自身也有成本。完整 GC 暫停、配置來源與 GPU 資源 byte 歸因尚未提供。

## 下一個瓶頸與平台邊界

取樣仍以 `acquire`（尋敵）最多。可以另做 Lua 層的重新尋敵 time slicing：保留有效目標，把不同單位的重新搜尋分配到不同固定 tick，定義最大延遲與目標失效規則。這會改變尋敵時機，需要新的遊戲行為基準，不能沿用「與舊 replay 每 tick digest 一致」的純效能承諾。本輪沒有實作這個規則變更。

手機網頁可能更受 CPU、GPU、散熱與電力限制；原生可以省去部分 Web 通道工作，但不會自動消除 Lua 尋敵成本。桌面原生、手機原生與手機 Web 都必須另做相同人口／鏡位／解析度的持續測試，才能判斷是否達標。

## 驗證

- Workspace Rust tests 通過；新增 hash 測試涵蓋任意 byte 修改、成長、縮小、邊界、超過快取上限及完整 SHA 對照。
- 10 個相關 JS tests 通過；遊戲 phase/reset/pause 檢查通過。
- Development 與 production 建置的實際匯出 host payload CLI/WASM parity gate 通過；本遊戲另有上述 600 tick 比較。
- 正式遊戲另成功匯出：dev_tools / preview_tools 都是 false，未壓縮 WASM 1,506,756 bytes，整包檔案合計 2,915,819 bytes。這是產物大小，不是壓縮下載量或啟動時間。
- SDK 腳本通過解析與 Node 語法檢查；舊 Web-first SDK 的完整 debug WASM 打包未重建，詳見工具檢視。

重現：`node scripts/compare-player.mjs --before <round2-export> --after <round3-export> --frames 600 --checkpoint-every 1 --pairs 3 --no-profile-window --output comparison.json`。壓測再加 `--setup-requests`，requests 保存在證據中。
