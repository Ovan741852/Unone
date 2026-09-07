import { assertRendererContract } from "./contract.js";
import { createThreeRenderer } from "./three.js";
import { createWebGpuRenderer } from "../shared/webgpu-snapshot.js";

/**
 * Select the presentation adapter without changing the engine/runtime.
 * `three` is the default and chooses Three.js WebGPU when available, otherwise
 * Three.js WebGL. `webgpu-raw` remains available as a diagnostic adapter.
 */
export async function createRenderer(canvas, options = {}) {
  const kind = options.kind ?? "three";
  if (kind === "three" || kind === "three-webgpu" || kind === "three-webgl") {
    return assertRendererContract(await createThreeRenderer(canvas, { ...options, kind }));
  }
  if (kind === "webgpu-raw") {
    return assertRendererContract(await createWebGpuRenderer(canvas, options));
  }
  throw new Error(`unknown renderer adapter: ${kind}`);
}

