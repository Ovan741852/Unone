# Profiling for AI-directed optimization

## Measuring the game's own Luau: `api.profile`

Time a piece of game code with a named span and count per-frame work with a
counter; never time code with `api.hostTime` or report timings through
observations, which would change the run and its digest.

```luau
local path = api.profile.span("ai.pathfind", function() return findPath(a, b) end)
api.profile.count("ai.nodes", visited)
api.profile.mark("city.interactive") -- a milestone the game defines, see below
```

`span` returns the function's results and records wall time and Luau heap
growth; spans include the spans nested in them. `count` adds to a counter whose
value closes at the end of each frame. Nothing is returned to the game, so a run
is identical with or without profiling, and the calls work in every build.

Read the results where frame timings already appear: `game perf`, `game run
--json` (`performance.spans`, `performance.counters`) and the session `perf`
request. The same report has `performance.startup`: how long importing assets,
reading the project, running the script's top level and `Game.start` took, and
the Luau heap after start. At most 256 distinct names are kept; later ones are
dropped and listed in the report's notes.

### Milestones the game declares: `api.profile.mark`

Only the game knows when it is usable: the city is interactive, a battle has
loaded. Say so once, when it happens:

```luau
if cityReady and not cityMarked then
    cityMarked = true
    api.profile.mark("city.interactive")
end
```

The engine records the name and the world frame (the loaded frame, 0, from the
top level or `Game.start`; otherwise the frame that update produces) and never
judges whether the state really was usable. `game perf` and `game run --json`
list them as `performance.marks`. The official Web player adds its own clock:
`window.unonePlayerPerformance.snapshot().milestones.rows` gives each mark's
`accepted_at_ms` (the main host accepted the snapshot that carried it) and
`presented_at_ms` (the first completed submission whose presented frame reached
it), on the same `performance.now()` clock as the rest of that report. Marks
never reach observations, digests or replays. At most 256 are kept per run, so
mark milestones, not every frame. The player polls one integer per tick and
reads the marks only when it changes; a runtime built before marks existed has
no `milestones` and the measurement tool below reports the milestone as null.

## Measuring a production Web export

`scripts/measure-web-export.mjs` loads one production export in headless Edge
or Chrome, the same way every time, and writes one JSON report: every raw sample
beside its median and p95. Node 22+ and no dependencies.

```powershell
game --project <game> export web --output <new dir> --json
node scripts/measure-web-export.mjs --export <new dir> --output load.json --milestone city.interactive
```

By default it makes 5 cold runs (each a new browser process and profile, so the
HTTP and compiled-code caches are empty), 5 warm runs (one profile primed by a
first load that is kept but not summarized; each run is a new document) and one
profiler pair (the same warm load with `?unone_profile=1` and without it,
alternating which goes first). Every load uses seed 42 (`?seed=`), a 1280×720
viewport at DPR 1, emulated focus, cleared local storage, a muted browser that
is closed at the end, and a loopback server that applies the export's own
`cache_policy` from `export.json` (index.html revalidates, the release
generation is immutable) with ETags. A run waits for the first presented frame,
then for every `--milestone` to be presented, then `--settle-ms` (1000) before
reading everything once.

| Option | Use |
|---|---|
| `--cold N`, `--warm N`, `--profile-pairs N` | How many of each (0 skips a kind). |
| `--milestone NAME` (repeatable) | Wait for the game's `api.profile.mark(NAME)` to be presented and report it. |
| `--viewport 926x428 --dpr 3` | The device shape to emulate. |
| `--network slow-4g` or `LATENCY_MS,DOWN_KBPS,UP_KBPS`, `--cpu-throttle 4` | Browser emulation, recorded as such; not a real phone or radio network. |
| `--cache-control VALUE`, `--compress gzip` | Serve differently from the export's own policy. |
| `--backend main\|worker`, `--seed N` | Override the presentation's backend or the seed. |
| `--timeout-ms`, `--settle-ms`, `--frame-window-ms` | Per-load limit, the wait before sampling, the `unonePlayerPerformance` window. |
| `--keep-storage`, `--allow-development`, `--browser PATH`, `--headed` | Keep saves between runs, measure a development export (marked in the report), choose the browser. |
| `--scenario FILE`, `--scenario-runs N` | Drive the game through a scripted scenario and sample memory per round; see [memory over round trips](#memory-over-round-trips---scenario). |

| Report section | Contents |
|---|---|
| `artifact`, `engine`, `execution` | SHA-256 of export.json, index.html and runtime.json; the WASM and JS hashes (checked against the files before measuring); release root, file count, bytes; the engine source commit and whether it was dirty; variant, build profile, bytecode optimization level and profile mode. A development export is refused unless `--allow-development`. |
| `environment`, `conditions` | Browser product, user agent and flags; GPU as the browser reports it; OS and CPU; viewport, DPR, seed, server cache policy, emulation, `foreground_all_runs`. |
| `clock` | Origin `window.playerBoot`: the export's index.html sets it before any module loads. |
| `runs[]` | One per load. `metrics` holds the flat numbers the summary uses. Beside them: `startup_steps` (start, completion and duration of each startup-screen step: module graph, content, images, fonts, runtime, data, game, renderer, audio, first frame), `navigation`, `wasm` (fetch from Resource Timing, compile and instantiate from timing wrappers), `javascript`, `fonts`, `images` (queue, start, completion and decode per image from `unonePlayerAssets`), `milestones`, `frames` (one `unonePlayerPerformance` window), `memory` (JS heap, WASM linear capacity and image residency, never summed), `long_tasks`, `resources`, `server_requests`, `profile` (profiler-on runs), `foreground`, `console_errors`. |
| `summary` | `cold` and `warm`: for each metric, n, nulls, median, p95, min and max over the successful runs of that kind. `profiler_pairs`: off, on and on minus off. |
| `coverage` | Requested, completed and failed runs per kind, with each failure's error. The process exits 1 when a run failed. |

How to read it:

- Unknown is null, never zero. Sizes the browser hides (a cross-origin or
  opaque-origin response without `Timing-Allow-Origin`) are null, and a zero
  `transferSize` is not taken as a cache hit: `cache` comes from the browser's
  own network log, and `server_requests` shows what actually reached the server.
- Quantiles are per metric across runs of one kind. They are never added to one
  another; a within-run value such as `images.decode_ms_max` or
  `frames.successful_submission_p95_ms` is one number per run like any other.
  p95 is nearest-rank, so over five runs it is the slowest run.
- `player.first_successful_submission_ms` is the player's `first_presented_ms`:
  the startup frame was submitted and confirmed complete. It is not the moment a
  player can act; that is the game's milestone.
- Compare profiler-off runs for acceptance; profiler-on runs locate costs.
- The `split` WASM timing replaces `instantiateStreaming` with exactly the two
  steps it is specified as (`compileStreaming`, then `instantiate`) to time each;
  `--wasm-timing observe` times the original call instead. A worker backend loads
  WASM in a Worker the page cannot see, so its WASM timings are null.
- One machine, one browser, headless: not a phone, not GPU time, not physical
  display. Memory over scene round trips is the scenario mode below; long
  frame-time windows are a separate measurement.

### Memory over round trips: `--scenario`

A scenario drives the exported game with real browser input and samples memory
as it goes. The game marks each screen as usable with `api.profile.mark`; the
scenario presses keys or taps, waits for those marks, and repeats.

```powershell
node scripts/measure-web-export.mjs --export <export> --output memory.json --scenario round-trip.scenario.json
```

```json
{
  "schema": "unone.web-scenario.v1",
  "name": "city-tech-bag",
  "start_mark": "city.interactive",
  "phases": [
    {"name": "menus", "warmup_rounds": 2, "rounds": 20, "steps": [
      {"key": "KeyT"}, {"wait_mark": "tech.interactive"},
      {"key": "KeyB"}, {"wait_mark": "bag.interactive"},
      {"key": "Escape"}, {"wait_mark": "city.interactive"},
      {"wait_ms": 300}
    ]}
  ],
  "settle_ms": 10000,
  "sample_ms": 250
}
```

| Step | Does |
|---|---|
| `{"key": "KeyT"}` | Key down, `hold_ms` (50), key up, as DevTools input events with the browser's `code`, `key` and virtual key code. Codes: `KeyA`–`KeyZ`, `Digit0`–`Digit9`, `F1`–`F12`, `Escape`, `Enter`, `Space`, `Tab`, arrows and modifiers. |
| `{"tap": [x, y]}` | Mouse move, press, `hold_ms`, release at CSS pixels from the viewport's top-left. Fix the viewport (`--viewport`) when a scenario taps. |
| `{"wait_mark": "name"}` | Wait for the next presentation of that mark after the last one a step saw, up to `timeout_ms` (`step_timeout_ms`, 15000). |
| `{"wait_ms": 300}` | Stay on the screen. |

Each scenario run is a fresh browser: it loads cold, waits for `start_mark`,
takes a baseline checkpoint, runs every phase's warmup rounds (kept, left out of
trends) and measured rounds, then sits idle for `settle_ms` and takes a final
checkpoint. Every round ends with a checkpoint. `--scenario-runs N` repeats the
whole thing; with `--scenario`, cold, warm and profiler-pair runs default to 0.
A run records at most 256 marks, so the scenario refuses more waits than that.

What a checkpoint reads, and the sampler every `sample_ms` between them:

| Source | Metrics |
|---|---|
| `unonePlayerPerformance.snapshot({includeMemory:true}).memory` | One row per owner, flattened to `<owner>.bytes`, `<owner>.entries` and the owner's other counts. See the owner table below. |
| DevTools `Runtime.getHeapUsage`, `Memory.getDOMCounters` | `js_heap.used_bytes`, `js_heap.total_bytes`, `js_heap.backing_storage_bytes` (when the browser reports it), `dom.nodes`, `dom.listeners`, `dom.documents`. Nothing forces a collection. |
| The OS, per browser process (checkpoints only) | `os.<process>.working_set_bytes`, `peak_working_set_bytes` (the OS high-water mark since the process started), `private_bytes`, and on Windows `gpu_dedicated_bytes` and `gpu_shared_bytes` from the GPU process-memory counters. `<process>` is `browser_process`, `gpu_process` or `largest_renderer` (with one page open, the page's renderer). Linux reads `/proc` without GPU memory; other platforms report none. |

The player's owner rows (`includeMemory:true`; the default snapshot leaves them out):

| Owner | What the number is |
|---|---|
| `wasm.linear_memory` | Linear memory capacity. It only grows; it holds the Luau VM, engine state and published buffers. |
| `luau.heap` | The main Luau VM in use, garbage not yet collected included (within `wasm.linear_memory`). Null on a runtime built before this read existed. |
| `images.decoded.resident` | Every decoded image the broker holds, width × height × 4. |
| `images.decoded.active`, `.scene`, `.groups` | Images some consumer leases, the scene plan holds, or preload/load groups hold. Each is within `resident`; they overlap one another. |
| `images.decoded.inactive_cache` | Ready images no owner holds, kept by the bounded LRU (within `resident`, apart from the three above). |
| `canvas_ui.images` | Decoded images the current Canvas UI borrows (within `active`). |
| `gpu.textures`, `gpu.geometries` | three.js live texture and geometry counts. WebGL hides their bytes. |
| `gpu.world_textures`, `gpu.sprite_textures`, `gpu.ui_prefix` | Upload-size estimates and counts of world textures, sprite textures and the GPU UI prefix's textures, meshes and buffers (within `gpu.textures`). |
| `render_targets.drawing_buffer` | Canvas width × height × 4: a lower bound; depth, multisampling and swap chain are not included. `render_targets.post` gives post-processing target sizes when bloom is on. |
| `audio.decoded` | Decoded PCM as 32-bit float per channel. |
| `js.heap` | Null here: read outside the page through DevTools. |

`unmeasured` names what the page cannot see (browser process memory, driver
allocations, browser image copies, compositor buffers), and `failures` counts
image load failures, sprite texture errors and Canvas UI images in error, so a
round trip that broke a displayed image shows up.

The report adds `scenario`: the file's SHA-256 and parsed definition, then per
run a `baseline`, `phases[].rounds[]` (duration, each step with the mark's page
time and `presented_after_input_ms`, the checkpoint's metrics as `end`, the
largest sampled values as `peak`, and the raw OS rows), `phases[].trend`, the
`settled` checkpoint and every raw sample in columns. `trend.end` and
`trend.peak` give, per metric over the measured rounds: first, last, min, max,
the maximum of each half, `second_half_not_higher`, the least-squares
`slope_per_round`, `rounds_increased` and `increased_every_round`.
`scenario.summary` puts each run's baseline, last round, phase peaks and settled
values through the same median and p95 as startup runs.

How to read it:

- Never add owner rows, heaps or processes: `within` and `overlaps` say which
  ones hold the same bytes, and processes share memory the OS counts in each.
- A round's peak is the largest value sampled every `sample_ms`, not a
  continuous high-water mark; only `peak_working_set_bytes` is one.
- `second_half_not_higher` is a fact about this window. A garbage-collected heap
  can rise across rounds and fall later without leaking, and a flat window does
  not prove nothing leaks. Owner counts (`entries`) that keep rising across
  rounds are what to investigate.
- `closed_images` and released bytes are logical releases, not memory the
  browser or OS took back; read the `os.*` rows for that.
- `presented_after_input_ms` includes DevTools input delivery and is measured
  on the page clock; it is a screen-change cost, not a frame-time measurement.

`tests/memory-roundtrip-project` is a four-screen fixture with image groups and
its scenario; its README shows the export and measure commands.

## Performance targets: when to optimise and where

The engine measures but cannot know what fast enough is for a game, so it never
judges a measurement on its own. A project states its targets in
`project.unone.json`; every one is optional:

```json
"performance": {
  "p95_frame_ms": 8,
  "startup_ms": 3000,
  "luau_heap_bytes": 67108864,
  "heap_growth_bytes_per_frame": 4096,
  "span_p95_ms": {"ai.pathfind": 1.5},
  "frames": 600,
  "input_sequence": "tests/inputs/battle.json"
}
```

`p95_frame_ms` covers the engine's own frame work (script, physics, observe);
host rendering comes on top, so leave it room inside the 16.667 ms fixed step.
`startup_ms` is the sum of the `performance.startup` phases, `span_p95_ms`
holds per-call targets for `api.profile.span` names. `frames` and
`input_sequence` choose the run `verify` measures, so it measures play rather
than an idle opening screen. New projects start with `p95_frame_ms`
16.667; zero, negative or non-finite targets are refused
(`PERFORMANCE_TARGET_INVALID`).

With targets declared, `game perf` (MCP `unone_perf`), `game run` (MCP
`unone_run`) and the `performance` gate of `game verify` warn for each one
missed: `PERF_FRAME_OVER_TARGET`, `PERF_STARTUP_OVER_TARGET`,
`PERF_SPAN_OVER_TARGET`, `PERF_HEAP_OVER_TARGET`,
`PERF_HEAP_GROWTH_OVER_TARGET`. Each names where to start: the frame phase
with the largest share and the game's costliest spans, the slowest startup
phase, or the spans that grew the heap most, with a suggested next step in
`suggested_actions`. A span target the measured run never recorded is
`PERF_SPAN_UNMEASURED` (a typo, or play that never reaches it). The verify gate
fails when a target is missed; declare it advisory in `verify.steps` to report
without failing.

Timings mean nothing in a debug build or over fewer than 60 frames, so then
only heap targets are compared, and `perf`/`verify` say why
(`PERF_TARGETS_DEBUG_BUILD`, `PERF_TARGETS_TOO_FEW_FRAMES`). Without any
targets, `perf`, and `run` over 60 frames or more, warn
`PERF_TARGETS_UNDECLARED` with the measured numbers to choose from, and the
verify gate is not applicable. `game test` never compares: its runs are short
and share the machine.

## Official production-player completion counters

The opt-in Web host trace separates `observation_view`, `observation_utf8` and
`observation_parse`, followed by `world_fields_restore`, `ui_tree_restore`,
`ui_images_restore`, `save_restore` and `publication_commit`. Each restore span
includes validation and any changed-generation decoding/freezing. These marks
are absent when profiling is off. A span named `jobs_dispatch` measures only
work since the preceding mark; it must not be interpreted as job execution.
Compare profiler-disabled runs for acceptance and use separate diagnostic runs
to locate a tail. A long restore span alone does not establish GC as its cause.
Changed leased fields additionally emit `world_field/<name>/utf8`, `/parse` and
`/freeze` spans. `world_field_publications` records each field's encoded bytes
and whether it changed; unchanged generations emit `/reuse` without reparsing.

With `?unone_profile=1`, the official production host also records one `wake`
event per admitted scheduler RAF in that same bounded profiler ring. The
default limit is 256 events across all kinds; `unone_profile_limit=16..2048`
selects another capacity. Inspect `data-player-profile` or the existing
`window.unonePlayerProfile.report()` accessor. Overwritten records remain
counted, so complete JSON alone does not establish continuous coverage.

| Wake attributes | Meaning |
|---|---|
| `raf_time_ms`, `wake_start_ms`, `wake_end_ms` | Original browser RAF token and the enclosing asynchronous wake body. The body endpoint is captured after preparation finalization but before `onRafEnd`, completion-feed publication and legacy wake observers. |
| `generation`, `generation_end`, `reset_before_wake`, `reset_during_wake` | Clock-generation identity and reset markers captured before observers. The first observed generation has `reset_before_wake=true`. |
| `elapsed_ms`, `acc_before_ms`, `acc_after_elapsed_ms`, `acc_after_ms`, `acc_current_ms` | Actual scheduler elapsed time and debt snapshots. `acc_after_ms` retains the old generation's last admitted/debited debt; `acc_current_ms` can differ after cancellation/reset. Negative debt is retained. |
| `step_ms`, `tolerance_ms`, `max_catch_up_steps`, `due`, `admitted`, `lost`, `actual_steps`, `attempted_steps`, `dropped_delta` | Existing policy and outcomes, without changing them. `actual_steps` counts successful awaited scheduler tick calls; a coalesced request is not necessarily a distinct Core update. |
| `paused`, `paused_end`, `cancelled`, event `status` and sanitized `error_code` | Body state and cancellation/failure classification. A paused UI redraw is distinct from a cancelled preparation. Read `status` when deciding whether a wake failed. |

The `wake` event's own `wall_ms` measures recording the observation, not the
wake body or Core CPU work. Its `wake_start_ms`/`wake_end_ms` attributes enclose
awaited update and draw work, overlap their existing spans and must not be
added to those timings. The endpoint deliberately excludes subsequent feed
and wake observers; their work can still delay the next RAF. A zero-step wake
can redraw an old snapshot, while a later catch-up wake can execute multiple
ticks before one draw. These records help distinguish those cases; they do
not change a freshness gate or establish physical scanout. Healthy wakes omit
`error_code`; genuine errors retain only their sanitized leading code.

Wake recording is off by default: no new diagnostic packet, end-clock read
or Core/worker request is made. The development `PROFILE_WAKE` hook remains
independent and keeps its historical endpoint after `onRafEnd`. A throwing
new diagnostic callback is fenced and counted by the scheduler's read-only
`wakeDiagnosticFailures`; it cannot skip the legacy hook or next RAF. The
main profiler consumer contains record/sink failures and attempts to set
`data-player-profile-error` without stopping the game. No simulation policy,
clock, tolerance, tick count or schedule order is changed. Active profiling
still adds observer work: validate production cadence separately.

The same opt-in host profiler records `ui_asset` events for Canvas image
acquisition and retirement. Event status is `ok`; read the `transition` attribute
(`acquire_ready`, `loading`, `ready`, `failed`, `release` or `stale_result`) for
the asset lifecycle. A ready broker hit attaches synchronously and is never
reported as a new loading interval. Existing draw rows include `ui_composition`,
`ui_loading_count` and bounded-diagnostic counters to link pending draws.

Entry tokens are unique within `ui_asset_trace_epoch`. Origin composition,
asset generation and UI observation frame remain separate from the current
composition, generation, last UI frame, `current_entry` and `current_required`.
An asynchronous completion does not identify the Core frame that completed it.
Asset strings are capped at 128 UTF-16 code units, with full length and explicit
truncation flags; a prefix is not a complete or unique ID.

Reference metadata is capped at 256 assets and transition events at 128 per
composition, with cumulative overflow/failure counters. `current_refs_known`
distinguishes a missing metadata row from known zero references. Ordinary-image
opacity and rectangle/clip counts are descriptive; shared references are
aggregated. Batch references count definition asset-list membership, and
`batch_visibility_tested=false`: no new per-quad visibility scan is performed.
Required references are not necessarily painted pixels. These diagnostics do
not change acquisition, loading, clipping, rendering or resource lifetime.

The internal observer is installed only when profiling is enabled. Disabled
execution creates no diagnostic Map, event attributes, packet or clock read.
Origin tags are weak and scalar-only; they retain no Game node or image alias.
Observer exceptions are isolated from original errors, readiness waiters and
render requests. Disposal disconnects the observer. This is host diagnostics,
not a new Game API, asset-preload policy or FPS acceptance result.

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
| `image_assets` | Official image-group holds/budgets, broker residency/reuse/eviction counts and bounded loading totals; null before the optional host accessor exists. Use `unonePlayerAssets.snapshot({includeTimings:true})` for at most 128 image-readiness records. See [image loading diagnostics](web-image-assets.md#loading-diagnostics). |

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
must be a boolean; unknown public query options fail explicitly.
`includeMemory:true` (also a boolean) adds `memory`: the player's memory owners
with how they overlap, described under
[memory over round trips](#memory-over-round-trips---scenario). Recording uses
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
