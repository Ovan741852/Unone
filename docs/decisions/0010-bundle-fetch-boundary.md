# Decision 0010：Bundle 來源由 host 提供，驗證與啟用留在引擎

- 日期：2026-09-05
- 狀態：accepted

## Context

Bundle 需要同時支援 native、Web、iOS 與 Android。若讓引擎直接依賴 HTTP、CDN、browser cache 或 mobile storage，會把平台政策與營運服務混進 engine core，也會讓 headless test 難以重播。

## Decision

`BundleManager::install_with_fetcher` 接受 host 實作的 `BundleFetcher`。host 決定如何取得 `Read` source；引擎只負責：

- 依賴解析與循環診斷
- 64 KiB streaming size/SHA-256 驗證
- `.part` staging、flush/sync 與 cache commit
- generation activation 與失敗時保留上一個 active generation
- 透過 `inspect` 回報 source、cache 與 available 狀態

native CLI 的 local file fetcher 是一個 adapter；Web/mobile 可在引擎外完成 fetch、解密或持久化，再提供 reader。第一版不在引擎內建 HTTP client、CDN、P2P、差分更新或下載排程。

## Consequences

同一套完整性與回滾規則可跨 host 重用，也能測試「遠端 source 不存在但 cache 可用」與「新內容損壞不切換」；host 仍需自行處理網路重試、權限、背景下載與 storage quota。未來若需要非檔案 cache，應替換 host/storage adapter，不改遊戲端 Luau API。
