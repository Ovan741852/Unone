// This is the default drawing buffer's depth attachment, not the independent
// depth textures owned by a post-processing or checked-raster render target.
export function normalizeWebglDefaultDepth(value) {
  if (value === undefined) return true;
  if (typeof value !== 'boolean') throw Error('WEBGL_DEFAULT_DEPTH_INVALID: expected an optional boolean');
  return value;
}

const hasItems=value=>Array.isArray(value)?value.length>0:value!==null&&typeof value==='object'&&Object.keys(value).length>0;

// A missing default depth attachment must never silently turn depth-tested world
// draws into painter-order rendering. Offscreen post-processing owns a separate
// depth target; the direct-to-default path only permits an empty world + UI.
export function assertDefaultDepthFrame({depth, world={}, worldVisible=true, terrain=[], projected=[], offscreenDepth=false, sceneEnabled=true}) {
  if (depth !== false) return;
  if (hasItems(projected)) throw Error('WEBGL_DEFAULT_DEPTH_PROJECTED_UNSUPPORTED: projected draws require a depth-enabled profile');
  if (!worldVisible || !sceneEnabled || offscreenDepth) return;
  const entities=world.entities??{};
  let visibleEntity=false;
  for (const id in entities) {
    if (!Object.hasOwn(entities,id)) continue;
    const e=entities[id];
    if (e && ((e.sprite && e.sprite.visible!==false)||(e.mesh3d?.visible && e.transform3d))) { visibleEntity=true; break; }
  }
  // A camera alone submits no fragments. In particular, an empty transient
  // world during a scene transition must not trip this guard.
  if (visibleEntity || hasItems(terrain) || hasItems(world.geometry3d) || hasItems(world.instances3d) || hasItems(world.particles) || hasItems(world.effects))
    throw Error('WEBGL_DEFAULT_DEPTH_REQUIRED: visible world drawing requires a depth-enabled default buffer or an offscreen depth pass');
}

export function assertDefaultDepthOptions({depth, declared=false, backend, checkedRaster=false, frameProfile=null, renderPasses={}, presentationCallbacks=false}) {
  if (declared && backend !== 'webgl') throw Error('WEBGL_DEFAULT_DEPTH_OFFICIAL_WEBGL_ONLY');
  if (depth !== false) return;
  if (checkedRaster || frameProfile) throw Error('WEBGL_DEFAULT_DEPTH_PROJECTED_UNSUPPORTED: checked/projected profiles require default depth');
  if (presentationCallbacks) throw Error('WEBGL_DEFAULT_DEPTH_EXTENSIONS_UNSUPPORTED: presentation callbacks need a depth-enabled default buffer');
  if (Object.keys(renderPasses).length) throw Error('WEBGL_DEFAULT_DEPTH_EXTENSIONS_UNSUPPORTED: render extensions need a depth-enabled default buffer');
}

export function webglDefaultDepthMetrics(renderer, requested, backend) {
  let attrs=null;
  try { attrs=backend==='webgl'?renderer.getContext?.()?.getContextAttributes?.()??null:null; } catch { /* context lost */ }
  return {requested,backend,actual:typeof attrs?.depth==='boolean'?attrs.depth:null,scope:'default_framebuffer',reconfigure:'relaunch'};
}
