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
