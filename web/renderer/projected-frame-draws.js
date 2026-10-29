import {createFrameMaterial,createFrameTexture,frameTextureKey} from './projected-frame-material.js';
import {projectedScissor} from '../shared/projected-geometry.js';
function sameArray(a,b){
 if(a.length!==b.length)return false;
 const x=new Uint32Array(a.buffer,a.byteOffset,a.byteLength/4),y=new Uint32Array(b.buffer,b.byteOffset,b.byteLength/4);
 for(let i=0;i<x.length;i++)if(x[i]!==y[i])return false;return true;
}
function sameGeometry(r,d){
 return r&&sameArray(r.mesh.geometry.getAttribute('clipPosition').data.array,d.data.vertices)
  &&sameArray(r.mesh.geometry.index.array,d.data.indices);
}
// Geometry decision for one draw against its previous record (same draw id): null = same bytes (reuse);
// 'update' = same f32x10 interleaved and u32 index element counts, so the existing buffers receive new
// owned arrays and Three re-uploads them in place (r179: bufferSubData for an unchanged byte size);
// 'build' = new id or changed lengths/layout, so a new geometry is built exactly as before.
function geometryPlan(r,d){
 if(!r)return {kind:'build',reason:null};
 const vertices=r.mesh.geometry.getAttribute('clipPosition').data,index=r.mesh.geometry.index;
 const vertexSame=sameArray(vertices.array,d.data.vertices),indexSame=sameArray(index.array,d.data.indices);
 if(vertexSame&&indexSame)return null;
 if(vertices.stride!==10||!(vertices.array instanceof Float32Array)||vertices.array.length!==d.data.vertices.length)return {kind:'build',reason:'vertex_length'};
 if(!(index.array instanceof Uint32Array)||index.array.length!==d.data.indices.length)return {kind:'build',reason:'index_length'};
 // Owned copies of only the changed arrays: decoder arrays may be edited in place by their caller.
 return {kind:'update',vertices,index,vertexArray:vertexSame?null:d.data.vertices.slice(),indexArray:indexSame?null:d.data.indices.slice()};
}
// Resource ownership is separate from frame identity and draw order.
function createResources(THREE){
 let geometryBuilds=0,materialBuilds=0,geometryDisposes=0,materialDisposes=0,buildBytes=0;
 const freeGeometry=g=>{g.dispose();geometryDisposes++;},freeMaterial=m=>{m.dispose();materialDisposes++;};
 function geometry(d){
  const g=new THREE.BufferGeometry(),interleaved=new THREE.InterleavedBuffer(d.data.vertices.slice(),10);geometryBuilds++;
  try{
   g.setAttribute('clipPosition',new THREE.InterleavedBufferAttribute(interleaved,4,0));
   g.setAttribute('position',new THREE.InterleavedBufferAttribute(interleaved,3,0));
   g.setAttribute('uv',new THREE.InterleavedBufferAttribute(interleaved,2,4));
   g.setAttribute('linearRgba',new THREE.InterleavedBufferAttribute(interleaved,4,6));
   g.setIndex(new THREE.BufferAttribute(d.data.indices.slice(),1));buildBytes+=d.data.vertices.byteLength+d.data.indices.byteLength;return g;
  }catch(error){freeGeometry(g);throw error;}
 }
 function material(d){const m=createFrameMaterial(THREE,d.material);materialBuilds++;return m;}
 return {geometry,material,freeGeometry,freeMaterial,
  dispose(rows){for(const r of rows){freeGeometry(r.mesh.geometry);freeMaterial(r.mesh.material);}},
  metrics:()=>({frame_geometry_builds:geometryBuilds,frame_geometry_build_bytes:buildBytes,frame_material_builds:materialBuilds,
   frame_geometry_disposes:geometryDisposes,frame_material_disposes:materialDisposes,
   frame_live_geometries:geometryBuilds-geometryDisposes,frame_live_materials:materialBuilds-materialDisposes})};
}
// Texture variants are staged, then committed only after geometry/material staging succeeds.
function createFrameTextures(THREE){
 const variants=new Map(),epochs=new Map();let builds=0,disposes=0;
 const free=t=>{t.dispose();disposes++;};
 const current=s=>{const r=epochs.get(s);return r&&r.version===s.version&&r.sourceVersion===s.source?.version&&r.image===s.image;};
 function discard(plan){for(const r of plan.created)free(r.texture);}
 function plan(frame,sources){
  const result={created:[],textures:[]},pending=new Map(),valid=new Map();
  try{for(let i=0;i<frame.draws.length;i++){
   const source=sources[i].texture,sampler=frame.draws[i].material.sampler,key=frameTextureKey(sampler);
   if(!valid.has(source))valid.set(source,current(source));
   let record=pending.get(source)?.get(key)??(valid.get(source)?variants.get(source)?.get(key):undefined);
   if(!record){
    const texture=createFrameTexture(THREE,source,sampler);builds++;
    record={source,key,texture};
    result.created.push(record);if(!pending.has(source))pending.set(source,new Map());pending.get(source).set(key,record);
   }
   result.textures.push(record.texture);
  }}catch(error){discard(result);throw error;}return result;
 }
 function commit(plan){
  for(const r of plan.created){
   if(!variants.has(r.source))variants.set(r.source,new Map());
   const map=variants.get(r.source),old=map.get(r.key);if(old)free(old.texture);map.set(r.key,r);
  }
  const used=new Set(plan.textures);
  for(const [source,map] of variants){for(const [key,r] of map)if(!used.has(r.texture)){free(r.texture);map.delete(key);}if(!map.size)variants.delete(source);}
  // Cloning sets needsUpdate on the shared THREE.Source. Snapshot after all variants,
  // so one sampler's own upload does not invalidate another sampler next frame.
  for(const source of epochs.keys())if(!variants.has(source))epochs.delete(source);
  for(const source of variants.keys())epochs.set(source,{version:source.version,sourceVersion:source.source?.version,image:source.image});
 }
 return {plan,commit,discard,clear(){for(const map of variants.values())for(const r of map.values())free(r.texture);variants.clear();epochs.clear();},
  metrics:()=>({frame_texture_builds:builds,frame_texture_disposes:disposes,frame_live_textures:builds-disposes})};
}
function createFrameRecords(THREE,resources){
 let records=[];
 const counts={geometryReuses:0,materialReuses:0,updates:0,vertexBytes:0,indexBytes:0,fallbacks:0,vertexLength:0,indexLength:0};
 function stage(d,old,signature){
  const {sampler,...shaderState}=d.material,materialKey=JSON.stringify(shaderState),plan=geometryPlan(old,d);let g,m;
  try{
   if(plan?.kind==='build')g=resources.geometry(d);
   if(!old||old.materialKey!==materialKey)m=resources.material(d);
   let fresh;
   if(!old){const mesh=new THREE.Mesh(g,m),scene=new THREE.Scene();mesh.frustumCulled=false;scene.add(mesh);fresh={mesh,scene,id:d.id};}
   return {old,fresh,id:d.id,signature,materialKey,geometry:g,material:m,
    update:plan?.kind==='update'?plan:null,fallback:old&&plan?.kind==='build'?plan.reason:null};
  }catch(error){if(g)resources.freeGeometry(g);if(m)resources.freeMaterial(m);throw error;}
 }
 const discard=pending=>{for(const r of pending){if(r.geometry)resources.freeGeometry(r.geometry);if(r.material)resources.freeMaterial(r.material);}};
 function stageFrame(frame,signatures){
  const previous=new Map(records.map(r=>[r.id,r])),pending=[];
  try{for(let i=0;i<frame.draws.length;i++)pending.push(stage(frame.draws[i],previous.get(frame.draws[i].id),signatures[i]));}
  catch(error){discard(pending);throw error;}
  return {previous,pending};
 }
 // Every reference assignment is recorded for undo; replaced resources are only collected here.
 function assign(p,undo,retired){
  const set=(o,k,v)=>{undo.push([o,k,o[k]]);o[k]=v;},r=p.old??p.fresh,u=p.update;
  if(u?.vertexArray){set(u.vertices,'array',u.vertexArray);u.vertices.needsUpdate=true;}
  if(u?.indexArray){set(u.index,'array',u.indexArray);u.index.needsUpdate=true;}
  if(p.old&&p.geometry){retired.push(['geometry',r.mesh.geometry]);set(r.mesh,'geometry',p.geometry);}
  if(p.old&&p.material){retired.push(['material',r.mesh.material]);set(r.mesh,'material',p.material);}
  set(r,'signature',p.signature);set(r,'materialKey',p.materialKey);
  return r;
 }
 function count(p){
  if(!p.old)return;
  if(p.update){counts.updates++;counts.vertexBytes+=p.update.vertexArray?.byteLength??0;counts.indexBytes+=p.update.indexArray?.byteLength??0;}
  else if(!p.geometry)counts.geometryReuses++;
  if(p.fallback){counts.fallbacks++;counts[p.fallback==='vertex_length'?'vertexLength':'indexLength']++;}
  if(!p.material)counts.materialReuses++;
 }
 // A failure while assigning restores every reference and frees staged resources: the previous frame
 // stays renderable. A needsUpdate already raised before the failure only re-uploads the restored bytes.
 // Replaced geometry/materials and removed records are disposed only after the whole commit succeeded.
 function commit({previous,pending}){
  const undo=[],retired=[],next=[];
  try{for(const p of pending){if(p.old)previous.delete(p.id);next.push(assign(p,undo,retired));}}
  catch(error){for(let i=undo.length-1;i>=0;i--){const [o,k,v]=undo[i];o[k]=v;}discard(pending);throw error;}
  pending.forEach(count);records=next;
  for(const [kind,x] of retired)kind==='geometry'?resources.freeGeometry(x):resources.freeMaterial(x);
  resources.dispose([...previous.values()]);
 }
 return {stage:stageFrame,commit,list:()=>records,clear(){resources.dispose(records);records=[];},
  metrics:()=>({frame_geometry_reuses:counts.geometryReuses,frame_material_reuses:counts.materialReuses,
   frame_geometry_updates:counts.updates,frame_geometry_vertex_update_bytes:counts.vertexBytes,frame_geometry_index_update_bytes:counts.indexBytes,
   frame_geometry_update_fallbacks:counts.fallbacks,frame_geometry_fallback_vertex_length:counts.vertexLength,frame_geometry_fallback_index_length:counts.indexLength})};
}
export function createFrameDraws(THREE,textureFor){
 const resources=createResources(THREE),textures=createFrameTextures(THREE),records=createFrameRecords(THREE,resources);
 let revision=null,signatures=[],rebuilds=0;
 function prepare(frame,specs){
  const ids=new Set();for(const d of frame.draws){if(ids.has(d.id))throw Error('PROJECTED_FRAME_DUPLICATE_ID');ids.add(d.id);}
  const sources=frame.draws.map(d=>{const spec=specs.get(d.texture);if(spec?.kind!=='texture2d')throw Error('PROJECTED_FRAME_TEXTURE_MISSING: '+d.texture);
   const r=textureFor(spec);if(!r)throw Error('PROJECTED_FRAME_TEXTURE_LOADER_MISSING');if(r.error)throw r.error;return r;});
  if(sources.some(s=>s.state!=='ready'))return false;
  // A new Core revision1 and in-place decoded-array edits both require content validation.
  const next=frame.draws.map(d=>[d.id,d.texture,d.clip_policy,JSON.stringify(d.material),JSON.stringify(d.scissor??null),d.vertices,d.indices]);
  const old=records.list(),same=signatures.length===next.length&&signatures.every((r,i)=>r.every((v,k)=>v===next[i][k])&&sameGeometry(old[i],frame.draws[i]));
  const plan=textures.plan(frame,sources);
  if(revision!==String(frame.revision)||!same){
   let staged;try{staged=records.stage(frame,next);}catch(error){textures.discard(plan);throw error;}
   try{records.commit(staged);}catch(error){textures.discard(plan);throw error;}revision=String(frame.revision);signatures=next;rebuilds++;
  }
  textures.commit(plan);
  records.list().forEach((r,i)=>{r.scissor=frame.draws[i].scissor;r.mesh.material.uniforms.frameTexture.value=plan.textures[i];});
  return true;
 }
 return {prepare,
  draw(renderer,camera,width,height){const ratio=renderer.getPixelRatio();
   for(const r of records.list()){const s=projectedScissor(r.scissor,width,height);if(!s)continue;
    renderer.setScissor(s.x/ratio,s.y/ratio,s.width/ratio,s.height/ratio);renderer.setScissorTest(true);renderer.render(r.scene,camera);}},
  clear(){records.clear();textures.clear();revision=null;signatures=[];},
  metrics:()=>({frame_draws:records.list().length,frame_rebuilds:rebuilds,...resources.metrics(),...records.metrics(),...textures.metrics()})};
}
