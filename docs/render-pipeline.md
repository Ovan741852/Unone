# Render pipeline

A game can declare the passes the official renderer runs, in order, and tune
them while it plays. Without a declaration nothing changes: each host keeps its
built-in passes and presentation `bloom` still works.

```json
"render_pipeline": {
  "version": 1,
  "passes": [
    {"id": "world", "kind": "scene"},
    {"id": "ao",    "kind": "ao"},
    {"id": "haze",  "kind": "fog",     "params": {"mode": "exp2", "color": "#9aa8b8", "density": 0.03}},
    {"id": "glow",  "kind": "bloom",   "params": {"threshold": 0.6, "strength": 1.2}},
    {"id": "tone",  "kind": "tonemap", "params": {"mode": "aces", "exposure": 1.0}},
    {"id": "look",  "kind": "grade",   "params": {"saturation": 1.1, "contrast": 1.05}},
    {"id": "hurt",  "kind": "vignette", "enabled": false, "params": {"color": "#600000"}},
    {"id": "aa",    "kind": "fxaa"},
    {"id": "tint",  "kind": "studio.tint", "params": {"amount": 0}},
    {"id": "hud",   "kind": "ui"}
  ]
}
```

```luau
api.render.setPass("glow", {enabled = false})
api.render.setPass("hurt", {enabled = true, params = {strength = 0.8}})
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
| `fog` | `mode` `"exp2"`/`"linear"` ("exp2"), `color` `"#rrggbb"` ("#c8d0dc"), `density` [0,10] (0.02), `start` [0,1e6] (0), `end` > start (100) | Fog by view depth. exp2: `1 - exp(-(density * max(depth - start, 0))^2)`; linear: 0 at `start` to 1 at `end`. Pixels with no geometry (the background) stay clear. |
| `bloom` | `threshold` [0,16] (0.55), `strength` [0,4] (0.75) | Quarter-resolution bloom. |
| `tonemap` | `mode` `"aces"`/`"none"` ("none"), `exposure` (0,8] (1) | Exposure and tone curve before sRGB output. |
| `grade` | `saturation`, `contrast`, `brightness` [0,4] (1), `tint` `"#rrggbb"` ("#ffffff") | After the tone curve, in linear colour: multiply by tint and brightness, mix with Rec. 709 luma by saturation, then scale around 0.18 by contrast. |
| `vignette` | `strength` [0,1] (0.5), `radius` [0,2] (0.6), `softness` (0,2] (0.6), `color` `"#rrggbb"` ("#000000") | Mixes the screen edge towards `color`; 0 at `radius` and full at `radius + softness`, with 1 at the corners. |
| `fxaa` | none | Fast approximate anti-aliasing of the final image, before extensions. |
| *namespaced*, e.g. `studio.tint` | up to 16 scalar params | A host extension pass (below). |
| `projected` | none | Projected geometry. Disabled skips it. |
| `ui` | none | The UI. Disabled draws none; input still routes. |

Order is fixed by stage: `scene`, then `ao`, `fog`, `bloom`, `tonemap`,
`grade`, `vignette`, `fxaa`, then extensions, then `projected`, then `ui`. A built-in kind appears at most once;
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
- **Native wgpu player:** runs every built-in kind with the same parameters,
  defaults and formulas: the same bloom threshold window, the tone curves
  ported from three.js (ACES with `exposure / 0.6`, and linear), Web's
  12-sample depth AO and depth fog rebuilt from the native projection, and the
  same grade, vignette and FXAA. It builds the post chain the first time a
  declared post pass is enabled. It rejects extension kinds
  (`NATIVE_RENDER_PASS_UNSUPPORTED`) and `render_extensions`
  (`HOST_RENDER_EXTENSIONS_UNSUPPORTED`) instead of drawing them differently.
- **Known differences:** native renders the scene into an 8-bit target, so tone
  mapping sees values clamped at 1, while Web keeps half-float HDR. The native
  2D path draws no depth, so `ao` and `fog` have no effect there.

Until 2026-11-14 the native post chain drew the image upside down and the
native clear colour was written as linear, which made backgrounds lighter than
Web's `#111827`. Both are fixed; native captures taken before then differ.

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
- `declared_post_passes_map_to_the_look_uniform_with_web_defaults` and the
  WGSL validation test in the native player; on 2026-11-14 AO, fog, grade,
  vignette and FXAA were captured on the same scene in the native player
  (RTX 5080, Vulkan) and the Web renderer (Chromium) and matched by eye.
