/**
 * Renderer host contract.
 *
 * The engine never imports this module. It publishes a WorldSnapshot; a host
 * chooses an implementation that consumes it. Keeping this boundary tiny lets
 * the same simulation run with Three.js, a native renderer, a test renderer,
 * or a future custom WebGPU adapter.
 *
 * The Three.js adapter additionally exposes `attachPresentation` and accepts
 * `onReady`/`beforeRender` options. These are controlled host hooks: a host can
 * receive `{THREE, scene, renderer, root, camera, backend}` and update its own
 * presentation objects before each draw without changing the snapshot or
 * engine transport. Hooks are optional and are not part of the Rust/Core ABI.
 */
export function assertRendererContract(renderer) {
  for (const method of ["draw", "clearTextures"]) {
    if (typeof renderer?.[method] !== "function") {
      throw new Error(`renderer contract missing ${method}()`);
    }
  }
  return renderer;
}

