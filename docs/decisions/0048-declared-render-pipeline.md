# Decision 0048: Declared, adjustable and extensible render pipeline

- Date: 2026-10-30
- Status: implemented on the official Web player (2026-10-30); native wgpu rejects declared pipelines until it executes them. Guide: [render pipeline](../render-pipeline.md)
- Scope: official Web and native renderers, presentation config, Engine API

## Problem

Both official renderers hard-code their pass order, and they differ:

- **Web** (`web/renderer/three.js` `draw`): one Three scene, an optional Bloom
  chain with SSAO and tone mapping (host options only), then projected
  geometry, then the Canvas UI.
- **Native** (`crates/unone-native-player/src/render.rs` `draw`): a world pass,
  a separate depthless sprite overlay, a fixed-parameter Bloom, projected
  geometry after the composite, then the UI quad.

A game can switch Bloom on or off and nothing else. It cannot reorder, tune or
add a pass, and it cannot change one at runtime. Its only extension point is
replacing the whole Web renderer (`renderer_mode: custom`). Parameters also
differ silently between hosts: Bloom thresholds, particles in 2D, sprites in
3D, and when projected depth is cleared.

## Decision

A render pipeline is an ordered list of named passes that the project declares
and both hosts execute.

1. **Declaration.** `project.unone.json` gains `render_pipeline`:
   `{"version":1,"passes":[{"id","kind","enabled"?,"params"?}]}`. It lives in the
   project rather than in presentation config so the engine validates it,
   serves `api.render` and publishes it in the snapshot. Pass kinds in v1 are
   the ones the hosts already draw as units: `scene` (the whole world scene),
   `ao` (`strength`), `bloom` (`threshold`, `strength`), `tonemap` (`mode`,
   `exposure`), `projected` and `ui`. Splitting `scene` into world, sprites and
   particles is left for a later version. Without a declaration each host keeps
   its current order, so existing games render unchanged.
2. **One validator.** A Rust DTO and generated schema define kinds and
   parameter ranges. Each host advertises the kinds it implements, and
   `game project preflight` and export reject a pipeline the selected host
   cannot execute. Native starts without `ao`, until it gains one.
3. **Runtime adjustment.** `api.render.setPass(id, {enabled=?, ...params})`
   changes a declared pass's switch and parameters. The value is engine state:
   it is published in the snapshot only once changed, so replays and both
   hosts see the same pipeline. Order and membership stay declared, so hosts
   never rebuild targets mid-frame.
4. **Extension.** A pass kind is a module in a per-host registry.
   - **Web:** `render_extensions: [{"kind":"studio.vignette","module":"ext/vignette.js"}]`.
     The module may be compiled from TypeScript by the project's own build. It
     registers `{setup, draw, resize, dispose}` and receives `THREE`, the
     renderer, input and output targets, and the pass params.
   - **Native:** passes are Rust implementations of the same contract,
     compiled into the native player.
   - A pipeline that uses a Web-only extension cannot export natively until a
     native pass exists.
   - `renderer_mode: custom` remains the whole-renderer replacement.

## Alternatives

- **A full render graph** with declared resources and dependencies. It is
  more general, but no current game needs arbitrary graphs. Keep `version`
  so a v2 can add one.
- **More presentation booleans.** This is the status quo. It cannot express
  order, parameters or extensions, and it already drifts between hosts.
- **Passes written in game Luau.** These would run per frame in the
  simulation VM. That costs simulation time, breaks the snapshot boundary,
  and cannot touch GPU resources.

## Implementation order

1. The DTO, schema and validator, plus default pipelines that reproduce each
   host's current order. This step adds pipeline tests and causes no visual
   change.
2. Web: split `three.js` `draw` into registered passes over the existing code
   (scene, Bloom, SSAO, tone mapping, projected, UI), then add
   `render_extensions`.
3. Native: split `render.rs` `draw` the same way, and give Bloom its params.
4. `api.render.setPass`, published in the snapshot.
5. Parity: render one pipeline in the native capture and in a Web screenshot,
   and compare.

## Open questions

- Should `sprites` in 3D join the world depth (Web today) or overlay it
  (native today)? The declared order would make the choice explicit;
  defaulting each host to its current behavior preserves existing games.
- Should a pass be able to write an offscreen target that a later pass reads
  (for example a mini-map)? That is the first step towards a v2 render graph.
