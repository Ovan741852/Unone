# Issue: validation script must run under Windows PowerShell

日期：2026-09-05  
分類：Tooling/docs

## 問題

第一次執行 `scripts/validate-game-matrix.ps1` 時，Windows PowerShell 回報 `Missing closing ')' in expression`，即使同一份語法在 bundled PowerShell Core 可執行。這會讓驗收工具本身產生雜訊，AI 也無法分辨是矩陣未通過還是腳本壞掉。

## 影響

影響 engine workspace 的正式七遊戲驗收檢查；不影響 Rust engine runtime 或遊戲邏輯。

## 原因判定

分類為 tooling/docs compatibility issue：腳本含有非 ASCII 診斷字串，且早期版本將函式呼叫與 ordered hashtable／subexpression 組合在同一表達式，造成 Windows PowerShell parser 行為不穩定。不是架構問題，不應把 workaround 放進 engine core。

## 修正

- 將診斷與建議動作拆成中間變數，降低 Windows PowerShell parser 複雜度。
- CLI 診斷字串改為 ASCII；使用者文件仍保留中文說明。
- 保留 semantic `code`、`summary`、`explanation`、`facts` 與 fail-closed exit code。

## 回歸證據

以下命令已由 Windows PowerShell 實際執行並輸出完整 JSON：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:/Projects/Unone/scripts/validate-game-matrix.ps1 -MatrixPath D:/Projects/Unone_Games/validation/acceptance-matrix.json
```

目前結果為 `ok=false`、`status=not_passed`、`final_gate_count=7`、`passed_final_gate_count=0`，並列出七個 `VALIDATION_GATE_NOT_PASSED`；exit code `1` 是矩陣尚未完成的預期結果。
