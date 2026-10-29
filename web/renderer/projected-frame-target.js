import {FRAME_FULLSCREEN_VERTEX,FRAME_INITIAL_FRAGMENT,FRAME_COPY_FRAGMENT} from './projected-frame-shaders.js';
import {inspectFrameAttachments,createFrameSizeQuery,assertFrameGpuError} from './projected-frame-target-query.js';
export function createFrameTarget(THREE){
 let target=null,generation=0,verified=null,disposed=false;
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),3));
 const initial=new THREE.ShaderMaterial({vertexShader:FRAME_FULLSCREEN_VERTEX,fragmentShader:FRAME_INITIAL_FRAGMENT,
  uniforms:{initialRgb:{value:new THREE.Vector3()},initialDepth:{value:1}},depthTest:true,depthFunc:THREE.AlwaysDepth,depthWrite:true,blending:THREE.NoBlending,toneMapped:false});
 const copy=new THREE.ShaderMaterial({vertexShader:FRAME_FULLSCREEN_VERTEX,fragmentShader:FRAME_COPY_FRAGMENT,
  uniforms:{frameColorTexture:{value:null},physicalHeight:{value:0}},depthTest:false,depthWrite:false,blending:THREE.NoBlending,toneMapped:false});
 const scene=new THREE.Scene(),mesh=new THREE.Mesh(geometry,initial);mesh.frustumCulled=false;scene.add(mesh);
 const query=createFrameSizeQuery(THREE);
 function bind(renderer,t,width,height){const ratio=renderer.getPixelRatio();renderer.setRenderTarget(t);renderer.setViewport(0,0,width/ratio,height/ratio);renderer.setScissorTest(false);renderer.autoClear=false;}
 function invalidate(){target?.dispose();target=null;verified=null;copy.uniforms.frameColorTexture.value=null;}
 function ensure(renderer,camera,width,height){
  if(disposed)throw Error('PROJECTED_FRAME_DISPOSED');
  const gl=renderer.getContext();assertFrameGpuError(gl,'target.enter');
  const limit=gl.getParameter(gl.MAX_TEXTURE_SIZE);assertFrameGpuError(gl,'target.limit');
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<8||height<8||width>8192||height>8192||width*height>16777216||width>limit||height>limit)throw Error('PROJECTED_FRAME_TARGET_LIMIT: 8..8192 physical dimensions,16Mpx and GPU limit');
  if(target?.width!==width||target?.height!==height){
   invalidate();assertFrameGpuError(gl,'target.dispose');target=new THREE.WebGLRenderTarget(width,height,{depthBuffer:true,stencilBuffer:false,
    minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,generateMipmaps:false,samples:0});
   target.texture.colorSpace=THREE.NoColorSpace;target.texture.internalFormat='RGBA8';
   target.depthTexture=new THREE.DepthTexture(width,height,THREE.FloatType);target.depthTexture.format=THREE.DepthFormat;
   target.depthTexture.compareFunction=null;generation++;
   copy.uniforms.frameColorTexture.value=target.texture;copy.uniforms.physicalHeight.value=height;
  }
  bind(renderer,target,width,height);assertFrameGpuError(gl,'target.bind');
  if(!verified){const formats=inspectFrameAttachments(gl);const sizes=query.measure(renderer,camera,target,width,height);
   if(!sizes)return false;verified={...formats,physical_size:sizes.color,depth_size:sizes.depth,size_method:sizes.method};
   bind(renderer,target,width,height);assertFrameGpuError(gl,'target.rebind');}
  return true;
 }
 return {ensure,
  initialize(renderer,camera,content){initial.uniforms.initialRgb.value.set(...content.rgb8.map(n=>Math.fround(n/255)));initial.uniforms.initialDepth.value=content.depth;mesh.material=initial;renderer.setScissorTest(false);renderer.render(scene,camera);},
  compose(renderer,camera,width,height){bind(renderer,null,width,height);mesh.material=copy;renderer.render(scene,camera);},
  invalidate,metrics:()=>({generation,attachment:verified?structuredClone(verified):null}),
  dispose(){if(disposed)return;disposed=true;invalidate();geometry.dispose();initial.dispose();copy.dispose();query.dispose();}};
}
