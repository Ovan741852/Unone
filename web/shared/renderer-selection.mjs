// The official player owns the runtime, input, persistence and scheduling.
// Custom renderers are a deliberately selected Web host extension. A module
// executes as ordinary trusted JS; this selection contract is not a sandbox.
import {parseProjectedRaster} from '../renderer/projected-raster-policy.js';
import {parseFrameProfile} from '../renderer/projected-frame-policy.js';
import {parseTextureCache} from '../renderer/texture-cache-policy.js';
export function normalizeAntialias(value) {
  if (value === undefined) return true;
  if (typeof value !== 'boolean') throw Error('ANTIALIAS_INVALID: expected an optional boolean');
  return value;
}
export async function createPlayerRenderer(canvas, options, presentation = {}, {
  createOfficial,
  loadModule = url => import(url),
  contentRoot = new URL('content/', document.baseURI),
} = {}) {
  const mode = presentation.renderer_mode ?? 'official';
  const modulePath = presentation.renderer_module;
  const files = presentation.renderer_files ?? [];
  if (!Array.isArray(files)) throw Error('RENDERER_FILES_INVALID: expected an array of project-relative paths');
  if (mode === 'official') {
    if (modulePath != null || files.length) throw Error('RENDERER_REPLACEMENT_NOT_DECLARED: select renderer_mode custom explicitly');
    const antialias = normalizeAntialias(presentation.antialias === undefined ? options.antialias : presentation.antialias);
    const value=presentation.projected_raster===undefined?options.projectedRaster:presentation.projected_raster;
    parseProjectedRaster(value);
    const frame=presentation.projected_material_profile===undefined?options.projectedMaterialProfile:presentation.projected_material_profile;
    parseFrameProfile(frame);
    const textureCache=presentation.texture_cache===undefined?options.textureCache:presentation.texture_cache;
    parseTextureCache(textureCache);
    return createOfficial(canvas, {...options, antialias,...(textureCache===undefined?{}:{textureCache}),...(value===undefined?{}:{projectedRaster:value}),...(frame===undefined?{}:{projectedMaterialProfile:frame})});
  }
  if (mode !== 'custom') throw Error(`RENDERER_MODE_INVALID: ${mode}`);
  if(presentation.texture_cache!==undefined||options.textureCache!==undefined)throw Error('TEXTURE_CACHE_OFFICIAL_ONLY');
  if(presentation.projected_material_profile!==undefined||options.projectedMaterialProfile!==undefined)throw Error('PROJECTED_FRAME_OFFICIAL_WEBGL_ONLY');
  if(presentation.projected_raster!==undefined||options.projectedRaster!==undefined)throw Error('PROJECTED_RASTER_OFFICIAL_WEBGL_ONLY: omit projected_raster for a custom renderer');
  if (presentation.antialias !== undefined) throw Error('ANTIALIAS_OFFICIAL_ONLY: omit antialias for a custom renderer');
  if (typeof modulePath !== 'string' || !/\.(mjs|js)$/.test(modulePath) || !files.includes(modulePath)) {
    throw Error('RENDERER_MODULE_REQUIRED: custom mode requires renderer_module in renderer_files');
  }
  for (const path of files) {
    if (typeof path !== 'string' || /[\\:%?#\u0000-\u001f\u007f]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) {
      throw Error('RENDERER_PATH_INVALID: expected project-relative paths');
    }
  }
  const module = await loadModule(new URL(modulePath, contentRoot).href);
  if (typeof module.createRenderer !== 'function') throw Error('RENDERER_FACTORY_REQUIRED: custom module must export createRenderer(canvas, options)');
  const renderer = await module.createRenderer(canvas, options);
  for (const method of ['draw', 'ready', 'metrics', 'setBloom', 'dispose']) {
    if (typeof renderer?.[method] !== 'function') {
      // A factory may already have allocated a context. Release it on a bad
      // returned contract when it provides a usable cleanup method.
      try { if (typeof renderer?.dispose === 'function') await renderer.dispose(); } catch { /* preserve the contract diagnostic */ }
      throw Error(`RENDERER_CONTRACT_INVALID: missing ${method}()`);
    }
  }
  return renderer;
}

// Fatal player errors and pagehide can both request cleanup. Renderer factories
// may own GPU resources; the host guarantees one teardown call per instance.
export function createRendererDisposer() {
  const disposed = new WeakSet();
  return renderer => {
    if (!renderer || disposed.has(renderer)) return;
    disposed.add(renderer);
    renderer.dispose();
  };
}
