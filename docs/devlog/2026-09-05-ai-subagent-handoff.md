# 2026-09-05: AI game handoff and content bundle slice

## Changes

- Added a canonical docs/engine.d.luau public type snapshot and an immutable package script at scripts/pack-ai-engine.ps1.
- Added docs/ai-agent-game-handoff.md with the isolated input contract, project init/schema, first commands, blocker protocol and per-game delivery gates.
- Added canonical project/scene JSON schemas and bundled the pinned Luau analyzer beside the CLI so `check --types` works from package output alone.
- Added seven final-game plans under D:/Projects/Unone_Games/validation/subagent-plans/; Angry Birds remains the separate engine capability smoke owned by the main task.
- Added asset init, asset inspect --strict, structured asset readiness/blockers/scope, supported manifest vocabulary and source path containment checks.
- bundle pack now creates deterministic uncompressed content archives for asset manifests and refuses unresolved static scene references.
- Generic Web runner resolves real packaged SVG assets. Concurrent asset resolution exposed and fixed the shared Wasm verifier race.
- Generic Web source mode now uses the same `scripts/main.luau` default as the Rust project loader when `entry_script` is omitted.

## Evidence

- cargo test --workspace: 37 engine/runtime tests plus platform package tests passed.
- cargo clippy --workspace --all-targets -- -D warnings: passed.
- MCP smoke: 14 tools, including project init, semantic run/conflict/asset responses passed.
- Angry Birds packaged Web runner: bundle generation 2, content bundle active, 3 assets resolved, running frame observed.
- Final seven-game matrix remains not passed by design; all seven final games are now delegated only after their isolated handoff inputs are prepared.
