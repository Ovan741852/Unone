# Renderer presentation host hooks

`web/renderer/three.js` now exposes a controlled hook for optional presentation
packages such as `org.unone.animator`. This is a host boundary, not a change to
the Rust/Core snapshot or to the `instances3d` 40-byte transform format.

```js
const renderer = await createThreeRenderer(canvas, {
  kind: "three-webgl",
  onReady: ({ THREE, scene, renderer, root, backend, attachPresentation }) => {
    const host = createAnimatorHost({ THREE, budgetHz: 240 });
    // Load GLB/root/clips in this host and attach them to `scene`/`root`.
    attachPresentation({
      beforeRender: ({ dt }) => host.update(dt),
      onDispose: () => host.dispose(),
    });
  },
});
```

`beforeRender` receives `{ snapshot, dt, THREE, scene, renderer, backend,
root, camera, camera3d, attachPresentation }`. `dt` is the explicit
`draw(snapshot, { dt })` value when supplied, otherwise the renderer's
monotonic display interval. The callback runs immediately before the normal
sprite/mesh/instance draw, so custom skinned roots share the same scene,
Bloom/AO path and camera.

`renderer.attachPresentation(hook)` can be called after construction and
returns a detacher. A hook may provide `onDispose`; `renderer.dispose()` calls
those callbacks before releasing renderer resources. `onReady` may return a
cleanup function or `{ dispose() }` and is awaited during renderer creation.

The hook is intentionally generic. The host owns GLB/Spine decoding, skeleton
roots, equipment mesh attachment and any GPU-specific work. `org.unone.animator`
owns only presentation state/blend/LOD sampling; gameplay movement, root-motion,
collision, damage and reward settlement remain in Luau. Lottie uses its own
Canvas2D host and does not require this Three hook.

The raw WebGPU snapshot renderer does not expose Three.js objects; it can still
draw the semantic snapshot, but a Three-based skeletal host must request the
Three adapter (`three-webgl` or `three-webgpu`).

## Opt-in WebGL postprocessing

`createThreeRenderer(canvas, options)` accepts a constructor-only
`options.postprocessing` object for the official WebGL adapter. This is a
JavaScript host option, not a new `player.presentation.json` or Rust/Core field.
Omit it to preserve the legacy rendering path and defaults of existing hosts.

```js
const renderer = await createThreeRenderer(canvas, {
  kind: "three-webgl",
  bloom: true,
  ao: true,
  postprocessing: {
    toneMapping: "aces",
    exposure: 1.05,
    bloomThreshold: 1.1,
    bloomStrength: 0.16,
    aoStrength: 0.9,
  },
});
```

Each setting is optional inside the object; unspecified fields use these defaults.
Unknown fields, nonnumeric/nonfinite values and values outside the bounds fail
with `POSTPROCESSING_CONFIG_INVALID` before allocating a GPU renderer.

| Setting | Default | Accepted values |
| --- | --- | --- |
| `toneMapping` | `"none"` | `"aces"` or `"none"`; `none` applies linear exposure without a nonlinear highlight curve |
| `exposure` | `1` | finite number in `(0, 8]` |
| `bloomThreshold` | `0.55` | finite number in `[0, 16]`, measured in linear scene brightness; extraction fades in over the next `0.4` |
| `bloomStrength` | `0.75` | finite number in `[0, 4]` |
| `aoStrength` | `1.7` | finite number in `[0, 4]` |

The engine renders the scene into a linear target, applies enabled Bloom/AO,
then applies exposure, tone mapping and one sRGB output conversion in the final
pass. With this option enabled, that final pass also runs when
`setBloom(false)` and `setAO(false)` select a low-quality mode. Built-in materials
and raw VFX shaders therefore share the same output color treatment across
quality modes. Game UI is drawn afterwards in the `ui` stage and is not post-processed. `setBloom` and `setAO`
remain Boolean switches; strength values do not enable either effect by themselves.
The final pass restores the renderer's previous tone-mapping/exposure state.

Postprocessing currently requires WebGL. Automatic backend selection chooses
WebGL when it is configured; an explicit `kind: "three-webgpu"` request fails
with `POSTPROCESSING_BACKEND_UNSUPPORTED`. `metrics()` reports the normalized
`postprocessing` settings, `output_pipeline: "linear-tone-srgb"`, actual `ao` and
`bloom` switches, and `hdr`. Legacy hosts report `postprocessing: null` and
`output_pipeline: "legacy"`.

When half-float color targets are unavailable (`hdr: false`), the RGBA8 scene
target clips brightness above `1` before the final pass. Tone mapping cannot
recover that highlight detail, and Bloom thresholds above `1` cannot select it.
The output pipeline still performs exposure and color conversion, but this
fallback does not provide HDR highlight range. Renderer disposal releases the
engine-owned postprocessing targets, shaders and pending timer queries.

Focused regression tests: `node --test web/renderer/bloom.test.mjs` (legacy pass
counts/timers, validation, opt-in output/settings/state restoration and disposal).
`node scripts/verify-postprocessing-browser.mjs` checks actual official WebGL
color parity across quality modes and writes `.cache/postprocessing-browser-report.json`.
# Preprojected transport

The official native and Three WebGL adapters accept game-owned clip-space indexed
geometry through `api.projected`; see [the bounded contract](projected-geometry.md).
Projection/picking rules remain in game logic. WebGPU fails explicitly for this
new transport; CPU validation does not establish a rendered-pixel result.

