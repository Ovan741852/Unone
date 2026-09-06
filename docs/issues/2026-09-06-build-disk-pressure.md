# 封裝前 D 槽空間不足與 linker PDB 失敗

日期：2026-09-06。狀態：cleanup_authorized_but_execution_policy_blocked。

## 已確認事實

- 重建 CLI 時 `link.exe` 報 `LNK1318: 未預期的 PDB 錯誤; LIMIT (12)`，
  目標 `target/debug/deps/game.pdb`。
- 當時 PDB logical size 150,167,967 bytes，D 槽可用 112,766,976 bytes。
- 等 workspace tests 結束後，單獨 `cargo build -p unone-cli` 重試成功；
  因此不能把錯誤斷定為 Rust 編譯錯誤，也不能斷定磁碟是唯一根因。
- 再測 D 槽約剩 0.27 GB；C 槽約剩 23.88 GB。
- 唯讀盤點 `D:/Projects/Unone/target/debug/incremental`：10,363 files，
  logical size 約 3.13 GB。實際可釋放量可能不同（NTFS compression）。

## 處理邊界

使用者已明確批准只清理上述可重建的 incremental cache；不再缺少使用者授權。
不動 source、`.git`、Unone_Games、舊 immutable package 或其他專案資料。
主代理重新只讀檢查：resolved target 精確等於指定目錄；祖先與目標皆為真實
directory、無 reparse，子孫 reparse 數為 0，active Cargo/rustc/link 為 0。
仍有 10,363 files／3,361,313,681 logical bytes，D 可用 292,454,400 bytes。

隨後帶相同 guard 的單一 PowerShell Remove-Item -LiteralPath / -Recurse
命令在 CreateProcess 階段被工具拒絕：`rejected: blocked by policy`。
命令未啟動，沒有快取刪除；同一次 orchestration 中排在之後的 Cargo 測試也
沒有執行。再次唯讀確認指定目錄仍存在。不換 shell、改用其他刪除工具或
繞過此限制；需使用者在工具外手動清理該目錄後，再量測空間與接續建置。

獨立 reviewer 暫停大檔 build，繼續只讀審查。此環境問題未解決前不拿舊 binary
冒充重新 build 的封裝，不把 package/盲驗標成通過。
