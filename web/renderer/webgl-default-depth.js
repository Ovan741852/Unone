// This is the default drawing buffer's depth attachment, not the independent
// depth textures owned by a post-processing or checked-raster render target.
export function normalizeWebglDefaultDepth(value) {
  if (value === undefined) return true;
  if (typeof value !== 'boolean') throw Error('WEBGL_DEFAULT_DEPTH_INVALID: expected an optional boolean');
  return value;
}

const hasItems=value=>Array.isArray(value)?value.length>0:value!==null&&typeof value==='object'&&Object.keys(value).length>0;

// Decide conservatively whether the non-postprocessed frame needs an offscreen
// depth attachment. This deliberately does not infer visibility from positions:
// shader deformation and third-party effect bounds make that unsafe.
export function defaultDepthFrameNeedsFallback({depth, world={}, worldVisible=true, terrain=[], projected=[], offscreenDepth=false, sceneEnabled=true, hooksMayDraw=false}) {
  if (depth !== false) return false;
  if (hasItems(projected)) return true;
  if (!worldVisible || !sceneEnabled || offscreenDepth) return false;
  if (hooksMayDraw) return true;
  const entities=world.entities??{};
  let visibleEntity=false;
  for (const id in entities) {
    if (!Object.hasOwn(entities,id)) continue;
    const e=entities[id];
    if (e && ((e.sprite && e.sprite.visible!==false)||(e.mesh3d && e.mesh3d.visible!==false && e.transform3d))) { visibleEntity=true; break; }
  }
  // A camera alone submits no fragments. In particular, an empty transient
  // world during a scene transition does not need an extra attachment.
  return visibleEntity || hasItems(terrain) || hasItems(world.geometry3d) || hasItems(world.instances3d) || hasItems(world.particles) || hasItems(world.effects);
}

// Unsupported configurations fall back BEFORE context creation, preserving
// compatibility rather than breaking on a future draw. Late-attached hooks are
// handled conservatively by the per-frame fallback instead.
export function resolveDefaultDepthOptions({depth, backend, checkedRaster=false, frameProfile=null, renderPasses={}, presentationCallbacks=false,antialias=false,desynchronized=false}) {
  if (depth !== false) return {effective:true,reason:null};
  if (backend!=='webgl') return {effective:true,reason:'non_webgl'};
  if (antialias) return {effective:true,reason:'antialias'};
  if (desynchronized) return {effective:true,reason:'desynchronized'};
  if (checkedRaster||frameProfile) return {effective:true,reason:'checked_raster'};
  if (presentationCallbacks||Object.keys(renderPasses).length) return {effective:true,reason:'extensions'};
  return {effective:false,reason:null};
}

export function webglDefaultDepthMetrics(renderer, requested, backend, fallbackReason=null) {
  let attrs=null;
  try { attrs=backend==='webgl'?renderer.getContext?.()?.getContextAttributes?.()??null:null; } catch { /* context lost */ }
  return {requested,backend,actual:typeof attrs?.depth==='boolean'?attrs.depth:null,fallback_reason:fallbackReason,scope:'default_framebuffer',reconfigure:'relaunch'};
}
