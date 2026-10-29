import {validateEffect} from './vfx-contract.js';
export {validateEffect, parametersFor, sampleValue, layerPhase} from './vfx-contract.js';
// Ownership is explicit: callers retain supplied textures; this loader owns its results.
export async function loadVfxTextures(definition, {THREE, baseUrl = globalThis.location?.href} = {}) {
  validateEffect(definition);
  if (!THREE?.TextureLoader) throw Error('VFX_TEXTURE_LOADER_REQUIRED');
  const textures = {}, loader = new THREE.TextureLoader();
  try {
    const results = await Promise.allSettled(Object.entries(definition.textures ?? {}).map(async ([id, source]) => {
      const texture = await loader.loadAsync(new URL(source.src, baseUrl).href);
      texture.colorSpace = source.colorSpace === 'linear' ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = source.wrap === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      textures[id] = texture;
    }));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
  } catch (error) { for (const texture of Object.values(textures)) texture.dispose(); throw error; }
  let disposed = false;
  return {textures, dispose() { if (disposed) return; disposed = true; for (const texture of Object.values(textures)) texture.dispose(); }};
}
