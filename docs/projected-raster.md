# Checked upper-left projected raster

`player.presentation.json` optionally selects a constructor policy:

```json
{"renderer_mode":"official","antialias":false,"bloom":false,"projected_raster":"upper_left_checked"}
```

Omission keeps the existing host raster path and antialias defaults. Explicit
`"host"` selects that path on official WebGL. Explicit declarations are rejected
for Native, WebGPU and custom renderers, including explicit host. Null, unknown
values and nonstrings are invalid. Relaunch with a new page/canvas after changing
the policy; restarting only the game does not replace the renderer/context.

Checked mode supports WebGL2 with requested **and effective** antialias false,
Bloom/AO off, normal depth and existing sRGB/no-tone output. It accepts only
`api.projected.setWorldVisible(false)`, including empty snapshots: the game must
set it in Game.start. The renderer never changes that flag for the game. A world
visible snapshot, another incoming render target, postprocessing override, or
enabling Bloom/AO fails explicitly. There is no fallback to host raster.

This is a geometric presentation capability for current opaque/cutout projected
batches. It keeps the 40-byte vertex format, indices, order, UV, clip Z/W, depth
test/write and material rules. The game still owns its projection and any
half-pixel adaptation; the engine does not implement an old game's TL rules.
UI, input projection and picking retain their usual direction and coordinates.

The pass reflects clip Y into an isolated single-sample RGBA8 target, stages
encoded RGB once and copies exact texels with reflected rows. Surviving fragments
write a separate alpha1 marker; clear alpha0 marks holes. Source alpha0 can still
survive a greater-equal cutoff0 test. Copy never repeats the source alpha test.
This is NoBlending only. Future framebuffer blending requires a separate design
for destination initialization, coverage and composition; it cannot silently
blend against the staging target's black clear or reuse alpha as both meanings.
Isolated depth does not provide world3D shared depth or every historical D3D state.

## Actual target validation

The constructor and each new physical-size/DPR/context generation execute a
bounded neutral GPU conformance profile through the production shader, target
and copy path. The current upper-left-v1 profile has 32 cases and 919 samples:
edges/rings, fractional/interior positions, both diagonals, order/winding,
scissor, perspective, depth, cutout and encoded/material samples. Its fixed
expected RGB/coverage comes from independent CPU math, never current GPU output.
RGB uses ±1; coverage markers are exact. The minimum physical footprint is8×8.

The test reads actual default framebuffer RGB and staging coverage. A shader,
readback, profile or comparison failure is named unsupported/failure. Passing
this finite profile is evidence for this target/configuration, not a proof for
arbitrary geometry or every driver. CLI preflight checks configuration eligibility
only; a successful export does not claim that the target GPU passed.

Validation runs at startup or generation changes, not every frame. Only the
current generation is cached; context restore and viewport/DPR changes require a
new check. Test GPU resources are private and do not change World, revisions,
input, RNG or clocks. Diagnostic pixels are cleared before the game draw. Failure
does not promise previous framebuffer contents or a World rollback.

## Lifecycle and visible diagnostics

`UNONE_PLAYER_READY` is emitted only after a legal game draw and a current actual
GPU validation. `raster.projected` in READY/ordinary renderer metrics includes:

- requested/declared policy, status, context_epoch, target_generation;
- physical_size, dpr, profile_version and fixed probe_hash;
- last_validation and bounded failure details.

Statuses include unchecked/checking/validated/lost/failed/disposed. An old
last_validation and an old READY message are historical diagnostics, not current
permission to draw. Loss revokes the current validation; restore publishes a new
unchecked epoch, then checks before rendering. A failed check never falls back.
Loss skips GPU work without changing the game's simulation scheduling policy.
The raw `isContextLost()` flag is checked before AA/profile queries and draw
resources, and again after external presentation hooks. It can precede the DOM
loss event. Repeated loss/restore notifications are idempotent; one loss creates
one new epoch after restore. Loss during conformance readback is reported as
lost, rather than treating invalid readback bytes as a target mismatch.

Checked startup also requires a completed game draw token for the current
epoch, target generation, physical size and DPR. Requested/skipped draws and old
render counts cannot satisfy this. The token is visible as
`raster.projected.completed_game_draw`; it is revoked on loss/invalidation.
After the final startup RAF, the player samples raw context availability and
commits READY synchronously. A loss while waiting for READY waits on renderer
events, then revalidates/redraws; it does not tick or reload the game.
The gate permits32 draw attempts and60,000ms cumulative context-lost waiting;
timeout/unstable presentation fails explicitly. These budgets do not bound
asset loading or guarantee overall startup time. Pagehide/failure cancels RAF,
timer and subscriptions; a renderer returned after cancellation is disposed.
Factory exceptions before a renderer is returned remain terminal. Ordinary
host/omitted/custom startup retains its existing presentation sequence.
Public `data-player-startup-presentation` and player metrics show gate phase,
attempts and wait budget. This is host diagnostics, not a game API.

The official player immediately publishes changes in `data-player-raster` and
`data-player-metrics`, plus `UNONE_RASTER_STATE` console info. This includes loss,
unchecked restore and disposal. It does not create a new game UI or game API.
Requested AA is reported separately from actual context antialias.

A separate common WebGL lifecycle helper restores public clearColor/alpha after
Three recreates its background object. It captures the intent at the loss event,
reapplies after Three's restore listener, and removes listeners on disposal. This
fix also applies to ordinary host raster and does not claim full GPU-state
recovery or support for changing clear intent while lost. All renderer-owned
targets/materials follow normal resize/invalidation/disposal rules.

Native rejects any projected_raster declaration both in CLI preflight and in
hash-verified package admission before runtime/window/GPU creation. Its raster
pipeline and single-sample policy are unchanged. Core, canonical Luau typings,
C ABI and WASM APIs do not gain a raster-policy field; it is host presentation.
