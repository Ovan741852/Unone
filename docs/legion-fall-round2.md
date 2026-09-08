# 第二輪：把 Lua 戰鬥長幀分攤開

**有明顯改善，但還沒有達到穩定 60 FPS。** 相同解析度、持續一萬人存活的瀏覽器測試，平均 CPU 繪製完成次數從 **31.6 → 53.2 次/秒**；幀間隔 p95 從 **58.8 → 34.6 ms**。這是單組先後測試，不能視為所有電腦或所有戰況的保證，也不是 GPU 實際顯示完成的量測。

## 保留的改動

全部戰鬥改動都在遊戲 Luau，沒有把遊戲規則搬進 Rust，也沒有新增物理或 ECS 系統。

- 原本每三個引擎 tick 一口氣更新全軍，現在分成固定的 34%／48%／18% 單位處理區段。第一段建空間格，第三段結算投射物、傷害、死亡與發布畫面。
- 單位處理順序、尋敵規則、傷害結算順序及 20 Hz 戰鬥頻率保持一致；前兩段只改遊戲內部資料，完整世界仍在第三個 tick 發布。固定分段不讀取實際耗時，不會讓機器速度影響戰鬥結果。
- 尋敵函式快取當次查詢的位置、敵方格子與對空限制，減少重複欄位讀取。
- 重開會丟棄未完成工作；遊戲暫停會凍結並恢復目前階段。攝影機使用上次完成發布的戰鬥時間。

工具先補上 `render_cadence`，顯示繪製完成間隔與超過 16.667 ms 的次數。Node 比較工具新增逐 tick checkpoint、共用 setup requests，以及 p95 比較，讓 AI 可以驗證「平順了」是否只是「平均看起來比較快」。工具不會替 AI 決定該改哪個系統。

## 固定 replay：總工作量幾乎相同，尖峰明顯降低

Windows / Ryzen 9 9900X，release development WASM；30 tick 暖機、600 tick 量測，三組交錯 AB/BA 的獨立 Node 程序。每一 tick 都比對完整 observation digest。兩邊使用相同 WASM，差異是遊戲 Lua。無 renderer、GPU 或錄影。

| 情境 | 第一輪 mean → 第二輪 mean | 第一輪 p95 → 第二輪 p95 |
|---|---:|---:|
| 正常戰鬥、有傷亡 | 15.69 → 15.64 ms | 44.04 → 19.14 ms（−56.6%） |
| 全程一萬人、不計傷亡 | 15.76 → 15.68 ms | 44.05 → 19.24 ms（−56.3%） |

數字為各次量測 mean／p95 的中位數。不到 1% 的平均成本差異不應當作可靠加速；第二輪的主要收益是削掉長幀。這不是在第一輪 27.3% CPU 降幅上，再加一次 56%。

[正常戰鬥原始樣本與 hashes](evidence/2026-09-08-legion-round2/round2-final-comparison.json) · [一萬人壓測](evidence/2026-09-08-legion-round2/round2-stress-comparison.json)

## 實際瀏覽器

兩邊都是 1280×720、全景鏡位、seed 42、一萬人不計傷亡；30 tick 暖機，停用 sampler、不錄影，使用相同新版 cadence 工具。分別量測約 25.06 和 27.41 秒，並非相同長度的固定 frame replay；這組結果用於實際互動觀察，不能替代上面的受控比較。

| 指標 | 第一輪 | 第二輪 |
|---|---:|---:|
| CPU 繪製完成／秒 | 31.6 | 53.2 |
| 模擬 tick／秒 | 59.1 | 59.9 |
| 繪製間隔 p95 | 58.8 ms | 34.6 ms |
| WASM tick + 發布平均 | 15.37 ms | 14.91 ms |
| Lua 更新平均 | 12.14 ms | 11.63 ms |
| Renderer CPU 平均 | 1.36 ms | 1.02 ms |
| GPU 滾動中位數 | 0.68 ms | 0.66 ms |

[瀏覽器量測記錄](evidence/2026-09-08-legion-round2/browser-comparison.json)。GPU 是獨立滾動視窗；不要把它與 CPU 相加成一個同步 frame time。此前探索性短測曾出現約 68 次繪製／秒，但不能作為穩定 60 FPS 的證據。錄影會額外增加負擔，README GIF 的 FPS 不用來計算這張表。

## 瓶頸與 ECS

目前仍是 CPU：Lua 約 11.6 ms，再加上快照／WASM 發布約 3.3 ms，幾乎吃滿每 tick 的預算。Renderer 約 1 ms、GPU 中位數不到 1 ms，這次沒有證據支持優先改 GPU。下一步應分別量測尋敵／單位更新，以及仍保留 Base64 的 canonical snapshot 編碼和 hash；它們的最佳解可能不同。

ECS 是組織資料與系統的方法，不等於把 Lua 換掉。現在小兵本來就是 Lua 資料集合加 GPU instancing，不是每人一個剛體。本輪另測了類似 ECS 常見的分欄陣列：位置、血量、兵種獨立存放供尋敵使用，但三組比較沒有穩定收益，同步副本還增加成本，因此撤回。Luau 編譯等級 2、旋轉快取的候選也沒有足夠收益，沒有留下。

如果後續量測證明需要跨遊戲使用的批次運算能力，再新增可選的引擎 API。遊戲自己的尋敵／傷害規則仍留在遊戲，不以這次效能需求為理由寫入 Rust。

## 驗證與邊界

- 正常與不減員 replay，各三組、600 tick，全數逐 tick digest 相同。
- 真實匯出 host payload 的 CLI/WASM 遊戲測試通過。
- 遊戲專用測試確認前兩階段不公布半成品、重開會丟棄未完成工作、暫停恢復同一階段。
- 九個 JS 測試通過，涵蓋 cadence 的界限、重設、凍結與既有 developer／memory transport；既有兩個核心 profiler 測試通過。
- 沒有新增 Rust 引擎行為，沒有宣稱 Android/native 圖形效能或穩定 60 FPS。

重現方式：`node scripts/compare-player.mjs --before <round-one-export> --after <round-two-export> --frames 600 --checkpoint-every 1 --pairs 3 --output comparison.json`。不減員測試透過 `--setup-requests` 載入已發現 revision 的 `battle.stress` core invoke；確切 requests 會保留在報告內。
