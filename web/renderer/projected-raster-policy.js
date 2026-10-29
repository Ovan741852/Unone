/** @typedef {'host'|'upper_left_checked'} ProjectedRasterPolicy */
export function parseProjectedRaster(value){
 if(value===undefined)return Object.freeze({requested:'host',declared:false});
 if(!['host','upper_left_checked'].includes(value))throw Error('PROJECTED_RASTER_INVALID: expected host or upper_left_checked');
 return Object.freeze({requested:value,declared:true});
}
export function assertRasterBackend(policy,backend){
 if(policy.declared&&backend!=='webgl')throw Error('PROJECTED_RASTER_OFFICIAL_WEBGL_ONLY: explicit policy requires official WebGL2');
}
export function assertRasterProfile(policy,{antialias,effectiveAA,bloom,ao,postprocessing,outputSupported=true}){
 if(policy.requested!=='upper_left_checked')return;
 if(antialias!==false||effectiveAA!==false||bloom||ao||postprocessing!==undefined||!outputSupported)
  throw Error('PROJECTED_RASTER_PROFILE_UNSUPPORTED: WebGL2, requested/effective AAfalse, Bloom/AOoff, sRGB/no-tone output required');
}
export function assertRasterSnapshot(policy,snapshot){
 if(policy.requested==='upper_left_checked'&&(snapshot?.world??snapshot)?.projected_world_visible!==false)
  throw Error('PROJECTED_RASTER_WORLD_DEPTH_UNSUPPORTED: checked isolated projected pass requires setWorldVisible(false), including empty snapshots');
}
