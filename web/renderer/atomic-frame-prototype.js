// EXPERIMENT ONLY: probe compositing into an encoded RGBA8 target before one
// raw WebGL2 blit. This is not a supported Three/XR contract or a guarantee
// against front-buffer scanout tearing. Do not enable in production.
export function createAtomicFramePrototype(THREE, renderer) {
 const gl=renderer.getContext();
 if(!gl?.blitFramebuffer)throw Error('ATOMIC_PROTOTYPE_REQUIRES_WEBGL2');
 let target=null,active=false,disposed=false;
 const size=new THREE.Vector2();
 function begin(){
  if(disposed||active)throw Error('ATOMIC_PROTOTYPE_LIFECYCLE');
  if(gl.isContextLost())return false;
  renderer.getDrawingBufferSize(size);
  const width=Math.max(1,Math.floor(size.x)),height=Math.max(1,Math.floor(size.y));
  if(!target){
   target=new THREE.WebGLRenderTarget(width,height,{depthBuffer:true,stencilBuffer:false,samples:0});
   // Three's internal XR output path chooses the target's sRGB for shaders.
   // RGBA8 keeps the encoded values raw so the final blit does not re-encode.
   target.isXRRenderTarget=true;
   target.texture.colorSpace=THREE.SRGBColorSpace;
   target.texture.internalFormat='RGBA8';
  }else if(target.width!==width||target.height!==height)target.setSize(width,height);
  renderer.setRenderTarget(target);active=true;return true;
 }
 function finish(publish){
  if(!active)return;
  try{
   if(publish&&!gl.isContextLost()){
    const framebuffer=renderer.properties.get(target).__webglFramebuffer;
    if(!framebuffer)throw Error('ATOMIC_PROTOTYPE_FRAMEBUFFER_MISSING');
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,null);
    gl.blitFramebuffer(0,0,target.width,target.height,0,0,target.width,target.height,gl.COLOR_BUFFER_BIT,gl.NEAREST);
   }
  }finally{active=false;renderer.resetState();renderer.setRenderTarget(null);}
 }
 function dispose(){if(disposed)return;disposed=true;if(active)finish(false);target?.dispose();target=null;}
 return {begin,finish,dispose,target:()=>active?target:null,metrics:()=>({experimental:true,width:target?.width??0,height:target?.height??0,
  color_bytes_estimate:target?target.width*target.height*4:0,depth_bytes_upper_estimate:target?target.width*target.height*4:0})};
}
