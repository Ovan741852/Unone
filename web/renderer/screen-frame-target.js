// Internal building block for the opt-in complete-frame transaction.
// Requires the pinned Three WebGL renderer's screen-encoded target contract.
// A successful WebGL submission is NOT a compositor/physical-scanout ack.
export function createScreenFrameTarget(THREE,renderer){
 const gl=renderer.getContext();let target=null,lostTarget=null,depthBuffer=null,active=false,disposed=false,epoch=1;
 let created=0,released=0,depthCreated=0,depthReleased=0,commits=0,aborts=0,lastFailure=null;
 const status=(ok,reason,presentation)=>Object.freeze({status:ok?'completed':'skipped',reason:reason??null,presentation,epoch});
 function lost(){return gl.isContextLost();}
 function invalidate(){active=false;lostTarget=target;if(lostTarget)lostTarget.dispose();target=null;depthBuffer=null;epoch++;}
 function bindTarget(){renderer.setRenderTarget(target);}
 function deleteDepth(){if(!depthBuffer)return;gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,null);gl.deleteRenderbuffer(depthBuffer);depthBuffer=null;depthReleased++;}
 function release(){
  if(!target){active=false;return;}
  if(!lost()){
   bindTarget();deleteDepth();renderer.setRenderTarget(null);target.dispose();
  }else{target.dispose();depthBuffer=null;}
  target=null;active=false;released++;
 }
 function begin({width,height,depth}){
  if(disposed)return status(false,'disposed','unchanged');
  if(active)return status(false,'already_active','unchanged');
  if(lost())return status(false,'context_lost','unknown');
  // Three can retain its logical current target over a WebGL context loss.
  // Reset only our own invalidated target, never a caller's unrelated target.
  if(lostTarget){if(renderer.getRenderTarget()===lostTarget)renderer.setRenderTarget(null);lostTarget=null;}
  if(renderer.getRenderTarget()!==null)return status(false,'target_busy','unchanged');
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||typeof depth!=='boolean')return status(false,'invalid_size_or_depth','unchanged');
  try{
   if(target&&(target.width!==width||target.height!==height))release();
   let changed=false;
   if(!target){
    target=new THREE.WebGLRenderTarget(width,height,{depthBuffer:false,stencilBuffer:false,samples:0,format:THREE.RGBAFormat,type:THREE.UnsignedByteType});
    target.texture.colorSpace=THREE.NoColorSpace;target.texture.userData.unoneScreenEncoded=true;created++;changed=true;
   }
   bindTarget();
   if(depth&&!depthBuffer){
    // A depth renderbuffer is attached only while the transaction needs depth;
    // this shares the existing colour target rather than allocating a second
    // full-screen image on a scene transition.
    depthBuffer=gl.createRenderbuffer();if(!depthBuffer)throw Error('depth_allocation_failed');
    gl.bindRenderbuffer(gl.RENDERBUFFER,depthBuffer);
    try{gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,width,height);
     gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depthBuffer);}
    finally{gl.bindRenderbuffer(gl.RENDERBUFFER,null);}
    depthCreated++;changed=true;
   }else if(!depth&&depthBuffer){deleteDepth();changed=true;}
   if(changed&&(lost()||gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE))throw Error('framebuffer_incomplete');
   active=true;lastFailure=null;return status(true,null,'unchanged');
  }catch(error){
   lastFailure=String(error?.message??error);try{release();}catch{/* preserve original diagnostic */}
   return status(false,lastFailure,'unchanged');
  }
 }
 function rebind(){if(!active||!target||lost())return false;bindTarget();return true;}
 function commit(){
  if(lost()){active=false;return status(false,'context_lost','unknown');}
  if(!active||!target)return status(false,'not_active','unchanged');
  if(renderer.getRenderTarget()!==target){active=false;return status(false,'target_changed','unchanged');}
  // Three owns the actual framebuffer; its pinned renderer exposes properties
  // and state as engine-internal contracts. No getParameter GPU round trip.
  const framebuffer=renderer.properties.get(target).__webglFramebuffer;
  if(!framebuffer||Array.isArray(framebuffer)){active=false;renderer.setRenderTarget(null);return status(false,'framebuffer_missing','unchanged');}
  const {width,height}=target,scissor=renderer.getScissorTest();active=false;
  let submitted=false;
  try{
   renderer.setRenderTarget(null);renderer.setScissorTest(false);
   // Three's FRAMEBUFFER binding updates DRAW_FRAMEBUFFER's cache but not its
   // READ_FRAMEBUFFER cache, although WebGL changes both actual bindings.
   // Synchronise the cache to null, then use an explicit READ binding for the
   // blit and restore null without leaving Three's cache stale.
   renderer.state.bindFramebuffer(gl.READ_FRAMEBUFFER,null);
   gl.bindFramebuffer(gl.READ_FRAMEBUFFER,framebuffer);
   renderer.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER,null);gl.readBuffer(gl.COLOR_ATTACHMENT0);
   submitted=true;gl.blitFramebuffer(0,0,width,height,0,0,width,height,gl.COLOR_BUFFER_BIT,gl.NEAREST);
   const glError=gl.getError();if(lost()||glError!==gl.NO_ERROR){lastFailure=`commit_failed:${glError}`;return status(false,lastFailure,'unknown');}
   commits++;lastFailure=null;return status(true,null,'submitted');
  }catch(error){lastFailure=String(error?.message??error);return status(false,lastFailure,submitted?'unknown':'unchanged');}
  finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,null);renderer.setScissorTest(scissor);}
 }
 function abort(){const contextLost=lost();if(active){active=false;aborts++;if(!contextLost)renderer.setRenderTarget(null);}return status(!contextLost,contextLost?'context_lost':null,contextLost?'unknown':'unchanged');}
 function contextLost(){invalidate();lastFailure='context_lost';}
 function dispose(){if(disposed)return;abort();release();lostTarget=null;disposed=true;}
 return {begin,rebind,commit,abort,contextLost,dispose,target:()=>active?target:null,metrics:()=>({active,disposed,epoch,allocated:!!target,depth_allocated:!!depthBuffer,width:target?.width??0,height:target?.height??0,created,released,depth_created:depthCreated,depth_released:depthReleased,commits,aborts,last_failure:lastFailure,color_bytes_estimate:target?target.width*target.height*4:0,depth_bytes_estimate:depthBuffer?target.width*target.height*4:0})};
}
