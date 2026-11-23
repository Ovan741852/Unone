// Opt in before Three constructs its renderer, then let Three reacquire the
// same context. Passing the context to Three changes Three's internal alpha
// handling even when its renderer option is alpha:false.
export function prepareDesynchronizedWebGL(canvas, antialias, requested, prototypePreserve=false) {
  if (!requested) return {requested:false, attempted:false, precreated:false};
  try {
    // These are Three's WebGLRenderer defaults with its internal alpha:true
    // request. Do not change depth, stencil, antialias, alpha, premultiplication,
    // preservation or GPU preference when adding the low-latency hint.
    const gl=canvas.getContext('webgl2',{
      alpha:true,depth:true,stencil:false,antialias,premultipliedAlpha:true,
      preserveDrawingBuffer:prototypePreserve,powerPreference:'default',
      failIfMajorPerformanceCaveat:false,desynchronized:true,
    });
    if (!gl || typeof gl.getContextAttributes!=='function' || !gl.getContextAttributes())
      return {requested:true, attempted:true, precreated:false};
    return {requested:true, attempted:true, precreated:true};
  } catch {
    // The standard Three path still attempts normal context creation. A
    // browser may also silently ignore the hint; report the actual attribute.
    return {requested:true, attempted:true, precreated:false};
  }
}

export function webglDesynchronizedMetrics(renderer, prepared, backend) {
  const gl=backend==='webgl'?renderer.getContext?.():null;
  let attributes=null;
  try { attributes=gl?.getContextAttributes?.()??null; } catch { /* lost or unavailable */ }
  return {...prepared,backend,actual:typeof attributes?.desynchronized==='boolean'?attributes.desynchronized:null};
}
