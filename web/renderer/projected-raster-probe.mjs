// Engine-owned feasibility only: no schema/Core/native or official default changes.
import {createProjectedRenderer,projectedEntries} from './projected.js';
import {probeShaderNamespace} from './projected-raster-probe-shaders.mjs';
import {createProbeTarget,saveProbeState,restoreProbeState,reflectedScissorRenderer} from './projected-raster-probe-target.mjs';
export function createRasterProbe({THREE,renderer,camera,textureFor,strategy,antialias,backend}){
 if(!['A','B','C'].includes(strategy))throw Error('RASTER_PROBE_STRATEGY');
 if(backend!=='webgl'||antialias!==false)throw Error('RASTER_PROBE_REQUIRES_WEBGL2_AA_FALSE');
 const projected=createProjectedRenderer(probeShaderNamespace(THREE,strategy),textureFor);
 const staging=strategy==='A'?null:createProbeTarget(THREE,strategy);let context='initial_needs_gpu_validation',disposed=false;
 function draw(snapshot,specs){
  if(disposed)throw Error('RASTER_PROBE_DISPOSED');
  if(context==='lost')throw Error('RASTER_PROBE_CONTEXT_LOST');
  if((snapshot?.world??snapshot)?.projected_world_visible!==false)throw Error('RASTER_PROBE_WORLD_DEPTH_UNSUPPORTED');
  const entries=projectedEntries(snapshot);projected.prepare(entries,specs);
  if(!entries.length)return;
  const state=saveProbeState(THREE,renderer);
  if(state.target!==null)throw Error('RASTER_PROBE_INCOMING_TARGET_UNSUPPORTED');
  try{
   if(!staging){projected.draw(renderer,camera,true);return;}
   const size=renderer.getDrawingBufferSize(new THREE.Vector2()),ratio=renderer.getPixelRatio();
   const target=staging.ensure(size.x,size.y);renderer.setRenderTarget(target);
   renderer.setViewport(0,0,size.x/ratio,size.y/ratio);renderer.setScissorTest(false);
   renderer.autoClear=false;renderer.setClearColor(0,0);renderer.clear(true,true,false);
   const drawRenderer=strategy==='C'?reflectedScissorRenderer(renderer,size.y):renderer;
   projected.draw(drawRenderer,camera,false);staging.compose(renderer,camera,size.x,size.y);
  }finally{restoreProbeState(renderer,state);}
 }
 return {draw,metrics:()=>({strategy,context,...(staging?.metrics()??{generation:0,physical_size:null}),...projected.metrics(),
  limitations:'WebGL2 / AAfalse / worldhidden / Bloom-AO-off / isolated projected depth; target GPU feasibility only'}),
  invalidate(){if(disposed)return;projected.clear();staging?.invalidate();context='lost';},
  restore(){if(disposed)throw Error('RASTER_PROBE_DISPOSED');context='restored_needs_gpu_revalidation';},
  dispose(){if(disposed)return;disposed=true;projected.clear();staging?.dispose();}};
}
