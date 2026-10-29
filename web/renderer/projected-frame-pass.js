import {saveRasterState,restoreRasterState} from './projected-raster-target.js';
import {createFrameTarget} from './projected-frame-target.js';
import {assertFrameGpuError} from './projected-frame-target-query.js';
export function createFramePass(THREE,renderer){
 let target=createFrameTarget(THREE),generation=0,disposed=false;
 function draw(draws,camera,frame){
  if(disposed)throw Error('PROJECTED_FRAME_DISPOSED');const gl=renderer.getContext();if(gl.isContextLost())return false;
  target??=createFrameTarget(THREE);
  assertFrameGpuError(gl,'pass.enter');
  const state=saveRasterState(THREE,renderer),dither=gl.isEnabled(gl.DITHER),depthClear=gl.getParameter(gl.DEPTH_CLEAR_VALUE);
  if(state.target!==null)throw Error('PROJECTED_FRAME_TARGET_UNSUPPORTED: default incoming framebuffer required');
  try{
   gl.disable(gl.DITHER);renderer.autoClear=false;const size=renderer.getDrawingBufferSize(new THREE.Vector2());
   if(!target.ensure(renderer,camera,size.x,size.y))return false;
   target.initialize(renderer,camera,frame.initial);assertFrameGpuError(gl,'pass.initialize');
   draws.draw(renderer,camera,size.x,size.y);assertFrameGpuError(gl,'pass.draws');
   target.compose(renderer,camera,size.x,size.y);assertFrameGpuError(gl,'pass.compose');
   if(gl.isContextLost())return false;
   if(gl.getParameter(gl.DEPTH_CLEAR_VALUE)!==depthClear)throw Error('PROJECTED_FRAME_STATE_INVALID: depth clear cache changed');
   return true;
  }catch(error){if(gl.isContextLost())return false;throw error;
  }finally{if(dither)gl.enable(gl.DITHER);else gl.disable(gl.DITHER);restoreRasterState(renderer,state);}
 }
 return {draw,invalidate(){target?.invalidate();},metrics(){const m=target?.metrics()??{generation:0,attachment:null};return {...m,generation:generation+m.generation};},
  // Dispose listeners and every helper while their old context is lost. Reusing those
  // geometries after restore would retain Three's old GPU-owner callbacks as well.
  contextLost(){if(disposed||!target)return;generation+=target.metrics().generation;target.dispose();target=null;},
  dispose(){if(disposed)return;disposed=true;target?.dispose();target=null;}};
}
