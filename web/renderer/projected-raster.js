import {createRasterTarget,saveRasterState,restoreRasterState,reflectedScissorRenderer} from './projected-raster-target.js';
// Same target and copy path serve private conformance and actual game batches.
export function createProjectedRasterPass(THREE,renderer){
 const target=createRasterTarget(THREE,'C');let disposed=false;
 function draw(projected,camera){
  if(disposed)throw Error('PROJECTED_RASTER_DISPOSED');
  const state=saveRasterState(THREE,renderer);
  if(state.target!==null)throw Error('PROJECTED_RASTER_PROFILE_UNSUPPORTED: incoming target must be default framebuffer');
  try{
   const size=renderer.getDrawingBufferSize(new THREE.Vector2()),ratio=renderer.getPixelRatio();
   renderer.setRenderTarget(target.ensure(size.x,size.y));renderer.setViewport(0,0,size.x/ratio,size.y/ratio);
   renderer.setScissorTest(false);renderer.autoClear=false;renderer.setClearColor(0,0);renderer.clear(true,true,false);
   projected.draw(reflectedScissorRenderer(renderer,size.y),camera,false);
   target.compose(renderer,camera,size.x,size.y);
  }finally{restoreRasterState(renderer,state);}
 }
 return {draw,invalidate(){target.invalidate();},metrics:target.metrics,readCoverage:(...values)=>target.read(renderer,...values),
  dispose(){if(disposed)return;disposed=true;target.dispose();}};
}
