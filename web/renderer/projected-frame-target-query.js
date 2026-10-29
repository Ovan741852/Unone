import {FRAME_FULLSCREEN_VERTEX,FRAME_SIZE_FRAGMENT} from './projected-frame-shaders.js';
const unsupported=s=>{throw Error('PROJECTED_FRAME_ATTACHMENT_UNSUPPORTED: '+s);};
export function assertFrameGpuError(gl,stage){
 const error=gl.getError();
 if(error!==gl.NO_ERROR)unsupported(`stage=${stage} gl_error=0x${error.toString(16).padStart(4,'0')}`);
}
function attachment(gl,slot,name){
 const get=p=>{const value=gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,slot,gl['FRAMEBUFFER_ATTACHMENT_'+p]);
  assertFrameGpuError(gl,`attachment.${name}.${p}`);return value;};
 return {object:get('OBJECT_TYPE'),present:get('OBJECT_NAME')!==null,component:get('COMPONENT_TYPE'),
  red:get('RED_SIZE'),green:get('GREEN_SIZE'),blue:get('BLUE_SIZE'),alpha:get('ALPHA_SIZE'),
  depth:get('DEPTH_SIZE'),stencil:get('STENCIL_SIZE'),encoding:get('COLOR_ENCODING')};
}
export function inspectFrameAttachments(gl,depth=true){
 assertFrameGpuError(gl,'attachment.enter');
 const status=gl.checkFramebufferStatus(gl.FRAMEBUFFER);assertFrameGpuError(gl,'attachment.status');
 if(status!==gl.FRAMEBUFFER_COMPLETE)unsupported('incomplete FBO: 0x'+status.toString(16));
 const color=attachment(gl,gl.COLOR_ATTACHMENT0,'color');
 if(!color.present||color.object!==gl.TEXTURE||color.component!==gl.UNSIGNED_NORMALIZED||color.encoding!==gl.LINEAR||[color.red,color.green,color.blue,color.alpha].some(n=>n!==8))unsupported('actual RGBA8 UNORM linear attachment required');
 let d=null;if(depth){d=attachment(gl,gl.DEPTH_ATTACHMENT,'depth');
  if(!d.present||d.object!==gl.TEXTURE||d.component!==gl.FLOAT||d.depth!==32||d.stencil!==0)unsupported('actual DEPTH_COMPONENT32F required');}
 const samples=gl.getParameter(gl.SAMPLES);assertFrameGpuError(gl,'attachment.samples');
 if(samples!==0)unsupported('single sample target required');
 return {color:'rgba8_unorm',depth:depth?'depth_component32f':'absent',samples:0};
}
export function createFrameSizeQuery(THREE){
 const target=new THREE.WebGLRenderTarget(2,1,{depthBuffer:false,stencilBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,samples:0});
 target.texture.colorSpace=THREE.NoColorSpace;target.texture.internalFormat='RGBA8';
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),3));
 const material=new THREE.ShaderMaterial({vertexShader:FRAME_FULLSCREEN_VERTEX,fragmentShader:FRAME_SIZE_FRAGMENT,
  uniforms:{colorAttachment:{value:null},depthAttachment:{value:null}},depthTest:false,depthWrite:false,blending:THREE.NoBlending,toneMapped:false});
 const scene=new THREE.Scene(),mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;scene.add(mesh);
 let disposed=false;
 return {measure(renderer,camera,source,width,height){
  if(disposed)throw Error('PROJECTED_FRAME_DISPOSED');const gl=renderer.getContext(),ratio=renderer.getPixelRatio();
  assertFrameGpuError(gl,'size-query.enter');
  if(source===target)unsupported('query/source feedback');
  material.uniforms.colorAttachment.value=source.texture;material.uniforms.depthAttachment.value=source.depthTexture;
  renderer.setRenderTarget(target);assertFrameGpuError(gl,'size-query.bind');
  renderer.setViewport(0,0,2/ratio,1/ratio);renderer.setScissorTest(false);inspectFrameAttachments(gl,false);
  renderer.render(scene,camera);if(gl.isContextLost())return null;assertFrameGpuError(gl,'size-query.render');
  const pixels=new Uint8Array(8);renderer.readRenderTargetPixels(target,0,0,2,1,pixels);
  if(gl.isContextLost())return null;assertFrameGpuError(gl,'size-query.readback');
  const sizes=[0,4].map(i=>[pixels[i]+pixels[i+1]*256,pixels[i+2]+pixels[i+3]*256]);
  if(sizes.some(s=>s[0]!==width||s[1]!==height))unsupported('actual color/depth textureSize mismatch: '+JSON.stringify(sizes));
  return {color:sizes[0],depth:sizes[1],method:'GPU_textureSize_rgba8_readback'};
 },dispose(){if(disposed)return;disposed=true;target.dispose();geometry.dispose();material.dispose();}};
}
