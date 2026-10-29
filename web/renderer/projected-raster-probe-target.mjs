import {COPY_VERTEX,COPY_FRAGMENT} from './projected-raster-probe-shaders.mjs';
export function saveProbeState(THREE,renderer){
 return {target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace?.()??0,mip:renderer.getActiveMipmapLevel?.()??0,
  viewport:renderer.getViewport(new THREE.Vector4()),scissor:renderer.getScissor(new THREE.Vector4()),test:renderer.getScissorTest(),
  color:renderer.getClearColor(new THREE.Color()),alpha:renderer.getClearAlpha(),autoClear:renderer.autoClear};
}
export function restoreProbeState(renderer,s){
 renderer.setRenderTarget(s.target,s.face,s.mip);renderer.setViewport(s.viewport);renderer.setScissor(s.scissor);
 renderer.setScissorTest(s.test);renderer.setClearColor(s.color,s.alpha);renderer.autoClear=s.autoClear;
}
export function reflectedScissorRenderer(renderer,height){
 return new Proxy(renderer,{get(target,key){
  if(key==='setScissor')return (...v)=>v.length===4?target.setScissor(v[0],height/target.getPixelRatio()-v[1]-v[3],v[2],v[3]):target.setScissor(...v);
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 },set(target,key,value){return Reflect.set(target,key,value);}});
}
export function createProbeTarget(THREE,strategy){
 let target=null,generation=0,disposed=false;
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),3));
 const material=new THREE.ShaderMaterial({vertexShader:COPY_VERTEX,fragmentShader:COPY_FRAGMENT,
  uniforms:{encodedCoverage:{value:null},physicalHeight:{value:0},reflectRows:{value:strategy==='C'}},
  depthTest:false,depthWrite:false,blending:THREE.NoBlending,toneMapped:false});
 const scene=new THREE.Scene(),mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;scene.add(mesh);
 function ensure(width,height){
  if(disposed)throw Error('RASTER_PROBE_DISPOSED');
  if(target?.width===width&&target?.height===height)return target;
  // Three defaults are RGBA / UnsignedByte. Empty colorSpace is canonical NoColorSpace.
  target?.dispose();target=new THREE.WebGLRenderTarget(width,height,{depthBuffer:true,stencilBuffer:false,
   minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,generateMipmaps:false,samples:0});
  target.texture.colorSpace='';material.uniforms.encodedCoverage.value=target.texture;
  material.uniforms.physicalHeight.value=height;generation++;return target;
 }
 function compose(renderer,camera,width,height){
  const ratio=renderer.getPixelRatio();renderer.setRenderTarget(null);renderer.setViewport(0,0,width/ratio,height/ratio);
  renderer.setScissorTest(false);renderer.render(scene,camera);
 }
 return {ensure,compose,metrics:()=>({generation,physical_size:target?[target.width,target.height]:null}),
  invalidate(){target?.dispose();target=null;material.uniforms.encodedCoverage.value=null;},
  dispose(){if(disposed)return;disposed=true;target?.dispose();target=null;geometry.dispose();material.dispose();}};
}
