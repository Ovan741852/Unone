# Legion Fall optimization — 2026-09-08

The measured exported-WASM CPU cost fell from **22.65 to 16.47 ms per tick (27.3% lower; 1.38× throughput)**. This is not a browser FPS result. The existing demo recording predates these changes.

## Tools first

Development Web and native hosts now expose bounded start/read/stop profiling windows and automatic Luau stack sampling. Functions report source, definition line, self samples and inclusive samples without modifying game functions. Profile and tool discovery no longer serialize the whole world. Web windows separately measure input, WASM tick/publication, JSON decoding and renderer CPU work. Native host phase windows remain unavailable.

Baseline sampling identified `update`, `pack`, `acquire`, `publish` and grid construction as candidates. Sampling is approximate and perturbs execution: observed sampled runs cost roughly 5–10% more in these experiments. Performance comparisons below disable sampling.

## Changes retained

| Change | Controlled CPU comparison | Scope |
|---|---:|---|
| Local aliases for immutable Luau builtins | 22.41 → 20.63 ms, −7.9% | Game Luau; same combat behavior |
| Sandbox standard libraries, enable Luau safe-environment fast paths | 21.13 → 17.72 ms, −16.1% | Reusable VM configuration |
| Serialize canonical observation once | 19.02 → 17.89 ms, −5.9% | Reusable publication path; modest/noisy result |
| Read packed instances directly from WASM memory | 17.41 → 16.09 ms, −7.6% | Same artifact, JSON versus memory mode |

These are separate experiments with different baselines and runtime noise. **Do not add their percentages.** The final alternating baseline/candidate comparison gives the overall 27.3% reduction.

The memory transport reduced median response size from about **542 KB to 4 KB** and mean JSON decode cost from **1.58 to 0.18 ms**. Rust retains a contiguous validated allocation; JS reads it directly and skips Base64 decoding. Unchanged batch revisions also avoid regenerating GPU matrices. Node measurements exclude that renderer benefit.

This is not end-to-end zero-copy: Lua buffers still undergo validation/copying; canonical snapshots still retain and encode Base64; changed batches still require matrix conversion and GPU upload. Ten thousand records add approximately 400 KB of packed storage alongside the canonical representation.

Standard library tables are now immutable. Games that monkeypatch `math`, `buffer` or other builtins must use their own helper tables. Game globals remain writable; existing deterministic guards remain enforced. Combat, movement, targeting and damage stay in Luau.

Speculative packing/grid reuse and targeting arithmetic changes did not show a reliable gain and were reverted. Target acquisition remains a useful next candidate; no targeting rule was moved into engine Rust.

## Method and evidence

Windows, Ryzen 9 9900X; release development WASM; actual exported host payload; 10,000 initial units; seed 42; empty input; 30 warmup ticks then 180 measured ticks. Three fresh-process pairs alternate AB/BA order. Reported overall cost is the median of each run's mean tick/publication plus JSON decode time. All recorded observation-digest checkpoints match. Rendering, GPU execution, browser scheduling and video capture are excluded.

Overall pairs in ms: 22.53 → 16.47, 22.65 → 16.93, 23.76 → 15.97. Raw samples, artifact hashes, environment and checkpoints are retained in [overall evidence](evidence/2026-09-08-legion-optimization/legion-total-comparison.json) and [same-artifact transport evidence](evidence/2026-09-08-legion-optimization/legion-transport-comparison.json). Incremental comparisons and function samples are in the [evidence directory](evidence/2026-09-08-legion-optimization).

Actual artifact verification forced WASM memory growth and confirmed all 19 instance batches matched canonical decoded bytes and digest. In the browser, switching JSON → memory while paused at frame 617 preserved the frame and produced identical screenshot PNG data (1,094 × 720 capture; 1,934 × 1,272 drawing buffer). Both renderer paths displayed 9,481 surviving units. The human Profile panel also displayed automatic samples. A paused FPS counter was misleading and now explicitly shows paused state.

Rust workspace tests passed, including profiling windows, replay invariance and bridge allocation lifetime tests. Eight focused JS tests passed for lightweight API requests, input validation, memory growth/bounds, revision-based GPU updates and bounded profile windows. Release development and production builds passed the real exported host-payload CLI/WASM parity gate. Production export contains no developer panel or profile-window asset; this game's uncompressed export totals 2,913,402 bytes. That size is neither compressed transfer size nor a startup-time measurement.

These checks do not prove universal determinism, native crowd visual parity, Android performance, or a particular interactive FPS. Cross-host acceptance still requires the actual target host and scenario.

## Reproduce and extend

Use the commands in [profiling](profiling.md) with retained baseline/candidate development exports. For transport alone, use one export on both sides and pass `--before-transport json --after-transport memory` to `scripts/compare-player.mjs`. The runner rejects checkpoint mismatches.

The [memory transport contract](instance-memory-transport.md) is implemented. The separate [game-owned WASM compute contract](proposals/wasm-compute-v1.md) is a proposal for future extensions, not a shipped module loader or callable Luau API.
