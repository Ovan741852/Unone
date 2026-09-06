# Decision 0013: Connect the Browser Host to an Engine Snapshot Before a Live Frame Loop

- Date: 2026-09-05
- Status: accepted (snapshot layer; see 0015/0016 for live follow-up)

## Context

`unone-engine` can already compile as an Emscripten library, and a one-shot Web runtime smoke test can already run in a browser; however, there is not yet a stable ABI connecting the Rust runtime's frame loop, browser events, and a WebGPU canvas. Putting `wgpu`, the browser DOM, fetch, Cache Storage, and Emscripten glue directly into the engine core now would introduce several unvalidated lifecycle and platform couplings at once.

## Decision

The first WebGPU host slice uses the `WorldSnapshot` produced by `game run --json` as an explicit bridge contract:

- the engine/CLI produces serializable world state;
- the browser host owns the WebGPU adapter/device/canvas and render loop;
- the browser host converts pointer events into the same world-space `{ position, down }` semantic frame as native;
- the host retains snapshot sourcing, fetching, and later storage/cache policy instead of adding them to the engine core;
- regenerate the fixture with `scripts/export-web-host-snapshot.ps1` rather than copying state by hand.

This version explicitly does not claim a live WASM game loop, browser input driving the Rust simulation, or a completed Web storage adapter. Those requirements need a separately measurable long-lived slice after the bridge contract is stable.

## Consequences

- Engine snapshot → WebGPU rendering, canvas resize, and semantic pointer conversion can be validated independently first.
- Native and Web share a data contract instead of sharing a window implementation unsuitable for every host.
- The current snapshot and runtime are at two different points in time; do not treat the pointer event in this document as game simulation input.
- Promote this into a formal Web runtime API only after the live-loop ABI, reload safe point, and host ownership have test evidence.

The later `0015-emscripten-live-host-bridge.md` connects a live WASM frame loop, and `0016-bundle-generation-and-browser-storage.md` connects sample bundle/cache/generation smoke; this decision still defines only the snapshot layer and must not be read as the complete Web runtime state.
