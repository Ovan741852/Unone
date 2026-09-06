# Claude workflow 架構盲評與主代理覆核

日期：2026-09-06。狀態：文件盲評完成；不等於架構／實作全面通過。

## 方法與原始證據

獨立 Claude CLI print session，safe-mode、無 session persistence、tools 空集合、
strict MCP。僅提供四份當時 current/candidate 契約，未提供計畫、歷次審查或主代理結論。
輸入完整快照：`../evidence/2026-09-06-ai-authoring/claude-workflow-input.txt`。
stdout：`../evidence/2026-09-06-ai-authoring/claude-workflow-raw.txt`，exit 0。
Claude 回覆內印出 Write 呼叫並宣稱寫 plan；工具已停用，且該路徑 Test-Path=False。
因此只保存 stdout 作為評審文字，不把宣稱的寫檔當工具執行證據。

範圍：project init、scene ingestion、CLI/MCP discovery、資產三層權威、分包與
generation、verify/replay、script reload、mobile host。文件內候選 authoring 契約
並未被當作已完成實作；後續修正文案不回寫原始輸入快照。

## 六項意見的取捨

| 項目 | 覆核與處置 |
|---|---|
| Spine/Effekseer 不可啟用 vs host_required | 接受：systems.rs registry 實為 HostRequired 且可啟用；web/presentation 有專用 host。原地刪除錯誤說法，不宣稱 generic/native/mobile renderer 完成。 |
| 單包 install 非累加 | 是已明示的選擇契約，不是已證明架構錯誤。現有報告已有完整 active_bundles，subset 測試確認移除其他 root。removed-roots delta 可列後續可用性候選，這輪不改成自動 union，也不重造安裝 API。 |
| init 失敗後卡死 | 部分接受：補 AI 也是作者、修失敗原因、允許時另選新 root 或詢問使用者。拒絕把 created-files 紀錄當安全刪除清單；後續變更與所有權需另核對。不新增 rollback/repair。 |
| generation 同名 | 接受 scope 澄清；script/runtime 與 bundle/host 計數獨立。不同 scope 同名不等於共用計數器，無證據支持為此全面改 API。 |
| read 成功但不 fresh | 補既有資產替換路徑的 describe→read。拒絕其「pack 已更新但 read 仍成功讀舊 bytes」推演：read_active_bundle 比較 manifest/active hash，改變時拒絕。只有 source bytes 改而未 pack 等情形才可能合法讀舊 active。維持 verified read 不掃 authoring。 |
| MCP 工具數硬編 | 移除 current 教學兩處重複計數，指向 tools/list discovery。不是缺測試：mcp.rs 現有測試確實斷言23；文件不應讓作者以數量推能力。 |

上述 current docs 修正位於 ai-workflow.md / asset-workflow.md；既有過期句子已原地替換。
歷史原始評審與 immutable package 不改造，避免偽造當時內容。

## 不接受「沒有架構阻塞」作全面保證

Claude 僅完成文件審查，未實測 failure paths，也沒有證明 reload transaction。
主代理讀取現行程式另確認以下控制流程，列待驗證風險而非假稱已實測：

1. `web/runner/main.js::reloadActiveBundle` 先 installGeneration（storage active
   commit），後呼叫 Rust reload；reload 失敗直接 throw，generationState 的賦值在
   成功後。因此 storage active、目前 session script 與 host 記憶體 generation 可能
   不同。Decision0016 刻意區分 activation/apply，但缺少完整失敗後可觀測／恢復驗證。
2. 同一 reload 路徑只讀 nextConfig、script、asset manifest；沒有套用新的 scene，
   也沒有重建 runtime 的 systems/config。不能由「安裝完成」推論整包內容已套用。
3. `runtime.rs::load_script` 在更新 update_fn 前直接呼叫新 onReload(api)。callback
   可以改 engine state 後拋錯；保留舊 update_fn 不足以證明所有狀態都 rollback。

建議下一批先針對「更新失敗／scene或systems變更／onReload寫狀態後失敗」做小型
重現測試，再決定 script-only 拒絕不支援變更、runtime applied 身分回報，或完整
候選狀態提交設計。這會影響熱更新語意，需向使用者確認優先序，不在 authoring
修正中暗自實作整套新架構。不得將本輪標成熱更新驗收通過。

## 本批 authoring 驗證狀態（另案）

中途 workspace test exit0，161 個 harness tests，包含可能內部跳過的 Windows
權限依賴案例；不是 Windows junction 實測、fresh package game 盲評或平台 gate。
其後 clippy 發現 init preflight 大型 Err，owner 已改 Box；再跑發現兩個測試 helper
應使用 io::Error::other，已退回 owner。B consumer matrix 正在編寫、尚有未使用的
fixture/import，須完成後再做最終 clippy/test。
因此本報告不代表 authoring 製作已交付。
