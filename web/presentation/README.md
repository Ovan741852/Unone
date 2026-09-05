# Presentation host

A Web host that draws what the engine publishes: Rust/Luau owns the fixed-tick
simulation and the semantic state, this page owns the runtimes that turn it into
pixels. It never decides a game result.

```powershell
# from D:/Projects
python -m http.server 8001
# then open
# http://127.0.0.1:8001/Unone/web/presentation/?project=/Unone_Games/slot-machine/
```

The page needs `target/wasm32-unknown-emscripten/debug/deps/unone_web_live_smoke.js`;
build it with `scripts/build-web-live.ps1` first.

- Each entity's `animation` in the snapshot selects a spine-webgl clip. The clip
  restarts only when `started_frame` changes, so the host never restarts a loop
  every frame.
- `world.effects` is mirrored one-to-one onto Effekseer instances by handle. The
  sample ring is authored on the ground plane, so the host stands it up to face
  a 2D camera; that rotation is a host convention, not engine state.
- The project's `systems` block is forwarded to the engine with the project
  payload. Without it the engine reports `SYSTEM_DISABLED` for animation and
  effect calls, exactly as it would on disk.

## Recording

`window.unoneHost.record({...})` renders a fixed number of engine frames at an
explicit size and POSTs each one to `scripts/record-presentation.py`, which
writes the GIF and overlays the engine state that produced each frame. It drives
the loop itself because a headless browser pane starves `requestAnimationFrame`
and throttles timers; the engine is fixed-timestep, so the result is identical.

```powershell
python scripts/record-presentation.py --out artifacts/presentation --gif artifacts/slot.gif
```

```js
await window.unoneHost.record({
  frames: 230, width: 640, height: 360, every: 2,
  endpoint: "http://127.0.0.1:8010/frame",
  script: [{ frame: 12, action: "Spin" }, { frame: 140, action: "Spin" }],
});
```

## Runtimes

See `../vendor/README.md`. Effekseer is MIT; **Spine is not free software** and
requires a valid Spine licence for everyone who integrates it.
