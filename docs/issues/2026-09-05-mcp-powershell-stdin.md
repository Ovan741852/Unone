# Issue：Windows PowerShell 5.1 MCP smoke stdin 邊界

日期：2026-09-05

## 症狀

`scripts/mcp-smoke.ps1` 在目前 PowerShell 7 可正常把 JSON-RPC 訊息 pipe 給 `game mcp`，但使用 Windows PowerShell 5.1 時，第一筆 initialize 會被 MCP server 收到成無法解析的內容；後續 request 因未初始化而全部回 `-32002`。

## 分類

這是 developer tooling 的 host/transport portability 問題，不是 Rust engine simulation 或 MCP tool dispatch 的架構問題。

## 修正

- smoke script 不再依賴 PowerShell 版本對 native stdin pipeline 的隱含轉碼。
- 改用 `System.Diagnostics.Process`，以無 BOM UTF-8 bytes 寫入 stdin，並明確讀取 stdout/stderr。
- smoke 同時以 `@(...)`／`ConvertFrom-Json -InputObject` 處理 Windows PowerShell 5.1 的單元素 JSON 物件，避免把 object 當陣列索引。
- MCP server 解析行時容忍 UTF-8 BOM，避免其他合法 host 的 stream prefix 造成無意義 parse failure。

## 證據

`powershell -NoProfile -ExecutionPolicy Bypass -File D:/Projects/Unone/scripts/mcp-smoke.ps1` 已通過，並驗證 initialize、12 個 tools、deterministic run、argument conflict 與 `unone_asset_inspect`。
