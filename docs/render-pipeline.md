# Render pipeline

A game can declare the passes the official renderer runs, in order, and tune
them while it plays. Without a declaration nothing changes: each host keeps its
built-in passes and presentation `bloom` still works.

```json
"render_pipeline": {
  "version": 1,
  "passes": [
    {"id": "world", "kind": "scene"},
    {"id": "glow",  "kind": "bloom",   "params": {"threshold": 0.6, "strength": 1.2}},
    {"id": "tone",  "kind": "tonemap", "params": {"mode": "aces", "exposure": 1.0}},
    {"id": "tint",  "kind": "studio.tint", "params": {"amount": 0}},
    {"id": "hud",   "kind": "ui"}
  ]
}
```

```luau
api.render.setPass("glow", {enabled = false})
api.render.setPass("tint", {params = {amount = 0.6}})
local tone = api.render.getPass("tone")
```

The declaration lives in `project.unone.json`, so the engine validates it
when the project loads and every host and replay sees the same pipeline. The
current state, including every `setPass`, is published in the snapshot as
`render_pipeline`.

## Passes

| Kind | Params (default) | What it does |
|---|---|---|
| `scene` | none | The world: sprites, meshes, instances, heightfields, particles. Required and first; disabled clears instead. |
| `ao` | `strength` [0,4] (1.7) | Depth-based ambient occlusion. |
| `bloom` | `threshold` [0,16] (0.55), `strength` [0,4] (0.75) | Quarter-resolution bloom. |
| `tonemap` | `mode` `"aces"`/`"none"` ("none"), `exposure` (0,8] (1) | Exposure and tone curve before sRGB output. |
| *namespaced*, e.g. `studio.tint` | up to 16 scalar params | A host extension pass (below). |
| `projected` | none | Projected geometry. Disabled skips it. |
| `ui` | none | The UI. Disabled draws none; input still routes. |

Order is fixed by stage: `scene`, then `ao`, `bloom`, `tonemap`, then
extensions, then `projected`, then `ui`. A built-in kind appears at most once;
any pass may be omitted except `scene`. `setPass` changes `enabled` and merges
`params`; it cannot add, remove or reorder passes. An invalid change fails
(`RENDER_PIPELINE_INVALID`, `RENDER_PASS_UNKNOWN`) and leaves the pass as it was.

## Extension passes (Web)

An extension kind is a JavaScript module the official Web renderer loads,
declared in `player.presentation.json`:

```json
"render_extensions": [{"kind": "studio.tint", "module": "render/tint.js", "files": []}]
```

The module exports `createPass`, called once per declared pass id. `draw`
runs every frame the pass is enabled, after the built-in post passes:

```js
export function createPass({THREE, renderer, id, params}) {
  const material = new THREE.ShaderMaterial({/* ... #include <colorspace_fragment> */});
  return {
    draw({input, output, params, width, height, fullscreen}) {
      material.uniforms.image.value = input;          // previous result (linear)
      fullscreen(material, output);                    // output is null for the last pass
    },
    dispose() { material.dispose(); },
  };
}
```

`input` is the previous result as a texture and `output` the next target, or
`null` (the screen) for the last pass, so end the shader with
`#include <colorspace_fragment>`. Write the module in TypeScript if you like and
compile it with your own build; export copies `module` and `files` into the
player. Kinds must be namespaced and not built in. A custom renderer
(`renderer_mode: custom`) cannot use extensions, since it owns its passes.

## Hosts

- **Official Web player:** runs every kind above on WebGL.
- **Native wgpu player:** runs `scene`, `bloom`, `tonemap`, `projected` and
  `ui`, with the same parameters and formulas. Bloom uses the same threshold
  window and strength; the tone curves are ported from three.js (ACES with
  `exposure / 0.6`, and linear). It builds the post chain the first time a
  declared bloom or tonemap pass is enabled. It rejects `ao` and extension
  kinds (`NATIVE_RENDER_PASS_UNSUPPORTED`) and `render_extensions`
  (`HOST_RENDER_EXTENSIONS_UNSUPPORTED`) instead of drawing them differently.
- **Known difference:** native renders the scene into an 8-bit target, so tone
  mapping sees values clamped at 1, while Web keeps half-float HDR.

The hosts already shade some content differently, primitive meshes for
example, so their pixels are not identical. A pipeline change moves both the
same way. On `tests/render-pipeline-native` (2026-10-31), turning bloom off
scaled average brightness by 0.82 on Web (Chromium) and 0.75 on native
(RTX 5080). Exposure 0.4 with stronger bloom scaled it by 0.85 and 0.76.

Design and alternatives: ADR 0048, `docs/decisions/0048-declared-render-pipeline.md` in the source repository.

Checked by:

- `crates/unone-engine/tests/render_pipeline.rs`: declaration, `setPass` and the
  snapshot;
- `web/renderer/render-pipeline.test.mjs`: post chain parameters and the
  extension chain;
- the `tests/render-pipeline-project` fixture, whose exported Web player
  measurably changed bloom, an extension's tint and tone exposure at runtime in
  Chromium.
- the native player's pass gate test, plus `tests/render-pipeline-native`,
  captured in the native player and in Chromium (numbers above).
