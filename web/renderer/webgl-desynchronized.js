// Opt in before Three constructs its renderer, then let Three reacquire the
// same context. Passing the context to Three changes Three's internal alpha
// handling even when its renderer option is alpha:false.
export function prepareDesynchronizedWebGL(canvas, antialias, requested, defaultDepth = true) {
  if (!requested) return {requested:false, attempted:false, precreated:false};
  try {
    // Match Three's requested depth as well as its other context attributes;
    // Three reacquires this same context after the low-latency hint is applied.
    const gl=canvas.getContext('webgl2',{
      alpha:true,depth:defaultDepth,stencil:false,antialias,premultipliedAlpha:true,
      preserveDrawingBuffer:false,powerPreference:'default',
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
