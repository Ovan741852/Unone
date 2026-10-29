# Profiling for AI-directed optimization

## Official production-player completion counters

Engine 0.2.0's official Web player exposes a read-only endpoint without enabling
the developer profiler:

```javascript
const sample = window.unonePlayerPerformance.snapshot({windowMs: 1000});
```

The version-1 report is detached and frozen. Querying does not tick, pause,
reset, decode another world, or send a worker command. The default window is
5000 ms; valid windows are finite, positive and at most 60000 ms.

| Fields | Meaning |
|---|---|
| `version`, `session`, `backend` | Schema version 1, successful-load/restart session and runtime backend. Compare deltas within one session. |
| `simulation_frame`, `simulation_time_seconds` | Latest decoded snapshot accepted by the main host, including worker execution. |
| `accepted_publications`, `publication_at_ms` | Count/time of main-host acceptances, not the worker's publication clock. |
| `time_origin_ms`, `queried_at_ms` | Main-host `performance.timeOrigin` and query `performance.now()`; completion timestamps use the same clock. |
| `draw_attempts`, `completed_draws`, `presented_frame_changes` | Attempts, completed world/UI/cursor submissions and changes of submitted simulation frame. Repeated redraws count as submissions, without advancing simulation. |
| `last_presented_snapshot_frame`, `last_completed_at_ms` | Last successful submission's frame/time. Pending/unavailable/incomplete passes cannot update these as successful draws. |
| `completion_contract`, `last_draw_status` | Explicit outcome availability (`available`/`unknown`) and latest result (`completed`/`skipped`/`unknown`/`error`). |
| `skipped_draws`, `unknown_draws`, `error_draws`, `skip_counts` | Non-completion counts, with fixed resource/context/diagnostic reasons. |
| `dropped_steps_total`, `paused` | Session-relative scheduler drops, or null if unavailable; current pause state. |
| `completed_intervals` | Window p95/p99 and coverage endpoints/sample count from a fixed 512-entry numeric ring. |

Measure counter/frame deltas over host wall time. RAF callbacks alone do not
prove rendering; completed submission alone does not prove 60 Hz simulation or
physical scanout. Report unknown/missing evidence as insufficient. The old
periodic `data-player-performance` report remains coarse, while this accessor
reads current counters. Its last dirty UI render cost is not the cost of every
draw. Resource/context skips must not be assigned zero render time.

The foreground official player retains the update → acceptance → draw order
within one originating RAF transaction. It awaits bounded fixed 60 Hz updates,
then submits their accepted snapshot before preparing another tick. Only one
update chain can be in flight; a delayed worker cannot enqueue another update
or claim a completed draw before acceptance. Catch-up is capped at five steps
and excess whole steps are counted as dropped. A bounded timestamp-rounding
tolerance retains negative debt. Paused players may redraw UI, while hidden
time is excluded on resume. Neither 60 simulation steps nor 60 completed
submissions establishes 60 changed presentations; compare all three counters.

A render-first preparation draft was withdrawn before packaging: updating the
next Luau View while the previous view remains visible advances game-owned
private projector/hit caches before input on that view is consumed. The current
input contract has no presented-view revision/history with which to reconstruct
those private caches. Keeping a last-drawn host snapshot alone cannot repair
them. The retained order avoids adding that whole-frame mismatch; it does not
create a new event-time or historical-view input guarantee.

Additional version-1 fields retain the original `completed_intervals` clock and
meaning. They never turn a failed completion-time gate into a passing result:

| Field | Meaning |
|---|---|
| `successful_submission_raf_intervals` | Browser RAF timestamp intervals for explicit successful scheduler RAF submissions. Pending, unknown and failed passes do not count. Repeated snapshots can count. |
| `new_snapshot_raf_intervals` | RAF intervals only when a valid advancing frame is globally first submitted in that RAF. Startup/manual frames already shown, repeats and regressions are excluded. |
| `submit_sync_wall`, `callback_sync_wall` | Actual wall duration of scheduler submission and its known synchronous drawing continuation, measured after awaited preparation. Startup/manual and worker/job waits are excluded. These are nested scopes, not additive CPU totals. |
| `preparation_wall` | Active update-chain elapsed time, including worker/job waits. Cancelled or stale-session chains cannot pollute this distribution. It is not a CPU measurement. |
| `raf_diagnostics` | Per-source and outcome totals, scheduler repeats/regressions/in-flight counts, callback/preparation totals and explicitly nominal deadline estimates. |

Each new distribution uses at most 512 numeric samples and reports max,
percentiles and coverage. Nominal deadlines compare actual work/readiness time
with the supplied RAF timestamp plus its target step budget (normally 16.667 ms).
They are estimates, not GPU, compositor, physical refresh or OS acknowledgements.
Update or draw work can still delay submission, a later RAF or physical scanout.
These diagnostics do not make over-budget work disappear.

Default queries and the existing 30-draw report include summaries only. To
inspect paired events separately from a low-overhead acceptance run:

```javascript
const diagnostic = window.unonePlayerPerformance.snapshot({
  windowMs: 1000,
  includeRafSamples: true,
});
const rows = diagnostic.raf_diagnostics.samples;
```

The opt-in array contains at most 512 detached frozen rows after window
filtering: `source`, `raf_time_ms`, `start_ms`, `end_ms`, `callback_end_ms`,
`snapshot_frame`, `outcome`, `new_snapshot`, `regression` and `in_flight`.
Sources distinguish `scheduler_raf`, `startup`, `manual` and unknown callers.
`end_ms` remains the actual submission attempt's completion clock, never the
RAF timestamp. A real scheduler RAF token survives asynchronous preparation;
its `start_ms` and `callback_end_ms` measure the actual synchronous drawing
continuation, not the elapsed await. Cancelled preparation has no successful
submission/cadence sample. Startup/manual draws retain null RAF fields.
`includeRafSamples`
must be a boolean; unknown public query options fail explicitly. Recording uses
fixed primitive storage and constructs row objects only for the opted-in query.

Unchanged official-player saves use an engine-issued immutable memory lease and
worker generation delta. The host reuses decoded read-only content and its encoded
storage string until replacement, clear, reload or unload. Canonical inspection
still contains the full save. This reduces publication/decode/JS allocation work;
it does not imply that game-owned save generation is allocation-free.

## Developer profiling

### Phase-only opt2 diagnosis

Use the separate `phase-profile` diagnostic runtime when locating Core costs in
an opt2 production workload. Build with `build-web-live.ps1 -Player -PhaseProfile`
and export it as a development artifact. It keeps production bytecode optimization
2 and installs no function sampler, allocation callback or GC callback. Ordinary
sampling development builds retain opt1. Production players expose neither
diagnostic request ABI. Check `runtime.json` (`phase_profile=true`,
`profile_mode="phase-only"`) and the report's `execution.phase_profile` and
`execution.bytecode_optimization_level`; native codegen remains disabled.

```javascript
await window.unoneDeveloper.request({method:"profile.start",sampling:false});
// Run the existing scenario; query after the measured window.
const report = await window.unoneDeveloper.request({method:"profile.stop"});
```

Core/Node uses `profile_start` / `profile_stop` through the existing developer
ABI. `sampling:true` fails `PROFILE_SAMPLING_UNAVAILABLE` in phase-only mode
without starting/resetting a window. `window.vm` reports null values with
`availability="not-collected"`; this mode cannot diagnose Luau GC or functions.
It is a diagnostic artifact, not a production FPS acceptance run. Measure active
versus stopped-window overhead on the same artifact and verify paired canonical
outputs before attributing a production workload.

`window.core_phases` retains the last 1,024 accepted tick attempts, tagged with
attempted/completed world frame. It splits raw UI conversion, typed parse/layout
validation, owned-tree commit/drop and image resource admission. These are
children of `script_total_ms`. `script_outside_measured_ui_ms` includes Luau
wrappers, gameplay and other bindings; it is not pure Luau time. World snapshot,
observation clone, UI clone and host-state clone are children of
`observe_total_ms`. Do not add parent and child spans. Failed attempts are
explicit, manual tools/load/start are excluded, and stop/error freezes the window.
Percentiles use retained attempts; totals span the window. There are no per-node
or per-quad clock reads.

`publication.frames` joins successful world publications by frame and path
(`direct`, `instances`, `retained`, `retained-instances`). Its four disjoint
`phase_order` entries cover canonical encode, exact hash, presentation metadata
and envelope. Retained resources use the same actual encode/hash operations;
diagnosis does not perform a second probe serialization. The ring is bounded to
1,024, with p50/p95/p99 calculated on read. Save preparation, final temporary/
lease retirement and ABI ingress can remain outside these spans. Treat the
outer ABI time minus measured phases as residual, not proof of Luau or GC.

For a separate opt2 function-attribution experiment, build with
`-Player -SamplingProfile`. This is `profile_mode="opt2-sampling"`, with
`execution.sampling_profile=true`; it uses the existing function safe-point
sampler and VM allocation/GC probes. Start with `sampling:true` and compare with
an unsampled window on the same artifact. Unlike phase-only mode it carries
callback overhead, and opt2 inlining can hide small functions. Counts are
safe-point samples, not exact milliseconds; native binding work is not sampled
asynchronously. This artifact is not eligible for production FPS acceptance.
The build script makes `-Development`, `-PhaseProfile` and `-SamplingProfile`
mutually exclusive. If Cargo features are combined directly, phase-only policy
takes precedence and function sampling remains unavailable.

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
