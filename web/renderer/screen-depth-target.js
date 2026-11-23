// EXPERIMENT ONLY. This requires the matching patched Three screen-encoded
// render target. It does not provide complete-frame or input transactions.
// Do not enable in the player without browser and failure-path validation.
export function createScreenDepthTarget(THREE, renderer) {
 const gl=renderer.getContext();let target=null, active=false, created=0, released=0;
 function release(){if(target){target.dispose();target=null;released++;}active=false;}
 function begin(width,height){
  if(active||gl.isContextLost()||renderer.getRenderTarget()!==null||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1)return false;
  try {
   if(target&&(target.width!==width||target.height!==height))release();
   if(!target){
    target=new THREE.WebGLRenderTarget(width,height,{depthBuffer:true,stencilBuffer:false,samples:0,format:THREE.RGBAFormat,type:THREE.UnsignedByteType});
    target.texture.colorSpace=THREE.NoColorSpace;target.texture.userData.unoneScreenEncoded=true;created++;
   }
   renderer.setRenderTarget(target);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE||gl.isContextLost()){renderer.setRenderTarget(null);release();return false;}
   active=true;return true;
  }catch {try{renderer.setRenderTarget(null);}finally{release();}return false;}
 }
 function commit(){
  if(!active||!target||gl.isContextLost()||renderer.getRenderTarget()!==target){cancel();return false;}
  // The getter is deliberately retained for this experimental path: the
  // target framebuffer is owned by Three and is not a supported public API.
  // A synchronous driver query can stall and must be addressed before ship.
  const read=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),color=gl.getParameter(gl.COLOR_CLEAR_VALUE),depth=gl.getParameter(gl.DEPTH_CLEAR_VALUE);
  const {width,height}=target;active=false;
  try {
   renderer.setRenderTarget(null);gl.disable(gl.SCISSOR_TEST);
   gl.bindFramebuffer(gl.READ_FRAMEBUFFER,read);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,null);gl.readBuffer(gl.COLOR_ATTACHMENT0);
   gl.blitFramebuffer(0,0,width,height,0,0,width,height,gl.COLOR_BUFFER_BIT,gl.NEAREST);
   return !gl.isContextLost()&&gl.getError()===gl.NO_ERROR;
  }catch{return false;}finally{renderer.resetState();gl.clearColor(...color);gl.clearDepth(depth);}
 }
 function rebind(){if(!active||!target||gl.isContextLost())return false;renderer.setRenderTarget(target);return true;}
 function cancel(){active=false;renderer.setRenderTarget(null);}
 function contextLost(){target=null;active=false;}
 return {begin,rebind,commit,cancel,release,contextLost,dispose:release,target:()=>active?target:null,metrics:()=>({active,allocated:!!target,width:target?.width??0,height:target?.height??0,created,released})};
}
