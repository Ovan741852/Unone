# Decision 0011：MCP 是 CLI/Developer Protocol 的薄轉接，不進引擎

- 日期：2026-09-05
- 狀態：accepted

## Context

AI 可以直接使用 `game --json`，但部分 AI host 以 MCP tools discovery 與 tool call 作為標準入口。若 MCP 自己重做 project loading、run、test 或 diagnostics，CLI 與 MCP 很快會產生不同語意。

## Decision

新增 `game mcp` stdio server，第一版只做 MCP lifecycle 與 tools primitive：

- `initialize`／`notifications/initialized`／`ping`
- `tools/list` 的 deterministic tool definitions
- `tools/call` 對應既有 project inspect、API metadata、check、run、test、observe、platform 與 bundle operations
- engine result 原封不動包在 MCP text content；`EngineResult.ok == false` 對應 `CallToolResult.isError == true`

MCP adapter 放在 `unone-cli`，不讓 `unone-engine` 依賴 MCP SDK、JSON-RPC transport 或 AI host。stdio stdout 只輸出 MCP JSON；診斷、facts、likely_causes、suggested_actions、world 與 observation digest 不被轉成只有自由文字的訊息。

## Consequences

AI host 可以 discovery 並呼叫既有能力，CLI 與 MCP 的結果語意相同。第一版不做 MCP resources、prompts、tasks、Streamable HTTP、長生命週期遊戲 session 或自動修改 source；需要持續 preview 時仍使用 `game preview --watch`。工具 schema 先由 adapter 明確維護，待 public metadata 穩定且真的出現重複維護成本時，再建立生成器。

## References

- [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)
- [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP tools schema](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
