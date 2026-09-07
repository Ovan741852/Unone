# Engine design audit

Reviewed revision: `8f99faa921bff695539534044f067196279b0c93`.
Scope: Rust runtime, Web runner/presentation, asset failure reporting and scaling.
Android/iOS capability work is explicitly deferred. This audit changes no engine code.

## Findings and recommended order

### 1. High: presentation callbacks control simulation speed

`web/runner/main.js:335` and `web/presentation/main.js:475` advance exactly one
engine tick per scheduled callback. `runtime.rs:25` defines that tick as 1/60 s.
There is no elapsed-time accumulator. With callbacks at 120 Hz the engine advances
two simulated seconds per wall-clock second; at 30 Hz it advances half a second.
Frame/input replay remains deterministic, but real-time gameplay pacing does not.

Use a shared Web fixed-step scheduler with an elapsed-time accumulator, bounded
catch-up and an explicit background/resume policy. Consume one-shot input once
per simulation tick and render independently. Keep frame-driven recording separate.
This is a host timing boundary correction, not a change to the Rust fixed timestep.

The presentation fallback also stops working after any successful RAF callback:
`rafAlive` becomes true and never resets (`presentation/main.js:84`). An isolated
Node probe executing the actual scheduler with fake RAF/timers produced
`{"firstVisibleCallback":1,"callbacksAfterHiddenFallback":1,"expectedIfFallbackWorks":2}`.
The probe establishes callback logic, not actual browser background timing.

### 2. High: failed hot reload can retain mixed state

`web/runner/main.js:304` invokes `installGeneration` before validating/reloading
the script. `web/live/bundle-store.js:276` persists the active pointer. A later
script failure leaves storage ahead of the running session. Scene/system/audio
configuration changes are read incompletely or not applied during this reload.

`runtime.rs:604` replaces the source before acceptance; `runtime.rs:908` runs
onReload against live API state before swapping the update function. A callback
that writes state then throws does not roll back its writes. Keeping the previous
function is weaker than preserving the previous working runtime.

This is an existing unresolved ownership problem, already described in
[the reload proposal](../work-packages/2026-09-06-web-reload-consistency.md).
Implement bounded candidate preparation and coordinated activation. Unsupported
scene/system changes must report restart-required before activation. Do not build
a generic transaction framework. Existing reload tests cover syntax failure and
successful replacement; they do not establish rollback of callback side effects.
This audit confirms the source paths, not a new executable Rust rollback probe.

### 3. Medium: asset failure disappears while the asset remains broken

`web/runner/sprite-layer.js:181` clears a declared asset's error every render,
but `beginAssetLoad` returns immediately when `loadStarted` is true (`:125`).
After a failed load, the next frame reports no error, retains the fallback and
does not retry. This undermines machine-readable visual validation.

A Node probe imported the real module with a minimal DOM and rejected loader:
`{"afterFailure":["ASSET_LOAD_FAILED"],"afterNextRender":[],"loadAttempts":1,"visual":"unone-asset-fallback"}`.

Keep explicit loading/ready/failed state per asset generation. Clear diagnostics
only after successful loading/decoding or removal; provide an explicit retry path.
Add a second-render regression to the existing sprite test. This is a local fix.

### 4. Medium: Web capabilities are split between incompatible host entry points

The runner renders ordinary sprites and handles bundle reload/save transport.
Audio playback lives in `web/presentation/main.js:360`; the runner loads audio
configuration into Rust but has no audio playback consumer. A successful audio
API call therefore does not mean audible output in the general runner.

Share concrete audio/presentation consumers under one general Web host, retaining
specialized pages as diagnostics where useful. Expose host playback capability
and failure status, separately from enabled core systems. Do not move browser
audio or CSS into core. This is a delivery/host composition gap, not evidence
that the semantic engine/host boundary is wrong.

### 5. Medium: physics considers every entity pair

`world.rs:1045` gathers all entity IDs before the nested pair loop; entities
without bodies are rejected only inside `resolve_circle_collision`. With 1,000
entities this calls the resolver 499,500 times each tick, even if most are visual.
This is a source-derived operation count, not a measured frame-time benchmark.

First filter eligible colliders. Then use a deterministic spatial broad phase
when representative RTS/fish scenes justify it. Sort resulting pairs explicitly
to preserve resolution order. A full ECS rewrite is not needed to correct this.

### 6. Medium: profiling accumulates permanently during ordinary gameplay

`performance.rs:80-85` keeps an unbounded `Vec<FrameTiming>`; `runtime.rs:733`
records every tick. Reports copy and sort the entire history. Long-lived Web
sessions accumulate samples even without a requested profiling session.

Keep cumulative counters/maxima and a bounded sample window, or make exact full
capture an explicit bounded profiling session. Document whether percentiles
describe that window or a captured run. This is a local lifetime/data-retention fix.

## Follow-up optimizations, not prerequisites for every capability

- Web publishes a cloned full snapshot, serializes it for the digest and again
  for transport, parses it in JS and updates diagnostic text each frame. Measure
  realistic scenes before changing transport; lower diagnostic refresh frequency
  and avoid unnecessary DOM rebuilds before adding binary/delta protocols.
- Engine English-only migration remains incomplete: current public diagnostics
  in `world.rs` and the audio config rejection in `runtime.rs` still include
  Chinese. Treat this as incomplete delivery, not a reason for new architecture.
- A capability API inferred only from target architecture (`platform.rs`) cannot
  describe which Web host actually plays audio/renders a given asset. Capability
  discovery should reflect the active host.

## Verification

- `cargo test -p unone-engine --lib`: 154 passed.
- Targeted reload tests: 2 passed (also included in the 154 above).
- `node --test web/runner/semantic-output.test.mjs web/runner/sprite-layer.test.mjs web/shared/webgpu-snapshot.test.mjs web/live/bundle-store.test.mjs`: 8 passed.
- Two additional in-memory Node probes reproduced the scheduler fallback and
  persistent-asset-error defects above. No source/test files were changed for probes.
- Passing existing tests does not cover real-time pacing, failed reload side
  effects, long sessions, or complete audible/visual game acceptance.

## Boundaries to retain

Rust mechanisms and Luau game rules, deterministic tick/replay, independent visual
transforms and colliders, and semantic engine-to-host output remain useful.
DOM may use CSS; Canvas does not need a CSS interpreter. Current ordinary Web
sprites use a DOM overlay, so their CSS implementation is not itself a violation.
Do not add a replacement UI framework, generalized scene CRUD, or an ECS rewrite
as incidental work for these findings.

## Independent review disposition

Luna/max Web reviewer independently confirmed the disappearing sprite diagnostic
and presentation scheduler liveness defect. Its additional observation that the
runner stops in a hidden pane is treated as a missing explicit lifecycle policy,
not automatically a defect requiring background simulation. Pausing hidden games
can be intentional; an AI recording/test driver needs a separate explicit mode.
Do not adopt a permanent timer loop merely because a reviewer suggests one.
