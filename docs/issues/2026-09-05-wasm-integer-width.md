# Issue: native and wasm Luau integer widths differed at the JSON boundary

## Symptom

The native workspace compiled, but the Emscripten Web live build failed when `json_to_lua` constructed `Value::Integer(i64)`: the wasm Luau binding uses a narrower integer type. A save payload or observation implementation that relied on host width would not have one cross-platform contract.

## Classification

Platform ABI / serialization architecture issue. It is not a Web renderer issue and must not be solved by a Web-only cast.

## Fix

Define the shared JSON-like integer contract as signed 32-bit on every target. Both Luau-to-JSON observation conversion and JSON-to-Luau save conversion reject values outside that range with a runtime diagnostic. Array keys use the same bound. Larger values must be represented by a game-owned string or an explicitly designed future numeric contract.

## Regression

`cargo test --workspace` and `scripts/build-web-live.ps1` both pass after the fix. The Web build now compiles the same runtime boundary instead of accepting a platform-dependent integer shape.
