# Profiling for AI-directed optimization

Execution mode is now explicit in `execution` on profile reports and platform /
developer-session metadata. Diagnostic preview builds disable Luau native codegen
even when sampling is off. Pair diagnosis with a no-preview production-mode run;
see [paired validation and Wasm JIT distinctions](runtime-mode-validation.md).

Profiling is an engine primitive. Games keep their rules in Luau; AI chooses experiments and changes from evidence. No engine operation labels a subsystem as the bottleneck or automatically rewrites gameplay.

Web development players and the native developer endpoint accept the same strict requests:

```json
{"method":"profile.start","sampling":true}
{"method":"profile"}
{"method":"profile.stop"}
```

Start after warmup and scenario reset; stop before resetting again. `sampling` defaults to false. Each start creates a new ID and clears core counters; starting while active fails. The first/last frame delimit the measured completed ticks. Stop freezes the window, removes the interrupt callback and leaves gameplay running. Lua update failure also ends sampling. Cached counts carry a separate current frame: counts can change after a window is stopped.

`profile` and `memory` no longer require a full world snapshot or observation digest. Core counts include packed instance count and unencoded instance bytes. Core frame percentiles retain at most 1,024 samples, while totals span the window. Web host CPU distributions retain at most 2,048 samples, expose total tick/render counts, and separate input transfer, WASM tick/publication, JSON decode and rendering. Native currently returns `host_window: null`; its runtime windows and Lua samples are available, but renderer CPU data is a last-frame value. GPU metrics use their own asynchronous rolling window and are not added to CPU times. The legacy `bridge_ms` includes WASM execution and must not be interpreted as pure transport.

Function attribution needs no game instrumentation. The profiler samples Luau stacks at VM safe points, with clock checks every 64 interrupts and at least 1 ms between samples. Each function has source, definition line, name, self sample count and inclusive sample count; stacks are leaf-first. Inclusive counts deduplicate recursive occurrences within a sample. Anonymous functions use source/line identity. Limits are 1,024 function keys, 4,096 stack keys and depth 32; overflow and truncation are explicit counters.

These are **sample counts, not exact milliseconds or call counts**. Safe-point distribution, short functions, inlining, native calls and garbage collection can bias attribution. There is no asynchronous sampling inside native execution. The hook itself has overhead, even when no sample is retained. Use sampling to locate candidates, then disable it for performance comparisons. No clock or timing result is exposed to gameplay or added to observation digests. Production players have no profiling request ABI or installed sampling hook.

For a repeatable exported-WASM CPU experiment:

```powershell
node scripts/profile-player.mjs --export <development-export> --warmup 30 --frames 180 --repeats 3 --output baseline.json
node scripts/profile-player.mjs --export <development-export> --warmup 30 --frames 180 --repeats 1 --sampling --output functions.json
node scripts/compare-player.mjs --before <baseline-export> --after <candidate-export> --output comparison.json
```

The runner loads the actual exported payload, fixes seed/input, reloads for each repetition, records artifact hashes, raw phase samples and observation-digest checkpoints. It excludes renderer, GPU, RAF scheduling and recording. A CPU throughput improvement is not a measured browser FPS improvement. Compare repeated unsampled runs and digest checkpoints, then validate the real browser separately. Compare sampled/unsampled runs on the same artifact to quantify collection overhead.

The comparison runner alternates before/after order across fresh Node processes, uses the median of each run's mean CPU cost, and rejects mismatched digest checkpoints. Percent reductions from separate experiments must not be added together. The human Profile tab exposes start/stop and automatic Lua sampling through the same API; function rows show self and inclusive sample counts. Tool-registry polling is also lightweight and no longer serializes the world.

Worked example: [Legion Fall measurements](legion-fall-optimization.md). Transport details: [WASM memory instances](instance-memory-transport.md). Future game-owned kernels: [WASM compute proposal](proposals/wasm-compute-v1.md), not an implemented API.

For frame pacing, `host_window.render_cadence` reports bounded render-completion interval distributions plus total intervals exceeding 16.667 ms. These are CPU completion times, not verified display presentation. Use an unpaused foreground player; do not interpret paused renders as gameplay FPS. An average above 60 does not imply a stable 60 Hz cadence.

The Node runners accept `--checkpoint-every 1` for every-tick behavior comparison and `--setup-requests path.json` for up to 64 strict core Developer requests after each fresh load and before warmup. Discover control revisions first; an invalid or stale setup fails explicitly. Setup requests are recorded in the report. Use a game's own no-death stress control to keep population constant, and report both mean and p95 costs. The comparison summary includes both; reducing spikes is distinct from reducing total work.

`publication` now separates canonical encoding, exact SHA-256/cache work, presentation conversion and envelope output on the Web bridge. It shares the core window ID and reports bounded samples plus total byte/work counters. Native returns null. See [the cache contract](canonical-hash-cache.md) and [the tool review](performance-tools-review.md).

`runtime.slowest_frame.frame` is the completed world frame (older reports used the window's sample index). `host_window.dropped_steps_delta` excludes events before the window and becomes null for unavailable/reset counters. It freezes on stop.

Use `--no-profile-window` for before/after throughput comparisons without active publication timers. This does not remove the engine's existing passive runtime timing. For overhead assessment on the same export, `compare-player.mjs --before-profile-window disabled --after-profile-window enabled` records both conditions. `repeat_variation` exposes each pair's change and the observed range; mixed signs are not a reliable optimization result. `--sampling` cannot be combined with `--no-profile-window`.

Profiler output correction: luau_positive_heap_delta_bytes_per_frame measures positive net heap growth, not total allocation throughput. It replaces the misleading allocation key in new builds. See [proposal review and migration](performance-proposal-review.md); canonical replay bytes are unchanged.

## AI-readable wake timeline and VM metrics

Development player `describe.profiling` discovers report paths. Use the existing
`profile.start` / `profile` / `profile.stop` API; the human panel reads exactly the
same data. Core/Node requests use `profile_start` / `profile_stop` spelling.

- `host_window.timeline.wakes`: last 120 settled RAF/watchdog wakes, including
  scheduling, callback start/end, RAF timestamp, step/catch-up/drop result and
  bounded error text. The failed wake is recorded before error handling freezes
  the host window. Cancelled/hidden wakes have no callback span.
- `timeline.ticks`: last 360 ticks with completed world `frame`, start/end and
  input, WASM tick/publication, decode, post-tick CPU spans. Post-tick includes
  audio synchronization and save JSON/localStorage. Exceptions before completion
  appear in the wake error; they do not invent a successful tick span.
- `timeline.renders`: last 120 full draw-call spans with world frame and paused
  flag. `render_ms` covers renderer + DOM UI; span duration also includes metric
  collection and frame-attribute updates. Manual draws need not have a wake.
- All host times use this page's `performance.now()` clock. Join host ticks to
  `window.vm.frames` by world frame, not by subtracting Rust and JS timestamps.
  Total counts expose truncation relative to retained sample lengths. Stop
  freezes data; restart clears all traces. Read occasionally or after stop;
  repeatedly serializing a profile is itself work.

`window.vm` is available in native and development WASM builds. It measures only
the Luau update call (including its engine callbacks), not load/start or manually
invoked developer tools. `frames[].completed=false` identifies a failed script
update; its frame is the attempted next world frame. Totals span the window;
per-frame details retain the most recent 1,024 attempted updates.

`allocation_growth_bytes` sums `max(new_size-old_size,0)` from successful Luau
allocation/reallocation callbacks. `allocation_growth_events` counts positive
growth requests. This captures allocation churn even when objects die within
the same update. It is not heap delta, retained memory, allocator page overhead,
freed bytes, or Rust/JS allocation volume. Native and WASM object sizes can differ.

`incremental_gc_ms`, `incremental_gc_steps`, and `incremental_gc_max_step_ms`
measure paired Luau incremental-GC interrupts, including automatic assists.
They measure wall time within the update, with instrumentation overhead. They
are already inside script CPU time: **do not add them again**. Luau full GC does
not emit these pairs. `full_gc_ms`, `js_gc_ms`, and `rust_allocation_bytes` remain
null, while the report's versioned `availability` map labels each capability as
`unsupported`, `not-applicable`, or `not-collected`; unavailable values are
never encoded as zero. A RAF gap alone cannot prove GC, queue blocking, or actual display
presentation. GPU timing remains separate.

A supported GC step may report 0 ms when shorter than the host clock resolution;
its step count still increases. Zero measured time does not prove zero work.

Hooks exist only during a profiled update and are restored on errors. They chain
the existing function sampler and preserve mlua's callback userdata. No timing
enters Lua or canonical observations. The callback interpretation is audited
against vendored Luau 709 (`lmem.cpp`, `lgc.cpp`); dependency upgrades must recheck
the callback pairing and allocation semantics. Production does not compile the
VM probe or include the host profile module. See [validation](profiler-tools-validation.md).

## Native Sprite renderer measurements

Native reports expose `renderer_cpu_phases.sprite_prepare` (painter ordering and
instance packing) and `sprite_upload` (CPU buffer comparison/update and camera
uniform update). Both are contained in `prepare`; do not add them a second time
or interpret them as GPU duration. Unchanged packed instances skip GPU uploads.
The final capture's draw/instance counters describe one redraw, not the sum of
the presentation and screenshot passes.

Use `scripts/benchmark-native-sprites.mjs` with before/after release executables,
then `scripts/compare-native-sprites.mjs` to reject changed end-frame pixels or
simulation state. `scripts/smoke-native-sprites-android.mjs` runs the same packages
in an isolated Android test app. See [measured results, limitations and the
cross-backend color gap](evidence/2026-09-19-native-sprite-performance.md).
