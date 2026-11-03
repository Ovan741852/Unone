# Reuse text raster pixels during placement-only translation

Status: implemented; source review and Node checks passed. Official browser
pixels, seven-scene FPS, memory and GC acceptance remain pending.

The GPU presenter used the entire serialized UI node in each text raster key.
That included absolute rectangle/clip placement, although the painter renders
into a local crop. Moving a label by an integer pixel therefore repainted and
uploaded identical local pixels. Actual presenter tests reproduced this for
both atlas and dedicated-text paths, after confirming that the submitted quad
really moved. A separate original test also exposed a DPR invalidation bug:
Canvas UI did not become dirty when scale changed but physical buffer width
and height stayed fixed.

The raster key now contains the actual styled, legacy and text-input painter
inputs, conservatively including the complete style, plus global font/color
identity, local crop offset and dimensions, rectangle size, viewport size and
scale. Absolute placement remains in the submitted quad and clip. Fractional
pixel phase, changed crop, wrap/ellipsis width, shadows, typography, editing
state and scale invalidate the raster. The Canvas target tracks scale as well
as physical dimensions. Global composition serialization/routing is unchanged.

This corrects a cache invalidation boundary; it adds no text layout system,
glyph renderer, game rule, new public API or memory policy. Existing atlas
packing, duplicate-ID occurrence slots, dedicated replacement and B resource
ownership remain intact. It does not establish how many of the Game's observed
rasters are placement-only or identify every long UI span.

Validation preserved the original 26 tests (23 pass, 3 expected RED failures),
then passed all 32 text cases after six additional clipped/shadow/legacy cases.
The focused combined gate passed 57/57. Root's full final Node gate passed
934, failed zero and skipped five (939 total). Root manual review and two
independent Codex reviews are CLEAR on UI SHA `28cd6f0e…` and Canvas SHA
`80eb627a…`; Canvas's final comment-only correction is separately preserved.
These use real presenters, painters, broker/Three objects and controlled
Canvas/GL boundaries, without actual browser glyph pixels or GPU execution.

The prescribed tool-free Claude Code 2.1.308 attempt captured the exact final
three postimages against `d7b4afc`, timed out after 45.332 seconds, exited 1 and
produced zero stdout/stderr bytes. It is incomplete, not a passed external
review. Exact sources, commands, raw RED/GREEN output, source reviews and limits
are indexed in [the source evidence](../evidence/2026-11-03-shared-ui/ui-text-raster-source.json).

Actual official Web main/worker and same-fixture pixel comparison must follow
the source commit. No Native, Core or Game binary changed. Windows Native
final execution remains blocked by App Control 4551 and is not counted passed.
