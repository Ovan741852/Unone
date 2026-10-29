// Generic official WebGL clear-state lifecycle. Register after Three creates its renderer:
// its restore listener reinitializes WebGLBackground, then this hook restores only
// the public clear intent captured at loss. No claim about other device state.
export function installContextClearRecovery(THREE,renderer,canvas){
 let pending=null,last=null,losses=0,restores=0,disposed=false;
 function lost(){
  if(disposed)return;
  pending={color:renderer.getClearColor(new THREE.Color()),alpha:renderer.getClearAlpha()};losses++;
 }
 function restored(){
  if(disposed||!pending)return;
  renderer.setClearColor(pending.color,pending.alpha);
  last={linear_rgb:pending.color.toArray(),alpha:pending.alpha};pending=null;restores++;
 }
 canvas.addEventListener('webglcontextlost',lost);canvas.addEventListener('webglcontextrestored',restored);
 return {metrics:()=>({losses,restores,pending:pending!==null,last_restored_clear:last,
  scope:'public clearColor/alpha only; not full GPU/device-state recovery'}),
  dispose(){if(disposed)return;disposed=true;pending=null;
   canvas.removeEventListener('webglcontextlost',lost);canvas.removeEventListener('webglcontextrestored',restored);}};
}
