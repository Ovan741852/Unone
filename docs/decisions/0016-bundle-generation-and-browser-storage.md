# Decision 0016：Bundle generation 與瀏覽器儲存由 host 管理

- 日期：2026-09-05
- 狀態：accepted

## Context

同一個遊戲內容要在 native、Web、iOS 與 Android 使用，但平台的 fetch、重試、權限、storage quota、背景下載與檔案 API 不相同。若把這些政策放進 `unone-engine`，引擎會變成下載器，而且 headless replay 會被平台狀態污染。

## Decision

分成兩層：

- engine 提供 `BundleVerifier`，以 `begin → update(chunk)* → finish` 統一 size/SHA-256 規則；native `BundleManager` 仍負責依賴解析、`.part` staging、cache commit 與 atomic generation rename。
- Web host 的 `bundle-store.js` 負責 fetch、依賴順序、IndexedDB content-addressed cache、cache hit re-verify 與 generation transaction。所有內容驗證完成後，才同時寫入 bundle records、generation record 與 `activeGeneration` pointer；任何 fetch、驗證或 transaction 失敗都不改變上一代 active pointer。

內容 hot update 的順序固定為：

```text
fetch / cache lookup
        ↓
bounded Rust verification
        ↓
host staging + dependency resolution
        ↓
one storage transaction activates generation
        ↓
engine safe-point source/content apply
```

`reload_source` 是腳本 hot reload，保留 Rust-owned world state；generation activation 是內容版本切換，兩者不混成「任意檔案立即替換」。sample 以 v1/v2 script bundle 驗證這個差異：v2 只下載變更 script，active 後才呼叫同一 runtime 的 source reload。

## Consequences

- browser storage 不進 engine core；mobile 可用同一 manifest/hash/generation 語意接自己的 filesystem/key-value adapter。
- cache key 是 content hash，不是 URL 或版本字串；URL 變更但 bytes 相同不會重複下載。
- active pointer 是 rollback 邊界；舊 generation 不立即刪除，待 ref-count/引用追蹤與 quota policy 成熟後再回收。
- smoke host 目前用 `Blob` 收集已驗證 response 再寫 IndexedDB，這是可測試的最小實作，不是大型 asset 的最終 streaming storage。production 需要 OPFS、chunk store 或平台 native streaming writer，避免單一 bundle 同時佔用 response、驗證與 storage 的峰值記憶體。
- 不做 P2P、差分 patch、遠端腳本執行、原生 plugin 熱插拔、CDN 選路或下載排程；這些屬於 host/營運層，只有多個驗證遊戲證明需要才另立決策。
