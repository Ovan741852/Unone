# Optional Jobs: implementation and acceptance

Implemented file-backed isolated Luau operations, periodic main-VM input/result
closures, auto/inline/capped Worker dispatch, a lazy compute pool, and joined
AI-readable source/handle/tick/cost traces. Native also exposes a `jobs` developer
request. Inline results remain unavailable until the next tick, matching workers.

The existing player work is integrated: optional simulation Worker, async ordered
host commands, independent RAF rendering, opted-in 3D interpolation, changed-batch
instance transfer/recycling, and a repeated-evidence budget checker. These are
engine primitives; no battle/search algorithm moved from Lua into Rust.

Validation: 220 core tests, 12 focused Job tests (included in the core count),
24 related JS tests, two native-tool tests and nine Web ABI tests passed.
Real browser runs compare all 30 tick digests across inline execution, main
simulation plus compute workers, and worker simulation plus compute workers.
The final digest also matches native CLI. The parallel fixture starts two compute
workers; the periodic fixture lazily needs only one. Both development and
production artifacts were exercised. Production has no developer ABI export.
The latest development Player was also operated through WebMCP: pause completed,
step advanced exactly two ticks, and `jobs` returned two live workers and per-job
source/dispatch records. The periodic fixture uses an actual `.luau` module and ordinary prepare/apply
closures, with finite counts and fresh inputs.

Lifecycle checks cover next-tick visibility, task errors, missing module sources,
callback failures, queue bounds, cancellation, input ownership, out-of-order
external completion, and releasing closure registry references with the runtime.
Focused presentation tests cover snapshot immutability and retiring buffers when
restarting into a project with different instance batches.

[Machine-readable evidence](2026-09-08-job-dispatch-evidence.json) includes exact
WASM/JS hashes, source hashes and raw browser Job traces. [Jobs contract](../jobs.md)
and [player/evidence tools](../player-workers.md) describe configuration and usage.
[Workshop priorities](2026-09-08-workshop-next.md) reviews the earlier scorecard.

No new FPS improvement is claimed. Job JSON transfer, fresh-VM compilation and
memory per Worker remain material costs. Full mobile sustained-load acceptance,
zero-copy Job transport, automatic experiment orchestration and complete browser
GC attribution are not proved by these tests.
