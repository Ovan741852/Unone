# 萬軍戰場第四輪：區域共享尋敵與視錐裁切

這輪在 Lua 遊戲層改了尋敵策略，並在 Web Three renderer 加入預設的 instance 空間裁切。目標是減少重複決策與畫面外的繪製工作；不是把戰鬥寫入 Rust，也沒有刪除畫面外單位的模擬。

## 遊戲行為的改變

原本已有 7 單位寬的搜尋網格，以及每 6 次戰鬥更新輪流重新尋敵。但相鄰單位仍各自掃描鄰格，遠距離各自做 12 個候選取樣。

現在同隊、同一 7×7 區域、相同空中攻擊資格的單位共享一次區域目標選擇。以區域中心挑目標，鄰格搜尋最多檢查 32 個候選；沒有局部目標時，同區域共享最多 12 個遠距離取樣。快取每次 grid rebuild 重設，單位保留有效目標並沿用原有的分散重新尋敵節奏。

這是區域共享決策的第一版，**不是完整影響力場、流場導航或鳥群系統**。仍要個別檢查攻擊距離、移動與命中；兵種攻擊方式、投射物、雙方同時結算傷害仍存在。新的目標選擇會改變交戰過程，因此不宣稱與第三輪舊 replay 的 digest 相同。

在此基礎上，三個引擎 tick 的單位工作分配改為 **40/60/0**；第三個 tick 專門結算投射物、傷害與發布。前兩個 tick 的內部狀態不發布，仍是 20 Hz 戰鬥、60 Hz 引擎。這個排程調整與本輪區域尋敵版本逐 tick digest 相同。

## CPU 測量

實際匯出 development release WASM、seed 42、空 input、暖機 30 tick、停用取樣及主動 profile window，持續一萬人存活。

| 試驗 | mean 中位數 | p95 中位數 |
|---|---:|---:|
| 第三輪邏輯，600 tick × 3 次 | 12.667 ms | 15.933 ms |
| 區域共享尋敵，600 tick × 3 次 | 10.169 ms | 14.263 ms |

這兩組分開連續執行，mean 約降低 **19.7%**，不屬於交錯 A/B，也因規則改變而不是完全相同工作負載；不把這個比例當跨裝置保證。原始 [baseline](evidence/2026-09-08-legion-round4/baseline.json)／[regions](evidence/2026-09-08-legion-round4/regions.json) 記錄環境、hashes、條件、各次結果與戰鬥觀察。

另對區域尋敵版本做 37/53/10 → 40/60/0 的三組交錯比較，每組 600 tick：mean 9.531 → 9.352 ms，p95 13.843 → 12.944 ms（約降低 6.5%）。mean 每組方向不一致，不能宣稱排程有顯著平均收益；保留原因是長幀改善且逐 tick digest 全數一致。見 [排程比較](evidence/2026-09-08-legion-round4/schedule.json)。

## 引擎裁切

一般 3D Mesh 原本沿用 Three 預設視錐裁切。本輪補的是曾明確停用裁切的 InstancedMesh 路徑：依世界空間 64×64×64 格子分批，計算包含模型旋轉與縮放的保守邊界，預設啟用視錐裁切。移動到另一格、數量／revision 更新、批次移除與容量成長都會更新對應資源。邊界計算併在矩陣打包迴圈，避免第二次逐 instance 矩陣讀取。

這是整格裁切，不是逐個小兵裁切，也不是牆後遮擋剔除。仍會更新場外矩陣；主要省的是送入繪製的實例與 GPU 工作。固定格子大小是第一版折衷，密集全景會增加 draw calls，不能保證所有場景都加速。Native renderer 尚未加入這個實作。

AI 的 renderer metrics 新增 `instance_cells`、`submitted_instance_cells`、`submitted_instances`、`culled_instances`。提交量記錄本次 draw 中實際進入 Three 繪製 callback 的 instance，跨 pass 去重，不代表最後覆蓋螢幕的像素數。

同一暫停世界、10,000 人加 150 投射物，只換廣角／近景：

| 指標 | 廣角 | 近景 |
|---|---:|---:|
| 提交 instances | 10,150 | 7,779 |
| 被裁切 instances | 0 | 2,371 |
| 提交空間格 | 67 | 34 |
| draw calls（含地形） | 68 | 35 |
| triangles | 3,390,056 | 2,645,024 |

[裁切記錄](evidence/2026-09-08-legion-round4/culling.json)。兩鏡位遊戲 observations 相同；暫停比較只證明裁切有效，不能拿來證明遊戲 FPS。

## 驗證與限制

- 正常戰鬥跑 1,200 tick 兩次，每 tick digest 相同；雙方都有擊殺、投射物存在、總兵力守恆。20.5 秒時紅方剩 4,125、藍方剩 3,590。見 [正常重播](evidence/2026-09-08-legion-round4/normal.json)。
- 600 tick 壓測三次 checkpoint 一致，全程一萬人，沒有觸發攻擊上限。
- 新排程三組 600 tick 每 tick digest 與本輪原排程相同；reset／暫停前兩階段測試通過。
- 12 個相關 JS tests 通過，包括真正 Three 模型的跨格移動、保守 bounds、視錐、移除與 memory revision 更新。
- 實際匯出 host payload 的 CLI/WASM gate 通過（該 gate 本次遊戲 fixture 只比較 1 frame，不代替以上長重播）。
- 邏輯／顯示分離，但 Web 仍共用主執行緒；沒有宣稱手機 Web 或 native 的效能。20 Hz 戰鬥狀態也不等於 60 Hz 姿態插值。

## 瀏覽器最後複測

最終版（含裁切計數）1280×720 廣角，從戰鬥第 2 秒開始、持續一萬人不死亡，跑 **86.4 秒**：

| 指標 | 實測 |
|---|---:|
| 完成引擎 tick | 5,184（60.0 tick/s） |
| 丟棄 tick 增量 | 0 |
| CPU 繪製完成 | 9,495（109.9 次/s） |
| WASM tick + 發布 mean / p95 | 9.96 / 15.60 ms |
| Renderer CPU mean / p95 | 1.03 / 3.40 ms |
| 繪製間隔 p95 | **24.3 ms** |

[瀏覽器記錄](evidence/2026-09-08-legion-round4/browser.json)。總數覆蓋全視窗，CPU 與 cadence 分佈只保留最新 2,048 筆；平均繪製次數含同一模擬狀態的重繪，不能當作姿態更新頻率。測量期間沒有同時執行 CPU benchmark 或編譯，但有短暫文件／檢查命令，不是隔離實驗室。

**模擬能維持 60 tick/s、平均繪製完成次數超過 60；仍未證明穩定 60 FPS。** 長幀集中成本尚未完全解決。接下來應量測完整 RAF 的排程／更新／繪製關係，再考慮把發布準備分散或將模擬放 Worker；不能因為平均數漂亮就把 24.3 ms 的 p95 隱藏。
