# Decision 0014: The Host Drives the Shared Runtime with `tick_with_input`

- Date: 2026-09-05
- Status: accepted

## Context

The native preview already has a mouse/keyboard adapter, the headless runner already has an `InputFrame` sequence, and the browser host also needs to convert pointer events into the same semantic data. If each platform decides independently “when to apply input, when to tick, and whether a missing pointer frame is sticky,” the same Luau will produce different results on different hosts.

## Decision

`EngineRuntime::tick_with_input(&InputFrame)` is the single-frame host-to-engine boundary:

- the host first normalizes platform coordinates/keys into an `InputFrame`;
- the engine replaces the action snapshot before the tick;
- when a pointer frame exists, update position and down; when it does not, clear only down and retain position;
- the engine executes one fixed timestep and returns the `WorldSnapshot` after that frame completes.

`run_with_input_sequence` uses the same entry point. Platform adapters, browser events, test fixtures, and Luau game rules do not enter this method.

The JSON InputFrame pointer position uses the shared Vec2 closed wire contract and accepts only x/y; extra vector fields are rejected rather than silently ignored. This does not modify numeric pointer FFI parameters, action semantics, or opaque game/save data, and it is not global validation of Luau tables.

## Consequences

- Native, Web, iOS, Android, and headless replay have one source of truth for input/tick ordering.
- Input normalization and device policy remain in the host; the engine does not know about mouse, touch, keyboard, or device scale.
- A missing pointer frame cannot leave the down state sticky, preventing ghost input at hot-reload or sequence boundaries.
- `tick_with_input` is a required runtime contract, not an additional input abstraction; if hosts need different behavior later, prove it with replayable tests before changing this boundary.
