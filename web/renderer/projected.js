import {projectedEntries,projectedGeometryData,createProjectedGeometryDecoder,assertProjectedBackend,projectedScissor} from '../shared/projected-geometry.js';
export {projectedEntries,projectedGeometryData,assertProjectedBackend,projectedScissor};
import {PROJECTED_VERTEX_SHADER,PROJECTED_FRAGMENT_SHADER,projectedShaders} from './projected-raster-shaders.js';
export {PROJECTED_VERTEX_SHADER,PROJECTED_FRAGMENT_SHADER};
export function createProjectedRenderer(THREE,textureFor,{raster='host'}={}){
 const shaders=projectedShaders(raster),scene=new THREE.Scene(),textures=new Map(),decoder=createProjectedGeometryDecoder({copyGeometry:false});let records=new Map();
 let rebuilds=0,geometryBuilds=0,geometryDisposes=0,materialBuilds=0,materialDisposes=0,updates=0,vertexBytes=0,indexBytes=0;
 const freeGeometry=g=>{g.dispose();geometryDisposes++;},freeMaterial=m=>{m.dispose();materialDisposes++;};
 const dispose=r=>{scene.remove(r.mesh);freeGeometry(r.mesh.geometry);freeMaterial(r.material);};
 function filteredTexture(source,filter,address,created){
  let variants=textures.get(source);if(!variants){variants=new Map();textures.set(source,variants);}const key=filter+':'+address;
  if(!variants.has(key)){
   let texture;try{texture=source.clone();const mode=filter==='linear'?THREE.LinearFilter:THREE.NearestFilter;
    texture.wrapS=texture.wrapT=address==='repeat'?THREE.RepeatWrapping:THREE.ClampToEdgeWrapping;
    texture.minFilter=mode;texture.magFilter=mode;texture.generateMipmaps=false;texture.needsUpdate=true;variants.set(key,texture);created.push({source,key,texture});
   }catch(error){texture?.dispose();if(!variants.size)textures.delete(source);throw error;}
  }
  return variants.get(key);
 }
 function discardTextures(created){for(const {source,key,texture}of created){texture.dispose();const variants=textures.get(source);if(variants?.get(key)===texture)variants.delete(key);if(!variants?.size)textures.delete(source);}}
 function geometry(data){
  const g=new THREE.BufferGeometry();geometryBuilds++;
  try{const interleaved=new THREE.InterleavedBuffer(data.vertices.slice(),10);
   g.setAttribute('clipPosition',new THREE.InterleavedBufferAttribute(interleaved,4,0));g.setAttribute('position',new THREE.InterleavedBufferAttribute(interleaved,3,0));
   g.setAttribute('uv',new THREE.InterleavedBufferAttribute(interleaved,2,4));g.setAttribute('linearRgba',new THREE.InterleavedBufferAttribute(interleaved,4,6));g.setIndex(new THREE.BufferAttribute(data.indices.slice(),1));return g;
  }catch(error){freeGeometry(g);throw error;}
 }
 const materialKey=d=>JSON.stringify([d.depth_test,d.depth_write,d.color_mode??'linear',d.alpha_cutoff??.05,d.alpha_compare??'greater_equal',d.sampling_space==='encoded'&&d.filter==='linear',d.address_mode??'clamp',d.blend??'opaque',d.filter??'nearest']);
 function material(d){
  const sourceOver=d.blend==='source_over',m=new THREE.ShaderMaterial({...shaders,
   uniforms:{projectedTexture:{value:null},projectedEncodedMode:{value:d.color_mode==='encoded'?1:0},projectedAlphaCutoff:{value:d.alpha_cutoff??.05},projectedAlphaStrict:{value:d.alpha_compare==='greater'?1:0},projectedEncodedSampling:{value:d.sampling_space==='encoded'&&d.filter==='linear'?1:0},projectedRepeatAddress:{value:d.address_mode==='repeat'?1:0},projectedSourceOver:{value:sourceOver?1:0},projectedLinearFiltering:{value:d.filter==='linear'?1:0}},
   side:THREE.DoubleSide,depthTest:true,depthFunc:d.depth_test?THREE.LessDepth:THREE.AlwaysDepth,depthWrite:d.depth_write,
   // Keep both modes in one authored rank queue; the transparent queue moves
   // translucent draws after later opaque draws regardless of their rank.
   transparent:false,toneMapped:false,...(sourceOver?{blending:THREE.CustomBlending,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneMinusSrcAlphaFactor,premultipliedAlpha:false}:{blending:THREE.NoBlending})});
  materialBuilds++;return m;
 }
 function stage({id,d,data,texture,rank},created){
  const old=records.get(id),key=materialKey(d),changed=!old||old.vertices!==d.vertices||old.indices!==d.indices||old.vertexCount!==d.vertex_count||old.indexCount!==d.index_count;
  let g,m,update=null;
  try{
   if(changed){
    const vertices=old?.mesh.geometry.getAttribute('clipPosition').data,index=old?.mesh.geometry.index;
    if(old&&vertices.stride===10&&vertices.array instanceof Float32Array&&index.array instanceof Uint32Array&&vertices.array.length===data.vertices.length&&index.array.length===data.indices.length)
     update={vertices,index,vertexArray:old.vertices===d.vertices?null:data.vertices.slice(),indexArray:old.indices===d.indices?null:data.indices.slice()};
    else g=geometry(data);
   }
   if(!old||old.materialKey!==key)m=material(d);
   let fresh;if(!old){const mesh=new THREE.Mesh(g,m);mesh.frustumCulled=false;fresh={mesh,material:m};
    mesh.onBeforeRender=()=>{const box=fresh.drawBox;if(box){fresh.drawRenderer.setScissor(box.x/fresh.drawRatio,(fresh.drawHeight-box.y-box.height)/fresh.drawRatio,box.width/fresh.drawRatio,box.height/fresh.drawRatio);fresh.drawRenderer.setScissorTest(true);}};}
   const selected=texture.state==='ready'?filteredTexture(texture.texture,d.filter??'nearest',d.address_mode??'clamp',created):null;
   return {old,fresh,d,rank,id,key,geometry:g,material:m,update,selected,changed:changed||!!m};
  }catch(error){if(g)freeGeometry(g);if(m)freeMaterial(m);throw error;}
 }
 const discard=pending=>{for(const p of pending){if(p.geometry)freeGeometry(p.geometry);if(p.material)freeMaterial(p.material);}};
 function commit(pending){
  const undo=[],retired=[],added=[],next=new Map(),set=(object,key,value)=>{if(object[key]===value)return;undo.push([object,key,object[key]]);object[key]=value;};
  try{for(const p of pending){
   const r=p.old??p.fresh,u=p.update,d=p.d;
   if(u?.vertexArray){set(u.vertices,'array',u.vertexArray);u.vertices.needsUpdate=true;}
   if(u?.indexArray){set(u.index,'array',u.indexArray);u.index.needsUpdate=true;}
   if(p.old&&p.geometry){retired.push(['geometry',r.mesh.geometry]);set(r.mesh,'geometry',p.geometry);}
   if(p.old&&p.material){retired.push(['material',r.material]);set(r,'material',p.material);set(r.mesh,'material',p.material);}
   set(r,'revision',String(d.revision));set(r,'vertices',d.vertices);set(r,'indices',d.indices);set(r,'vertexCount',d.vertex_count);set(r,'indexCount',d.index_count);set(r,'materialKey',p.key);set(r,'triangles',d.index_count/3);
   set(r.mesh,'renderOrder',p.rank);set(r,'ready',p.selected!==null);set(r.mesh,'visible',p.selected!==null);set(r,'scissor',d.scissor);
   set(r.material.uniforms.projectedTexture,'value',p.selected);next.set(p.id,r);
  }
  for(const p of pending)if(p.fresh){added.push(p.fresh.mesh);scene.add(p.fresh.mesh);}
  }catch(error){for(const mesh of added)scene.remove(mesh);for(let i=undo.length-1;i>=0;i--){const [object,key,value]=undo[i];object[key]=value;}throw error;}
  for(const [id,r]of records)if(!next.has(id))dispose(r);records=next;
  for(const [kind,value]of retired)kind==='geometry'?freeGeometry(value):freeMaterial(value);
  for(const p of pending){if(p.changed)rebuilds++;if(p.update){updates++;vertexBytes+=p.update.vertexArray?.byteLength??0;indexBytes+=p.update.indexArray?.byteLength??0;}}
 }
 function prepare(entries,specs){
  const ids=new Set();for(const [id,d]of entries){if(ids.has(id))throw Error('PROJECTED_INVALID: duplicate batch id');ids.add(id);
   if(d.blend==='source_over'){
    if(raster!=='host')throw Error('PROJECTED_BLEND_UNSUPPORTED: source_over requires raster=host');
    if(d.depth_test!==false||d.depth_write!==false)throw Error('PROJECTED_INVALID: source_over requires depth_test=false and depth_write=false');
   }
  }
  // Decode/validate every changed payload and preflight all sources before any
  // existing resource changes. The private decoder checks both full strings,
  // counts and revision before reusing arrays across redraws.
  const candidates=entries.map(([id,d],rank)=>{
   const data=decoder.geometry(d),spec=specs.get(d.texture);if(spec?.kind!=='texture2d')throw Error('PROJECTED_TEXTURE_MISSING: '+d.texture);
   const texture=textureFor(spec);if(!texture)throw Error('PROJECTED_TEXTURE_LOADER_MISSING: '+d.texture);if(texture.error)throw texture.error;
   return {id,d,data,texture,rank};
  }),pending=[],created=[];
  try{for(const candidate of candidates)pending.push(stage(candidate,created));commit(pending);}
  catch(error){discard(pending);discardTextures(created);throw error;}
  const usedTextures=new Set(pending.map(p=>p.selected));
  for(const [source,variants]of textures){for(const [key,t]of variants)if(!usedTextures.has(t)){t.dispose();variants.delete(key);}if(!variants.size)textures.delete(source);}
 }
 function draw(renderer,camera,clearDepth=false){
  if(!records.size)return;
  const old=renderer.autoClear,scissor=renderer.getScissor(new THREE.Vector4()),test=renderer.getScissorTest();
  const size=renderer.getDrawingBufferSize(new THREE.Vector2()),ratio=renderer.getPixelRatio();renderer.autoClear=false;
  for(const r of records.values()){
   const box=projectedScissor(r.scissor,size.x,size.y);r.mesh.visible=r.ready&&box!==null;r.drawBox=box;r.drawRenderer=renderer;r.drawRatio=ratio;r.drawHeight=size.y;
  }
  try{if(clearDepth){renderer.setScissorTest(false);renderer.clearDepth();}renderer.render(scene,camera);}
  finally{renderer.setScissor(scissor);renderer.setScissorTest(test);renderer.autoClear=old;}
 }
 return {prepare,draw,entries:decoder.entries,
  clear(){for(const r of records.values())dispose(r);records.clear();for(const variants of textures.values())for(const t of variants.values())t.dispose();textures.clear();decoder.clear();},
  metrics(){return {projected_batches:records.size,projected_triangles:[...records.values()].reduce((n,r)=>n+r.triangles,0),projected_rebuilds:rebuilds,...decoder.metrics(),
   projected_geometry_builds:geometryBuilds,projected_geometry_disposes:geometryDisposes,projected_live_geometries:geometryBuilds-geometryDisposes,
   projected_material_builds:materialBuilds,projected_material_disposes:materialDisposes,projected_live_materials:materialBuilds-materialDisposes,
   projected_geometry_updates:updates,projected_vertex_update_bytes:vertexBytes,projected_index_update_bytes:indexBytes};}};
}
