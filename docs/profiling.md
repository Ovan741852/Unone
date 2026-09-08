# Profiling for AI-directed optimization

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
