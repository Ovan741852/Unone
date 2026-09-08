# Optional async player and performance evidence

`player.presentation.json` selects `runtime_backend: "main" | "worker"`. The
exported main-thread player and simulation Worker use the same command adapter.
Input, pause/step, project restart, save data and development commands pass through
an ordered bounded queue. RAF rendering stays separate from async simulation;
only one simulation tick runs at a time. Hidden/pause time is not simulated later.
A simulation Worker is distinct from the optional compute Worker pool for Jobs.
Production strips the developer panel/ABI; Job execution is runtime functionality.

`interpolation: true` opts into presentation-only 3D transform interpolation.
Packed batches require explicit `interpolate_instances: ["batch_id"]` and stable
row identity/order. Count/asset changes snap. No extrapolation or simulation/hash
changes occur. Interpolation deliberately adds a publication interval of visual
latency and incurs CPU/GPU upload work; leave it off unless measurements justify
it. Camera, animation and 2D interpolation are not implemented here.

Worker instance publication copies only changed batch revisions, transfers buffers
and recycles replaced ones. Pool cap: 32 buffers / 16 MiB. World JSON still crosses
the boundary; this does not eliminate canonical serialization or all transfer cost.

## Repeatable performance gates

`node scripts/verify-performance-budget.mjs baseline.json candidate.json budgets.json report.json`

Evidence format: `version: 1`, `case` with project, seed, profile (`release`),
device, viewport and simulation_hz, and at least three `runs`. Each run contains
`ticks`, the canonical `digest` (`sha256:...`) and numeric `metrics`. Name metrics
explicitly, e.g. `host_tick_elapsed_p95_ms`, not ambiguous CPU/FPS claims.
Budgets are an array of `{metric, direction: "lower" | "higher",
max_regression_percent, absolute_limit?}`. The tool rejects missing measurements,
case mismatches and changed end-tick digests; it reports medians and run ranges.
It does not claim statistical significance. Browser render cadence is not proven
display FPS. An async tick span includes queue/barrier waiting; use executor traces
for attribution. Unsupported JS GC or allocation measurements must remain missing,
not fabricated zeros. This tool compares captured evidence; it is not yet a full
automated device-farm capture pipeline.
