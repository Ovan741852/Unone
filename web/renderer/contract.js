/**
 * Renderer host contract.
 *
 * The engine never imports this module. It publishes a WorldSnapshot; a host
 * chooses an implementation that consumes it. Keeping this boundary tiny lets
 * the same simulation run with Three.js, a native renderer, a test renderer,
 * or a future custom WebGPU adapter.
 */
export function assertRendererContract(renderer) {
  for (const method of ["draw", "clearTextures"]) {
    if (typeof renderer?.[method] !== "function") {
      throw new Error(`renderer contract missing ${method}()`);
    }
  }
  return renderer;
}

