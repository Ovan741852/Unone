# AI 效能工具檢視 — 2026-09-08

目前足以支援 AI「固定情境 → 定位 → 試改 → 比較 → 保留或撤回」的流程，但還不是完整的 profiler 套件，也不應自己宣告哪個系統必須改寫。第三輪就是例子：新增分項量測後發現 hash 比 JSON 編碼貴；尋敵快取短測看似有利，長測卻沒有收益，因此撤回。

## 本次補齊與修正

| 問題 | 現在的行為 |
|---|---|
| WASM tick 和發布混在一起 | `publication` 分開列出 canonical 編碼、hash、presentation 轉換、envelope 輸出；可透過同一個 AI API／人類 Profile 分頁讀取 |
| 看不到 hash 重複工作 | 回報 input／reused／hashed bytes、命中次數、最後量測到的快取配置量與上限 |
| 最慢幀不能直接拿去重播 | `slowest_frame.frame` 改成真正完成的世界 frame，之前是視窗內從 0 開始的樣本序號 |
| 掉 tick 數包含暖機／啟動歷史 | 新增 `host_window.dropped_steps_delta`，以當前 scheduler 計數取視窗差值；不可用或計數重設時回傳 null |
| 只看三次結果的中位數 | 比較報告增加 mean 的 min/max 與每組改善幅度，不把小幅或正負混合結果宣稱為顯著收益 |
| 無法比較分項量測本身的成本 | `--no-profile-window` 停用主動視窗／發布分項；同產物可用 before/after profile-window 開關比較 |
| 脫離 repo 的 AI SDK 漏了命令工具 | 打包清單與 verifier 加入 `profile-player.mjs`、`compare-player.mjs` 與語法檢查 |

舊證據檔不會重寫：第三輪之前的 `slowest_frame.frame` 應按舊的視窗序號解讀。新版世界 frame 不改變 `frames` 的樣本計數意義。SDK 規則通過 PowerShell 解析與 Node 語法檢查；本次沒有重新產生整個舊 Web-first SDK，因為該流程需要的 debug WASM 產物不在工作目錄。新版遊戲 development／production export 是分開驗證的。

## 仍須正確解讀的限制

- **Lua 函式是 safe-point 取樣。** self/inclusive samples 不是毫秒或呼叫次數；短函式、內聯、native 呼叫、GC 有偏差。本次單次取樣約 15.52 ms/tick，未取樣約 14.05 ms/tick，不能拿取樣結果當最佳效能。
- **主動視窗也有成本。** 同一產物三組開關比較的中位數約增加 0.8%，但各組差異有正有負，且整體波動很大；這不足以保證固定的開銷比例。基準比較停用主動視窗，分項定位另開視窗。引擎原有的被動 runtime timers 仍存在。
- **Node 吞吐量不是畫面 FPS。** Node 測試不含 renderer、GPU、音效 host 工作、RAF 排程或錄影；最後仍要跑真正的瀏覽器。CPU 繪製完成次數也不等同 GPU 已呈現到螢幕。
- **GPU 不與 CPU 同步。** GPU query 是另一個滾動視窗，不能把其 p95 加到 CPU p95。不同 host/backend 的可用量測仍有差異；native host-window/publication 目前是 null。
- **記憶體資訊有限。** Luau 使用量、WASM 容量與快取配置量可以查，但沒有完整的配置來源、保留路徑、GC 暫停或 GPU 資源 byte 歸因。WASM capacity 不是 live allocations。
- **三組不是統計保證。** 報告記錄 seed、設定、產物 hashes、Node/CPU/平台、開始時間與可用記憶體；電源模式、熱降頻、其他程序和瀏覽器背景狀態仍需控制。區間與 p95 都必須隨條件一起看。

## 建議的 AI 工作流程

1. 確認 release artifact、固定 seed/input、暖機、解析度、人口與鏡位。將遊戲測試控制透過 setup requests 記錄在報告中。
2. 用短暫取樣找候選，用 publication 分項區分模擬、編碼、hash 與轉換；不把單一 frame 的 renderer 數字當整段平均。
3. 一次改一個候選，優先保留遊戲規則。規則有意變動時，要另行標示，不能繞過 digest 不同就當作純效能改善。
4. 停用取樣／主動視窗做交錯 AB/BA 比較；逐 tick 檢查 digest，查看每組差異而非只看最好一次。
5. 驗證 reset、暫停、錯誤、記憶體成長與正式版工具隔離。再做瀏覽器持續人口測試，報告平均、p95、掉 tick 增量與限制。

這些工具提供證據，AI 負責選擇實驗與解釋結果；不需要在引擎內寫一套自動「瓶頸判官」。
