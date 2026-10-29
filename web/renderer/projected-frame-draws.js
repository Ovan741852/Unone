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
// Resource ownership is separate from frame identity and draw order.
function createResources(THREE){
 let geometryBuilds=0,materialBuilds=0,geometryDisposes=0,materialDisposes=0;
 const freeGeometry=g=>{g.dispose();geometryDisposes++;},freeMaterial=m=>{m.dispose();materialDisposes++;};
 function geometry(d){
  const g=new THREE.BufferGeometry(),interleaved=new THREE.InterleavedBuffer(d.data.vertices.slice(),10);geometryBuilds++;
  try{
   g.setAttribute('clipPosition',new THREE.InterleavedBufferAttribute(interleaved,4,0));
   g.setAttribute('position',new THREE.InterleavedBufferAttribute(interleaved,3,0));
   g.setAttribute('uv',new THREE.InterleavedBufferAttribute(interleaved,2,4));
   g.setAttribute('linearRgba',new THREE.InterleavedBufferAttribute(interleaved,4,6));
   g.setIndex(new THREE.BufferAttribute(d.data.indices.slice(),1));return g;
  }catch(error){freeGeometry(g);throw error;}
 }
 function material(d){const m=createFrameMaterial(THREE,d.material);materialBuilds++;return m;}
 return {geometry,material,freeGeometry,freeMaterial,
  dispose(rows){for(const r of rows){freeGeometry(r.mesh.geometry);freeMaterial(r.mesh.material);}},
  metrics:()=>({frame_geometry_builds:geometryBuilds,frame_material_builds:materialBuilds,
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
 let records=[],geometryReuses=0,materialReuses=0;
 function stage(d,old,signature){
  const {sampler,...shaderState}=d.material,materialKey=JSON.stringify(shaderState);let g,m;
  try{
   if(!sameGeometry(old,d))g=resources.geometry(d);
   if(!old||old.materialKey!==materialKey)m=resources.material(d);
   let fresh;
   if(!old){const mesh=new THREE.Mesh(g,m),scene=new THREE.Scene();mesh.frustumCulled=false;scene.add(mesh);fresh={mesh,scene,id:d.id};}
   return {old,fresh,id:d.id,signature,materialKey,geometry:g,material:m};
  }catch(error){if(g)resources.freeGeometry(g);if(m)resources.freeMaterial(m);throw error;}
 }
 function stageFrame(frame,signatures){
  const previous=new Map(records.map(r=>[r.id,r])),pending=[];
  try{for(let i=0;i<frame.draws.length;i++)pending.push(stage(frame.draws[i],previous.get(frame.draws[i].id),signatures[i]));}
  catch(error){for(const r of pending){if(r.geometry)resources.freeGeometry(r.geometry);if(r.material)resources.freeMaterial(r.material);}throw error;}
  return {previous,pending};
 }
 function commit({previous,pending}){
  const next=[];
  for(const p of pending){
   let r=p.old;
   if(r){
    previous.delete(p.id);
    if(p.geometry){resources.freeGeometry(r.mesh.geometry);r.mesh.geometry=p.geometry;}else geometryReuses++;
    if(p.material){resources.freeMaterial(r.mesh.material);r.mesh.material=p.material;}else materialReuses++;
   }else r=p.fresh;
   r.signature=p.signature;r.materialKey=p.materialKey;next.push(r);
  }
  resources.dispose([...previous.values()]);records=next;
 }
 return {stage:stageFrame,commit,list:()=>records,clear(){resources.dispose(records);records=[];},
  metrics:()=>({frame_geometry_reuses:geometryReuses,frame_material_reuses:materialReuses})};
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
   records.commit(staged);revision=String(frame.revision);signatures=next;rebuilds++;
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
