import {projectedEntries,projectedGeometryData,assertProjectedBackend,projectedScissor} from '../shared/projected-geometry.js';
export {projectedEntries,projectedGeometryData,assertProjectedBackend,projectedScissor};
import {PROJECTED_VERTEX_SHADER,PROJECTED_FRAGMENT_SHADER,projectedShaders} from './projected-raster-shaders.js';
export {PROJECTED_VERTEX_SHADER,PROJECTED_FRAGMENT_SHADER};
export function createProjectedRenderer(THREE,textureFor,{raster='host'}={}){
 const shaders=projectedShaders(raster);
 const scene=new THREE.Scene(),records=new Map(),textures=new Map();let rebuilds=0;
 function filteredTexture(source,filter,address){
  let variants=textures.get(source);if(!variants){variants=new Map();textures.set(source,variants);}
  const key=filter+':'+address;
  if(!variants.has(key)){const texture=source.clone(),mode=filter==='linear'?THREE.LinearFilter:THREE.NearestFilter;
   texture.wrapS=texture.wrapT=address==='repeat'?THREE.RepeatWrapping:THREE.ClampToEdgeWrapping;
   texture.minFilter=mode;texture.magFilter=mode;texture.generateMipmaps=false;texture.needsUpdate=true;variants.set(key,texture);}
  return variants.get(key);
 }
 const dispose=r=>{scene.remove(r.mesh);r.mesh.geometry.dispose();r.material.dispose();};
 function prepare(entries,specs){
  const alive=new Set(),usedTextures=new Set();
  for(let rank=0;rank<entries.length;rank++){
   const [id,d]=entries[rank],spec=specs.get(d.texture);
   if(spec?.kind!=='texture2d')throw Error(`PROJECTED_TEXTURE_MISSING: ${d.texture}`);
   const texture=textureFor(spec);if(!texture)throw Error(`PROJECTED_TEXTURE_LOADER_MISSING: ${d.texture}`);if(texture.error)throw texture.error;
   let r=records.get(id);
   if(r?.revision!==String(d.revision)){
    const data=projectedGeometryData(d),geometry=new THREE.BufferGeometry(),interleaved=new THREE.InterleavedBuffer(data.vertices,10);
    geometry.setAttribute('clipPosition',new THREE.InterleavedBufferAttribute(interleaved,4,0));
    geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(interleaved,3,0));
    geometry.setAttribute('uv',new THREE.InterleavedBufferAttribute(interleaved,2,4));
    geometry.setAttribute('linearRgba',new THREE.InterleavedBufferAttribute(interleaved,4,6));geometry.setIndex(new THREE.BufferAttribute(data.indices,1));
    if(r)dispose(r);
    const material=new THREE.ShaderMaterial({...shaders,
     uniforms:{projectedTexture:{value:null},projectedEncodedMode:{value:d.color_mode==='encoded'?1:0},projectedAlphaCutoff:{value:d.alpha_cutoff??.05},projectedAlphaStrict:{value:d.alpha_compare==='greater'?1:0},projectedEncodedSampling:{value:d.sampling_space==='encoded'&&d.filter==='linear'?1:0},projectedRepeatAddress:{value:d.address_mode==='repeat'?1:0}},side:THREE.DoubleSide,depthTest:true,depthFunc:d.depth_test?THREE.LessDepth:THREE.AlwaysDepth,depthWrite:d.depth_write,
     transparent:false,toneMapped:false,blending:THREE.NoBlending});
    const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;scene.add(mesh);
    r={mesh,material,revision:String(d.revision),triangles:d.index_count/3};records.set(id,r);rebuilds++;
   }
   r.mesh.renderOrder=rank;r.ready=texture.state==='ready';r.mesh.visible=r.ready;r.scissor=d.scissor;
   if(texture.state==='ready'){const selected=filteredTexture(texture.texture,d.filter??'nearest',d.address_mode??'clamp');r.material.uniforms.projectedTexture.value=selected;usedTextures.add(selected);}
   alive.add(id);
  }
  for(const [id,r] of records)if(!alive.has(id)){dispose(r);records.delete(id);}
  for(const [source,variants] of textures){for(const [filter,t] of variants)if(!usedTextures.has(t)){t.dispose();variants.delete(filter);}if(!variants.size)textures.delete(source);}
 }
 function draw(renderer,camera,clearDepth=false){
  if(!records.size)return;
  const old=renderer.autoClear,scissor=renderer.getScissor(new THREE.Vector4()),test=renderer.getScissorTest();
  const size=renderer.getDrawingBufferSize(new THREE.Vector2()),ratio=renderer.getPixelRatio();renderer.autoClear=false;
  for(const r of records.values()){
   const box=projectedScissor(r.scissor,size.x,size.y);r.mesh.visible=r.ready&&box!==null;
   r.mesh.onBeforeRender=()=>{if(box){renderer.setScissor(box.x/ratio,(size.y-box.y-box.height)/ratio,box.width/ratio,box.height/ratio);renderer.setScissorTest(true);}};
  }
  try{if(clearDepth){renderer.setScissorTest(false);renderer.clearDepth();}renderer.render(scene,camera);}
  finally{renderer.setScissor(scissor);renderer.setScissorTest(test);renderer.autoClear=old;}
 }
 return {prepare,draw,
  clear(){for(const r of records.values())dispose(r);records.clear();for(const variants of textures.values())for(const t of variants.values())t.dispose();textures.clear();},metrics(){return {projected_batches:records.size,projected_triangles:[...records.values()].reduce((n,r)=>n+r.triangles,0),projected_rebuilds:rebuilds};}};
}
