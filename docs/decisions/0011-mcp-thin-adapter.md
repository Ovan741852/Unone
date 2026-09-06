# Decision 0011: MCP Is a Thin CLI/Developer Protocol Adapter, Not Part of the Engine

- Date: 2026-09-05
- Status: accepted

## Context

AI can use `game --json` directly, but some AI hosts use MCP tool discovery and tool calls as their standard entry point. If MCP reimplemented project loading, run, test, or diagnostics, the CLI and MCP would quickly acquire different semantics.

## Decision

Add a `game mcp` stdio server whose first version provides only MCP lifecycle and tool primitives:

- `initialize`/`notifications/initialized`/`ping`
- deterministic tool definitions for `tools/list`
- `tools/call` mappings for the existing project inspect, API metadata, check, run, test, observe, platform, and bundle operations
- wrap engine results unchanged in MCP text content; map `EngineResult.ok == false` to `CallToolResult.isError == true`

Keep the MCP adapter in `unone-cli`; do not make `unone-engine` depend on an MCP SDK, JSON-RPC transport, or AI host. stdio stdout emits only MCP JSON; diagnostics, facts, likely_causes, suggested_actions, world, and observation digests are not reduced to free-text-only messages.

## Consequences

An AI host can discover and call existing capabilities, with the CLI and MCP sharing result semantics. The first version does not provide MCP resources, prompts, tasks, Streamable HTTP, long-lived game sessions, or automatic source modification; use `game preview --watch` for continuous preview. The adapter maintains the tool schema explicitly first; build a generator only after public metadata is stable and repeated maintenance cost actually appears.

## References

- [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)
- [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP tools schema](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
