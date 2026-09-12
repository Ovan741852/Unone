# Lottie UI capability — proposed v1 contract

**Status: design-only request. Lottie is not supported by the current Unone
runtime, Web host, or native hosts.** This document is the engine/UI requirement
for a future implementation; none of the API names below are callable today.
Do not add a private Lottie player to a game or to YesSir while this contract is
unimplemented.

## Ownership and non-goals

Lottie playback is a reusable UI/asset-host primitive. Unone owns asset
registration, validation, lifecycle, timing, rendering-host integration and
diagnostics. Luau owns which settled game event selects an animation, event
dedupe/priority and any reward/economy rules. The player never credits gold,
reads a wallet, or decides a reward.

The first implementation is a transparent overlay component. It is not a
general vector-animation authoring tool, a network asset loader, or a
gameplay-effects system.

## Current evidence and fixtures

The current source tree has no `lottie` implementation or documented API. The
existing `ui.setRoot` contract accepts text, button, image and nested component
nodes only. The existing Web presentation code uses Spine/Effekseer; an
upstream `lottie-web` gallery is not runtime evidence.

The acceptance fixtures are in the private YesSir checkout at
`_Games/ashen-legion/design-v1/animations/`:

- `big-win.json`, `mega-win.json`, `legendary-win.json`, `coin-burst.json`
- Lottie JSON 5.13.0, 960×540, 30 fps, frames 0–120
- shape-only, outlined lettering, no images, fonts, expressions or network
- markers: `burst=0`, `coins_land=36`, `collect=65`, `complete=120`

The fixture inventory is input to tests; it is not a promise that every Lottie
feature is supported.

## Proposed asset declaration

An animation must be explicitly registered; hosts must not scan arbitrary JSON.
The field names follow the existing asset-manifest style and are proposed until
implemented:

```json
{
  "kind": "lottie",
  "id": "reward.big_win",
  "source": "animations/big-win.json",
  "format": "lottie-json",
  "mime": "application/json",
  "sha256": "<64 lowercase hex characters>",
  "decoder": "unone.lottie.v1"
}
```

`source` must remain inside the project/package. Export copies the exact bytes,
preserves the JSON MIME type, records the inventory hash, and never downloads
from a CDN. Unknown fields, duplicate IDs, path escape, malformed JSON or hash
mismatch are export/validation errors with a file path and remediation.

## v1 format subset

The decoder must reject unsupported input before playback and report the first
unsupported field/type. The initial subset is deliberately small and matches
the supplied fixtures:

- top-level `v`, `fr`, `ip`, `op`, `w`, `h`, `layers`, optional `markers`;
- 2D shape layers (`layers[].ty = 4`) with layer position, scale, rotation and
  opacity, including the normal Lottie scalar keyframe/interpolation form;
- path shapes (`sh`) with finite vertices/in/out tangents and closed paths;
- solid fills (`fl`) with RGBA and opacity;
- no expressions, text/fonts, raster/image assets, precomps, masks, mattes,
  effects, 3D layers, audio, scripts or network references.

The subset version is part of the capability result. Adding a feature requires
an explicit version bump or an additive capability entry; silently accepting a
new Lottie feature is not allowed.

## Proposed declarative UI node

This extends the semantic UI tree conceptually; it does not change the current
`api.ui.setRoot` API until implemented. Coordinates use the existing normalized
0–100 UI space.

```json
{
  "kind": "lottie",
  "id": "reward-overlay",
  "asset": "reward.big_win",
  "rect": { "x": 0, "y": 0, "w": 100, "h": 100 },
  "anchor": "center",
  "fit": "contain",
  "z": 100,
  "visible": true,
  "opacity": 1,
  "pointerEvents": "passthrough",
  "playback": {
    "mode": "once",
    "speed": 1,
    "start": { "marker": "burst" },
    "paused": false,
    "reducedMotionFrame": 65
  }
}
```

`fit` is currently `contain` only. `pointerEvents=passthrough` means the node
never consumes input; a future `opaque` mode must participate in the same UI
hit-test contract as other nodes. Visibility and opacity are presentation
properties and must not change event settlement.

## Proposed control and lifecycle API

The API must be exposed through the normal Unone UI bridge, with a stable
`instanceId` and monotonically increasing `generation` per node. Names are
proposal-level until the implementation lands:

```text
mount(node) -> { instanceId, generation }
play(instanceId, { mode?, speed? })
pause(instanceId) / resume(instanceId)
stop(instanceId) / restart(instanceId)
seekFrame(instanceId, frame)
seekMarker(instanceId, marker)
setSpeed(instanceId, speed)
setSource(instanceId, asset)
dispose(instanceId)
```

All commands validate finite values and return a structured error rather than
throwing through the game loop. `seekFrame` clamps to `[ip, op]`; seeking to
`op` renders the terminal frame but does **not** emit `complete`. Only a
natural `play` transition to the terminal frame emits one completion for that
generation. `restart` starts a new playback epoch and permits one new
completion. `setSource`, removal and `dispose` increment the generation and
invalidate queued callbacks, so an old animation cannot complete a replacement.

Lifecycle notifications use this shape:

```json
{
  "type": "ready|complete|error",
  "instanceId": "reward-overlay",
  "generation": 3,
  "frame": 65,
  "error": { "code": "UNONE_LOTTIE_UNSUPPORTED", "path": "layers[2]" }
}
```

`complete` includes `reason: "natural_end"`; errors include an actionable
`code`, JSON path and remediation. No callback is delivered after `dispose`.
Game pause is a host clock decision and pauses instances that opt into it.
Reduced-motion skips playback and renders the declared static frame while still
reporting readiness.

## Host, backend and diagnostics contract

The semantic contract is backend-neutral. A host must advertise the actual
renderer (`web-canvas`, `web-webgpu`, `native-wgpu`, etc.) and supported subset
in its capability probe. It must never label a DOM/SVG gallery as WebGPU
playback. If a backend cannot render the registered asset, the result is a
diagnostic error plus a deterministic static/hidden fallback chosen by the UI
policy; gameplay continues.

The future preview/export command must support a read-only smoke mode. UI
inspection must report, per instance:

```json
{
  "componentBounds": { "x": 0, "y": 0, "w": 100, "h": 100 },
  "clipped": false,
  "assetReady": true,
  "currentFrame": 40,
  "state": "playing|paused|stopped|error|disposed",
  "generation": 3,
  "backend": "<advertised backend>",
  "error": null
}
```

Diagnostics must distinguish “not measurable” from zero GPU/CPU time and must
include asset parse, upload and draw costs where the backend exposes them.

## Acceptance gates before calling it supported

The implementation is not supported until all gates have evidence tied to a
commit/version:

1. Load all four fixtures in Unone preview **and** an exported game without a
   CDN; capture non-empty frames 0, 15, 40, 80 and 110.
2. Exercise once/loop, frame/marker seek, pause/resume, stop/restart, speed,
   removal/disposal and source replacement.
3. Prove no stale completion or double-fire after seek, restart or source swap;
   prove game pause and reduced-motion behavior.
4. Feed corrupt, missing and unsupported JSON and verify actionable errors with
   gameplay still running; verify pointer passthrough.
5. Verify inspection output, resource release after remove/source swap, and the
   real backend capability report. A gallery-only upstream-player test does not
   satisfy any runtime gate.

Until these gates pass, YesSir may author and reference the fixtures but must
not ship a game-side Lottie renderer or claim Unone Lottie support.
