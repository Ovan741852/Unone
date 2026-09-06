# ADR 0001: Rust Engine Mechanisms, Luau Game Strategy

Date: 2026-09-05  
Status: accepted (may be reopened if validation fails)

## Decision

Rust is responsible only for engine mechanisms and the cross-platform runtime; Luau is responsible for game rules, content flow, UI behavior, and game tests. The CLI, MCP, and Editor share the Developer Protocol.

## Rationale

- Avoid modifying the Rust core for every game.
- Let AI quickly edit, inspect, and hot-reload text files.
- Let the same protocol serve AI, humans, CI, and a future Editor.
- Validate the engine/business boundary with an actual Angry Birds 2D game instead of defining it by imagination.

## Not Doing Yet

- Do not promise compatibility with the old API.
- Do not support multiple scripting languages first.
- Do not put MCP into the engine core first.
- Do not first build hot-reload migration for arbitrary closures, coroutines, or VM heaps.

## Reconsideration Conditions

If two or more validation games need the same capability and the current boundary causes duplication or makes it untestable, add an ADR to reassess it; do not promote a single game's requirement directly into an engine abstraction.
