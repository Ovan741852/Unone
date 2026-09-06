# Decision 0015: The Live Web Runtime Crosses the Emscripten Boundary Through a Narrow C ABI

- Date: 2026-09-05
- Status: accepted

## Context

The snapshot bridge has validated the WebGPU renderer and pointer normalization, but it does not actually send browser input into Rust/Luau simulation. `EngineRuntime` cannot expose Rust types, Lua handles, or `Rc<RefCell<_>>` directly to JavaScript; putting DOM, WebGPU, or fetch dependencies into `unone-engine` would also pollute the engine core.

## Decision

Create a separate `unone-web-live-smoke` Emscripten binary that connects the browser host through a minimal, observable C ABI:

- `unone_web_init() -> i32`
- `unone_web_alloc(length) -> *mut u8`
- `unone_web_bundle_begin(ptr, len) -> i32` (bundle integrity spec)
- `unone_web_bundle_write(ptr, len) -> i32` (bounded bundle chunk)
- `unone_web_bundle_finish() -> i32` (size/SHA-256 result)
- `unone_web_load_project(ptr, len, seed) -> i32` (raw payload boundary; the host must guarantee valid pointer/length)
- `unone_web_reload_script(ptr, len) -> i32` (raw payload boundary; the host must guarantee valid pointer/length)
- `unone_web_set_pointer(x, y, down)`
- `unone_web_tick() -> i32`
- `unone_web_observation_ptr() -> *const u8`
- `unone_web_observation_len() -> usize`

The ABI passes only primitives and UTF-8 JSON: project load accepts a host payload, and observation returns a `{ project, world }` envelope. Runtime ownership, Luau calls, the fixed timestep, and world state stay in the Rust engine runtime; WebGPU, animation frames, and DOM pointer events stay in the browser host. `tick_with_input` is the ABI's only internal input/tick boundary.

The first binary now receives a JSON project payload from the browser (project name, Luau source, and Scene); the page also provides a source-reload fixture. A bounded bundle-chunk verifier was added so the host does not need to reimplement SHA-256 rules; `web/live/bundle-store.js` stores content-addressed bytes in IndexedDB and, after validating all dependencies, writes the generation and active pointer in one transaction. This proves the sample's bundle fetch/cache/generation contract, but does not claim a complete CDN, background download, delta update, or production asset-streaming system.

## Consequences

- Browser input can now drive the same Rust/Luau runtime instead of JavaScript faking the simulation.
- A snapshot pointer is valid until the next tick; the host must immediately copy the JSON bytes and must not retain an engine memory pointer.
- A project/script payload pointer is valid only during its corresponding call; Rust marks this FFI precondition explicitly with `unsafe extern "C"`, while the host owns buffer validity and length.
- Rust `u64` values in the ABI, such as the seed, must be passed from JavaScript as `BigInt`, for example `42n`; the host must not use a potentially lossy Number.
- ABI errors are reported as a return code plus a JSON error payload. Failures attributable to the engine/runtime use a complete `Diagnostic` (`code`, `explanation`, `severity`, `scope`, `hints`); ordinary host failures use a plain `error`. This gives AI/hosts actionable semantics without exposing Rust panics or internal types.
- The bundle verifier can repeat `begin → write* → finish`; the host must not put content into the active generation until `finish` succeeds, and a verification failure may retain only the previous generation.
- Adding a smoke binary is a validation tool, not a reason to turn Web platform functionality into engine core; a general-purpose host loader is still required before use by a real game.
