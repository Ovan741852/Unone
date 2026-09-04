# ADR 0001：Rust 引擎機制、Luau 遊戲策略

日期：2026-09-05  
狀態：accepted（可在驗證失敗時重開）

## 決策

Rust 只負責引擎機制與跨平台 runtime；遊戲規則、內容流程、UI 行為與遊戲測試由 Luau 負責。CLI、MCP 與 Editor 共用 Developer Protocol。

## 原因

- 避免每款遊戲都修改 Rust core。
- AI 可以在文字檔中快速修改、檢查與 hot reload。
- 同一個 protocol 可同時服務 AI、人類、CI 與未來 Editor。
- 引擎與業務邊界可以用憤怒鳥 2D 實際驗證，而不是靠想像定義。

## 暫不做的事

- 不承諾舊 API 相容。
- 不先支援多腳本語言。
- 不先把 MCP 寫進 engine core。
- 不先做任意 closure/coroutine/VM heap 的 hot reload migration。

## 重新檢視條件

若兩個以上驗證遊戲都需要同一能力，而目前邊界造成重複或無法測試，新增 ADR 重新評估；單一遊戲的需求不直接提升為引擎抽象。
