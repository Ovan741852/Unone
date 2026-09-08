# AI profiler additions: validation, 2026-09-08

The new counters answer what the VM actually allocated and how much incremental
GC ran during each script update. Host traces connect RAF/watchdog wakes to
ticks, publication/decode, audio/save and rendering. They do not automatically
diagnose the bottleneck or claim browser-wide GC visibility.

## Evidence

- [Alternating measurement-window on/off experiment](evidence/2026-09-08-profiler-tools/overhead.json):
  same release development WASM and exported Legion Fall payload; seed 42, 30
  warmup ticks, 180 measured ticks, three fresh-process pairs, sampling off.
  Every-tick digest checkpoints match in all pairs. These are Node CPU probes,
  excluding renderer and browser pacing; ordinary battle deaths remain enabled.
- Median run mean: window off **8.536 ms/tick**, on **8.460 ms/tick**. Per-pair
  apparent reductions were **+2.65%, +4.38%, -5.49%**. Mixed signs and variation
  do not establish a speedup, zero overhead, or a fixed overhead percentage.
  Use unprofiled comparisons for optimization claims; profile separately for
  attribution. Existing passive runtime timers remain enabled in both conditions.
- First profiled run: **23,705,818 allocation-growth bytes**, **272,823 positive
  growth requests**, **14,116 incremental GC steps**, **17.930 ms** total GC and
  **0.424 ms** maximum GC step over 180 ticks. These are Luau callback measurements,
  not heap delta. Object sizes and timing depend on the host.
- [Actual browser API validation](evidence/2026-09-08-profiler-tools/browser-summary.json):
  76.855 seconds, 4,611 matching core/VM/host ticks. All retained host ticks matched
  VM frames, all retained render spans had enclosing wakes, and stopped VM/host
  reports stayed frozen. This validates trace plumbing with normal deaths, not
  a constant-population performance claim.

## Checks

- Engine unit suite: 208 passed, two ignored. Allocation churn, incremental GC,
  callback restoration, nested VM scopes, Lua errors, sampler coexistence,
  unchanged observation digest, stop/freeze and restart are covered.
- Node scheduler/profile-window/developer API tests: 15 passed. Covers RAF and
  watchdog ownership, multi-tick wakes, error-before-freeze ordering, bounded
  trace storage, reset/freeze, dropped counters and request validation.
- `cargo check --workspace` passed, including native/mobile consumers of the
  shared runtime. This is not an Android device performance measurement.
- Development and production release WASM builds passed the actual exported
  selected-project parity gate (one tick for this fixture). The longer 180-tick
  all-checkpoint comparison above specifically checks profiling behavior parity.
  Neither alone is a complete cross-platform game regression suite.
- The player parity runner now also parses the actual WASM export table and
  checks shipped tool directories against the requested variant. Both variants
  passed. Production has no developer request ABI or host profiler module;
  this fixture's production WASM is 1,507,133 bytes before HTTP compression.

The feature-selected release build still prints pre-existing unused-system
warnings. Source and artifact hashes in the evidence identify the measured dirty
checkout; the final change also adds safety documentation to the scoped hook
constructor without changing its emitted measurement algorithm.

## Remaining limits

No full Luau GC, JS GC pause, Rust allocation throughput, per-function allocation
attribution or verified screen presentation telemetry. Unsupported values are
null with capability flags. Supported short GC steps can round to zero at the
host clock resolution. Native has the shared VM metrics but no RAF timeline.
Whole-page tasks between our callbacks need a browser tracing backend; do not
attribute those gaps from this API alone. Timeline and profile reads allocate
diagnostic JSON, so poll sparingly and retain stopped reports for analysis.
