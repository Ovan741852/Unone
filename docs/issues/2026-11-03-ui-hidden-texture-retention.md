# Hidden GPU UI runs retained retired texture sources

Status: ownership correction implemented; negative control, focused Node checks,
full Node suite and bounded independent source review passed. Actual browser/GPU,
GC and FPS acceptance have not been run for this slice. No new ADR is required
for this ordinary resource-ownership bug fix.

The exact source hashes, commands where captured, preserved raw logs and source
snapshots are indexed in
[ui-hidden-texture-retention.json](../evidence/2026-11-03-shared-ui/ui-hidden-texture-retention.json).

## Defect and correction

The official Web GPU UI presenter reuses instanced runs. When a composition
shrunk, it hid unused meshes but left their material sampler uniforms pointing
at the previous textures. Dedicated text and image retirement disposed those
textures and removed their cache-map entries, but the hidden runs still retained
the Texture objects and their CPU canvas/image sources. The same sampler
references were observable during texture disposal in clear/context-loss/dispose.
This is a concrete engine-held strong-reference path. It does not by itself
establish retained driver allocations, unbounded growth, a GC cause or an FPS
regression.

`web/renderer/ui-gpu.js` now tracks which runs bind each texture. Retirement
detaches those borrowers before disposing the texture; unused runs bind the
presenter's shared white texture. The reverse index visits the actual borrowers
instead of scanning every run for every retired texture. Geometry and material
capacity remain reusable. Active A/B/A borrowers preserve the still-live A
texture while the hidden borrower releases its reference.

A dedicated text replacement finishes its new raster before retiring its prior
bitmap. A painter exception therefore preserves the preceding complete sampler
and texture. This is a bounded first-raster failure guarantee, not a new promise
of transactional rollback for arbitrary later GPU/allocation/disposal failures.

Atlas pages retain their existing cache lifetime. Hiding text detaches its run
without evicting a valid atlas page; context loss and final cleanup retire the
page through the same ownership boundary. Text raster keys, clipping, painter
order, renderer selection and cache budgets are unchanged. Image pixels remain
separately owned by the decoded-image broker: this fix never calls `image.close`
or forces collection.

## Executed validation

| Check | Actual result | Scope |
|---|---|---|
| Original-module negative control | 7 total: 1 pass, 6 fail | Actual presenter and pinned Three objects; recorded before production edits |
| Final focused checks | 33 passed, 0 failed/skipped | 9 ownership regressions plus 24 Canvas/publication/style checks |
| Full regenerated Node suite | 861 total: 856 passed, 0 failed, 5 skipped | Includes the then-untracked new ownership test explicitly |
| Diff check | Passed | Scoped patch formatting |
| Independent source review | CLEAR; no concrete P1/P2 found | Read-only review, separate from test execution |

The focused cases cover shrinking and empty compositions; active and shared
A/B/A texture owners; next reuse of the same geometry/materials; ordinary atlas
retention and recreation; failed dedicated raster replacement; and detachment
before physical texture disposal during clear, context loss and disposal.
Real broker leases remain ready during GPU texture retirement, and no broker
image is closed by the presenter.

The tests use the actual `createGpuUi` module, actual pinned Three CPU-side
textures/materials/geometry, and the real decoded-image broker. Renderer, canvas
and raster boundaries are controlled Node test doubles. They prove source-level
ownership and lifecycle behavior, not browser pixels or hardware GPU execution.

Root's manual diff review and the independent child source review are CLEAR.
The bounded, tool-free Claude Code 2.1.308 attempt supplied a fixed diff and three
postimages (implementation, test and the original issue) against
`848f45a6dee8412f116e4130a8eda7238a00c124`. It timed out after 45.3445649 seconds,
exited 1 and produced zero stdout/stderr bytes. Its status is
**timed-out-incomplete**: no external review disposition was obtained, and this
attempt is neither a pass nor a waiver. The six original attempt files and the
preceding issue/evidence/index versions are preserved byte-for-byte in the
evidence directory. The attempt's issue hash describes that original issue,
before this status-only documentation update; implementation/test hashes remain
unchanged.

Actual browser/GPU rendering, natural or forced GC, process/native-memory behavior
and FPS acceptance remain outside the executed checks above. No Game, Core,
runtime binary or text-raster-key change belongs to this fix.
