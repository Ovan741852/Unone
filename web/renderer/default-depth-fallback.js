// WebGL2 screen-encoded depth fallback for a default framebuffer created
// without depth. An ordinary Three render target changes output colour space;
// this binds a raw RGBA8 FBO while Three still sees its screen render target.
// This module belongs to the official renderer, not project/game code.
export function createDefaultDepthFallback(gl,renderer){
 let frame=null,epoch=0,disposed=false,active=false,created=0,released=0;
 const available=()=>!disposed&&!gl.isContextLost();
 function release(){const old=frame;frame=null;active=false;if(!old)return;
  try{gl.deleteFramebuffer(old.framebuffer);}finally{try{gl.deleteTexture(old.color);}finally{gl.deleteRenderbuffer(old.depth);released++;}}}
 function contextLost(){frame=null;active=false;epoch++;}
 function allocate(width,height){
  if(frame&&frame.width===width&&frame.height===height)return true;
  release();if(!available())return false;
  let framebuffer=null,color=null,depth=null,ok=false;
  try{
   framebuffer=gl.createFramebuffer();color=gl.createTexture();depth=gl.createRenderbuffer();if(!framebuffer||!color||!depth)return false;
   gl.bindTexture(gl.TEXTURE_2D,color);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
   gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
   gl.bindRenderbuffer(gl.RENDERBUFFER,depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,width,height);
   gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,color,0);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE||!available())return false;
   frame={framebuffer,color,depth,width,height,epoch};created++;ok=true;return true;
  }finally{
   if(!ok){if(framebuffer)gl.deleteFramebuffer(framebuffer);if(color)gl.deleteTexture(color);if(depth)gl.deleteRenderbuffer(depth);}
   renderer.resetState();
  }
 }
 function begin(width,height){
  if(!available()||renderer.getRenderTarget()!==null||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1)return false;
  try{if(!allocate(width,height))return false;renderer.state.bindFramebuffer(gl.FRAMEBUFFER,frame.framebuffer);active=true;return true;}
  catch{try{release();}finally{renderer.resetState();}return false;}
 }
 function rebind(){if(!active||!frame||!available()||frame.epoch!==epoch)return false;renderer.state.bindFramebuffer(gl.FRAMEBUFFER,frame.framebuffer);return true;}
 // Preserve an already postprocessed screen before drawing projected geometry
 // whose own depth must be tested. With a hidden world no prior depth exists;
 // only colour is seeded and this target's depth is freshly cleared.
 function seedFromDefault(){
  if(!active||!frame||!available()||frame.epoch!==epoch)return false;
  try{const {framebuffer,width,height}=frame;gl.bindFramebuffer(gl.READ_FRAMEBUFFER,null);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,framebuffer);gl.disable(gl.SCISSOR_TEST);
   gl.blitFramebuffer(0,0,width,height,0,0,width,height,gl.COLOR_BUFFER_BIT,gl.NEAREST);gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.depthMask(true);gl.clearDepth(1);gl.clear(gl.DEPTH_BUFFER_BIT);
   return available()&&gl.getError()===gl.NO_ERROR;
  }catch{return false;}finally{renderer.resetState();if(active&&frame&&available())renderer.state.bindFramebuffer(gl.FRAMEBUFFER,frame.framebuffer);}
 }
 function cancel(){active=false;renderer.resetState();}
 function commit(){
  if(!active||!frame||!available()||frame.epoch!==epoch){cancel();return false;}
  const {framebuffer,width,height}=frame;active=false;
  try{
   gl.bindFramebuffer(gl.READ_FRAMEBUFFER,framebuffer);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,null);gl.disable(gl.SCISSOR_TEST);gl.readBuffer(gl.COLOR_ATTACHMENT0);
   gl.blitFramebuffer(0,0,width,height,0,0,width,height,gl.COLOR_BUFFER_BIT,gl.NEAREST);
   return available()&&gl.getError()===gl.NO_ERROR;
  }catch{return false;}finally{renderer.resetState();}
 }
 return {begin,rebind,seedFromDefault,commit,cancel,release,contextLost,dispose(){if(disposed)return;disposed=true;release();},metrics(){return {active,allocated:!!frame,width:frame?.width??0,height:frame?.height??0,created,released,context_epoch:epoch};}};
}
