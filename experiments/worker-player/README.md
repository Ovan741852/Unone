# Actual Web Worker player experiment

This runs the exported Legion Fall Luau/WASM simulation in a real browser Worker.
It is executable game code, not a scheduling model. The ordinary shipping player
and `api.jobs` backend are unchanged; this is not yet a drop-in production host.
The game source is unchanged. Moving only `acquire` would require an immutable
query snapshot and change its current sequential, moving-position semantics.

## Run

Use a modern Node executable (the bundled Codex Node works; Node 12 does not).
Build/export the current Legion Fall development player as its README describes.
Then:

```powershell
node experiments/worker-player/install.mjs _Games/legion-fall/dist/worker-probe
python experiments/worker-player/serve.py _Games/legion-fall/dist/worker-probe --output _Games/legion-fall/dist/worker-results --port 8213
```

Open `/worker.html?mode=worker&label=desktop-final` or `mode=main` on that server.
The LAN server lets BlueStacks Chrome open the same artifact. Reports are written
locally with a bounded JSON endpoint, under the specified output directory.
`?mode=worker&label=desktop&verify=1` compares 180 actual Worker/main ticks and
all copied instance bytes. A mismatched digest or byte explicitly fails.

## Ownership and transport

- One Worker owns the complete VM, fixed-step simulation and canonical publication.
  Gameplay remains Luau; no targeting or battle rules were moved into Rust/JS.
- Main thread owns Three rendering. Static models load once on the main thread.
- The worker copies packed instance bytes into a transferable ArrayBuffer and
  rewrites offsets. It sends buffers only when instance revisions/layout change.
  This is one worker-side copy, not shared WASM memory or zero-copy end to end.
- At most one state message is awaiting acknowledgement. Intermediate presentation
  updates may be skipped under backpressure; simulation ticks are not skipped by
  this mechanism. Both schedulers separately cap catch-up to two ticks per wake
  and report dropped ticks.
- The fixture has empty input, immortal 10,000 troops and a fixed wide camera.
  It intentionally does not wire interactive input, audio playback, persistence,
  hot reload or the normal developer UI through asynchronous RPC. Do not enable it
  as the default engine host until those lifecycle contracts are implemented.

## Measurement

Both modes warm up for at least 120 engine ticks, then measure 30 wall seconds.
The renderer uses 1280×720 CSS, capped device pixel ratio 2: record `canvas` rather
than assuming identical physical resolution across devices. Read `raf_fps` together
with `simulation_ticks_per_s` and `dropped_ticks`. The battle commits at 20 Hz;
repeated rendering is not 60/144 distinct battle poses. RAF cadence and CPU render
completion do not prove display scanout.

Reports expose raw RAF, draw and tick durations; main vs Worker placement; worker
packing cost, transferred bytes, bounded state message count, event-delivery lag,
replay checkpoints and retained 10k population. Message lag compares the two
performance time origins and includes browser delivery/queue delay, not pure IPC.

Run one probe at a time without compilation or recording. Record a separate run;
do not quote its FPS as an uncontaminated benchmark. Browser visibility/occlusion,
OS scheduling and emulator overhead remain uncontrolled. BlueStacks is not a
physical-phone performance guarantee. The experiment stops its worker after the
measurement; keep the tab visible until the report is saved.
