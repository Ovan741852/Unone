# 封裝前 D 槽空間不足與 linker PDB 失敗

日期：2026-09-06。狀態：awaiting_user_storage_decision。

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

已詢問使用者是否只清理上述可重建的 incremental cache；尚未自行刪除。
不動 source、`.git`、Unone_Games、舊 immutable package 或其他專案資料。
待取得回覆後，先確認 exact resolved target、沒有 active Cargo/rustc/link build，
再用單一 PowerShell 原生檔案操作；清完量測可用空間並重新建置。

獨立 reviewer 暫停大檔 build，繼續只讀審查。此環境問題未解決前不拿舊 binary
冒充重新 build 的封裝，不把 package/盲驗標成通過。
