# Issue：Windows active generation 的 file sync 行為與 Unix 不同

- 日期：2026-09-05
- 範圍：`BundleManager::write_generation`
- 分類：Platform architecture / storage boundary
- 狀態：已修正並回歸

## 問題

把 generation metadata 先寫到 `.part` 後，在 Windows 測試環境對該檔案呼叫 `File::sync_all()` 回傳 `os error 5`（Access denied），導致已通過驗證的 bundle 無法 activation。原本直接寫入 JSON 的版本沒有暴露這個問題。

## 判斷

這不是 bundle hash 或依賴邏輯錯誤，而是 storage durability primitive 的平台差異。不能因為 Unix 的 fsync 路徑成立，就假設 Windows 對同一個暫存檔提供相同語意。

## 修正

保留 atomic activation：先寫 `.json.part`、flush、關閉 handle，再 rename 成 `.json`；非 Windows target 才額外呼叫 `sync_all()`。讀取端只接受 `.json` generation，損壞或未完成的暫存檔不會成為 active generation。

## 回歸

`cargo test --workspace` 的 17 個 engine tests 通過，包含 local install、host fetch、cache fallback、tampered bundle 與 failed update 保留上一代；Windows 執行環境也通過。
