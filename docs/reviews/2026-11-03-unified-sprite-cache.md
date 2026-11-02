# Unified ordinary-sprite GPU cache: ownership and validation

Commit `08c4f51529b63681a6a29d245139d6d77d8865fd` makes the official
three-webgl renderer's texture-cache policy apply to ordinary sprites using the
sprite resource pool as well as legacy world texture records. This is a reusable
presentation lifetime correction, not a Game resource rule, renderer replacement,
Core API change or budget increase. The contract is in
[ADR 0052](../decisions/0052-unified-sprite-texture-cache.md),
[texture-cache.md](../texture-cache.md) and
[sprite-resources.md](../sprite-resources.md).

The scoped source pins, raw test/review records, artifact identities and actual
browser endpoints are in
[sprite-auto-cache-validation.json](../evidence/2026-11-03-shared-ui/sprite-auto-cache-validation.json).

## Defect and ownership correction

Ordinary scene sprites were routed through the sprite pool, but the existing
idle policy governed only legacy texture records. Hiding a warmed ordinary
sprite released the last automatic lease and immediately retired its GPU
resource. The decoded-image broker could remain warm while every re-show still
repeated GPU preparation and produced a pending frame.

One controller now tracks registered physical world texture owners across both
paths. Its omitted policy is 64 MiB, 128 entries and 1800 renderer frames. Ready
ordinary resources can retain an explicit idle cache owner. Managed activity
cannot grant or refresh that automatic permission, and a managed-only resource
still retires on final release. Shared material variants count their physical
texture once; idle material entries also have a TTL and a separate
`min(texture_cache.max_entries, 4096)` bound.

The existing sprite-pool hard admission check remains independent. It counts
active, incoming and reserved unique textures; the player currently derives its
limits from the image preload plan budget. It may reclaim eligible pool idle
owners through the same controller before rejecting admission, but cannot evict
live owners or raise the limit. Decoded broker residency and UI/Bloom/render
targets remain separately owned and reported.

Independent source review found a concrete retirement-reentrancy defect during
implementation: after an owner was untracked, a `material.dispose` callback could
reacquire the same asset and rejoin that untracked owner. The final retiring fence
rejects this reentry while cleanup finishes, with a direct regression. The final
bounded Codex review found no remaining concrete P1/P2 across controller, pool,
presenter and Three integration. It covered pending old-appearance use, automatic
TTL versus managed ownership, hard admission, context/reset/dispose and late
generation fences. This source disposition is separate from execution results.

## Executed checks

| Scope | Actual result | Limit |
|---|---|---|
| Old routing negative control | Both targeted tests fail | Demonstrates immediate retirement and pending re-show; not a GPU timing run |
| Focused Node suite | 86 passed, 0 failed/skipped | Includes instrumented renderer calls and real broker/presenter ownership; not hardware GPU proof |
| Full Node suite | 852 total: 847 passed, 0 failed, 5 skipped | Preserves skipped cases; not all-target acceptance |
| Source-refresh tool | 22 passed, 0 failed/skipped | Includes actual production WASM load/module/data validation; not browser rendering |
| Old official main fixture | Material-entry builds 202; texture builds 101; world-pending skips 101 | One decoded image load; final GPU pool already retired |
| New official main fixture | Material-entry builds 2; texture builds 1; world-pending skips 1 | 100-cycle bounded ownership acceptance |
| New official worker fixture | Same 2 / 1 / 1 totals | Actual backend reports worker; bounded ownership acceptance |

Root ran the official-player fixture with two ordinary sprites sharing the same
8×4 PNG and using two different shader source definitions, with Bloom enabled.
There are no managed `prepare/commit` calls or fabricated host receipts. After
60 warmup ticks it performs 100 repetitions of three hidden and six visible
ticks, then remains hidden for 120 ticks. The authored protocol completes at
tick 1080 with hide 101, show 100 and zero failures. Its displayed PASS describes
that protocol; independent host metrics establish GPU resource reuse/retirement.

The old endpoint is observer frame 4299. The new main in-cycle endpoint at frame
862 shows one shared 128-byte GPU texture and two cached material entries, with
only the initial pending skip. New main frame 3851 and worker frame 3428 both show
final pool/cache entries, handles, image leases, pending work and reservations
at zero, with two material entries and one texture retired. The earlier worker
file named `mid` is already post-protocol at frame 2635; it is not presented as an
in-cycle measurement. The new endpoints have no error and all other skip reasons
are zero.

Both new runs keep one intentional 128-byte **decoded scene pin** in the broker,
with one load and no active image lease after GPU expiry. This is compatible with
zero world GPU owners. UI/Bloom allocations are outside that zero-owner scope.
The endpoint's frame text and cached performance frame differ; the record does
not pretend these are exact same-row Core/render samples or a per-cycle trace.
`builds` counts ready material entries and `texture_builds` counts engine texture
initialization; neither independently counts driver compiler calls or native
allocations. The before/after export inventories preserve the same flat content
and runtime hashes, including the same PNG and production Core; this record does
not independently rehash every served asset byte.

## External review and remaining limits

The prescribed read-only, tool-free Claude Code 2.1.308 attempt supplied a fixed
diff and three production postimages plus the two contract documents. It timed
out after **45.3024969 seconds**, exited 1 and produced zero stdout/stderr. It is
**incomplete, not a passed external review**; Three integration was outside that
attempt. Its command, source hashes, fixed diff, prompt and empty outputs are
preserved with the evidence. No retry or completed-review claim is substituted.

The actual refreshed host has fingerprint
`7e812c342835e1405d531796fc8c037470183c398ea5efc66dec8548f33fa5b7`
over 111 files and reuses production WASM
`869d9cca6968cca564e3a057960f98a7c4dbb6c7189f065f38fa84429dfa4efd`.
This is an official source-refresh artifact, not a newly delivered complete SDK.
Local Windows Native/CLI execution remains App-Control 4551-blocked; this task
does not retry or bypass it. Native GPU behavior is unexecuted here.

At the parent-reported CI snapshot, ordinary CI
[41523565961](https://github.com/Ovan741852/Unone/actions/runs/41523565961)
has passing Web and excluded-player jobs but failing Clippy and rustfmt checks.
Official runtime CI
[41523566008](https://github.com/Ovan741852/Unone/actions/runs/41523566008)
has passed Core ownership tests, with baseline/candidate jobs still running at
that snapshot. This record does not label that entire CI run passed. The earlier
checkout-only run's actual five-variant success remains separately recorded in
[ci-checkout-scope.json](../evidence/2026-11-03-shared-ui/ci-checkout-scope.json).

The successful fixture establishes bounded ordinary resource reuse and eventual
logical GPU retirement in main and worker hosts. It does not establish the
Game's seven-scene FPS acceptance, absence of GC, process leak freedom, total
VRAM/RSS bounds, arbitrary workload behavior, or hardware GPU completion/OS
scanout. No browser, test, Core, Native or Cargo workload was run while writing
this record.
