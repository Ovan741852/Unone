import {assetCatalogSpecs} from '../shared/asset-encoding.js';
import {configureTexture} from './presentation3d.js';
import {spriteMaterialDescriptor,createSpriteMaterial} from './shader-materials.js';

const error=(code,detail='')=>Error(`${code}${detail?`: ${detail}`:''}`);
export function spriteResourceError(value){const text=String(value?.message??value??'SPRITE_RESOURCE_FAILED');let out='',bytes=0;for(let point of text){let cp=point.codePointAt(0);if(cp>=0xd800&&cp<=0xdfff){point='\ufffd';cp=0xfffd;}const n=cp<128?1:cp<2048?2:cp<65536?3:4;if(bytes+n>4096)break;out+=point;bytes+=n;}return out.trim()?out:'SPRITE_RESOURCE_FAILED';}
export function parseSpriteResourceBudget(value={max_bytes:64*1024*1024,max_entries:128}) {
 if(!value||typeof value!=='object'||Object.keys(value).some(k=>!['max_bytes','max_entries'].includes(k))
  ||!Number.isSafeInteger(value.max_bytes)||value.max_bytes<1||value.max_bytes>1073741824
  ||!Number.isSafeInteger(value.max_entries)||value.max_entries<1||value.max_entries>65536)throw error('SPRITE_RESOURCE_BUDGET_INVALID');
 return Object.freeze({...value});
}

/** Renderer-owned pool. Only `public` is exposed on the renderer. Public leases
 * carry no Texture/material/GL fields. A ready promise resolves metadata only;
 * readiness is always scoped to the current epoch. Uniform values are not keys.
 */
export function createSpriteResourcePool({THREE,renderer,getCatalog,getImages,budget,backend='webgl',onReset=()=>{},withPreparationTargets=fn=>fn()}) {
 const limits=parseSpriteResourceBudget(budget),entries=new Map(),requests=new Map(),privateLeases=new WeakMap(),updates=new Map(),appearanceUpdates=new Map();
 let epoch=1,stamp=0,disposed=false,available=true,reserved=0,builds=0,retired=0;
 const stageGeometry=new THREE.PlaneGeometry(1,1),stageCamera=new THREE.PerspectiveCamera();
 const queueLimit=4096;
 function event(id,value,map=updates){if(!map.has(id)&&map.size>=queueLimit)throw error('SPRITE_RECEIPT_QUEUE_FULL');map.set(id,value);}
 function publish(entry){for(const lease of entry.leases)if(lease.id&&!lease.released)event(lease.id,{id:lease.id,state:entry.state,epoch,bytes:entry.bytes,...(entry.error?{error:spriteResourceError(entry.error)}:{})});}
 function attemptAll(actions){let failure;for(const action of actions)try{action();}catch(error){failure??=error;}if(failure)throw failure;}
 function destroyGpu(entry){const material=entry.material,texture=entry.texture;entry.material=null;entry.texture=null;attemptAll([()=>material?.dispose(),()=>texture?.dispose()]);}
 function releasePayload(entry){const lease=entry.imageLease;entry.imageLease=null;reserved-=entry.bytes;entry.bytes=0;attemptAll([()=>destroyGpu(entry),()=>lease?.release()]);}
 function drop(entry){
  if(entry.retired)return;entry.retired=true;entry.generation++;
  if(entries.get(entry.key)===entry)entries.delete(entry.key);
  retired++;attemptAll([()=>entry.controller.abort(),()=>releasePayload(entry)]);
 }
 function makeRoom(bytes,extraEntry=0){
  for(const entry of [...entries.values()].filter(e=>!e.leases.size).sort((a,b)=>a.stamp-b.stamp)){
   if(reserved+bytes<=limits.max_bytes&&entries.size+extraEntry<=limits.max_entries)break;drop(entry);
  }
  if(reserved+bytes>limits.max_bytes||entries.size+extraEntry>limits.max_entries)throw error('SPRITE_RESOURCE_BUDGET_EXCEEDED');
 }
 function current(entry,generation){return !disposed&&!entry.retired&&entry.generation===generation&&entries.get(entry.key)===entry;}
 function compileMaterial(material){
  if(typeof renderer.compile!=='function')throw error('SPRITE_RESOURCE_COMPILE_UNAVAILABLE');
  const scene=new THREE.Scene();scene.add(new THREE.Mesh(stageGeometry,material));
  // In this pinned Three revision compile() defers link diagnostics until
  // first program use. Check after compile's render-state stack has unwound;
  // malformed shaders must fail preparation, never the first committed draw.
  withPreparationTargets(()=>{
   renderer.compile(scene,stageCamera);const program=renderer.properties?.get(material)?.currentProgram;
   if(typeof program?.getUniforms!=='function')throw error('SPRITE_RESOURCE_COMPILE_UNAVAILABLE');
   program.getUniforms();if(program.diagnostics?.runnable===false)throw error('SPRITE_RESOURCE_SHADER_COMPILE_FAILED');
  });
 }
 async function prepareGpu(entry,generation){
  const images=getImages(),metadata=await images.inspect(entry.asset,{signal:entry.controller.signal});
  if(!current(entry,generation))throw error('SPRITE_RESOURCE_CANCELLED');
  const bytes=metadata.width*metadata.height*4;
  if(!Number.isSafeInteger(bytes)||bytes<1)throw error('SPRITE_RESOURCE_DIMENSIONS_INVALID');
  if(backend!=='webgl'||typeof renderer.initTexture!=='function')throw error('SPRITE_RESOURCE_BACKEND_UNSUPPORTED');
  const cap=renderer.capabilities?.maxTextureSize;
  if(!Number.isSafeInteger(cap)||metadata.width>cap||metadata.height>cap)throw error('SPRITE_RESOURCE_TEXTURE_LIMIT');
  if(!entry.bytes){makeRoom(bytes);entry.bytes=bytes;reserved+=bytes;}
  if(!entry.imageLease)entry.imageLease=images.acquire(entry.asset);
  await entry.imageLease.promise;
  if(!current(entry,generation)||!available)throw error('SPRITE_RESOURCE_CANCELLED');
  const image=entry.imageLease.image;
  if(entry.imageLease.state!=='ready'||!image)throw entry.imageLease.error??error('SPRITE_IMAGE_NOT_READY');
  const width=image.naturalWidth??image.width,height=image.naturalHeight??image.height;
  const oriented=['jpeg','webp'].includes(metadata.format)&&width===metadata.height&&height===metadata.width;
  if(!oriented&&(width!==metadata.width||height!==metadata.height))throw error('SPRITE_RESOURCE_DIMENSIONS_CHANGED');
  entry.texture=new THREE.Texture(image);configureTexture(THREE,entry.texture);renderer.initTexture(entry.texture);
  entry.material=createSpriteMaterial(THREE,entry.descriptor,entry.texture);
  // Pinned Three's compileAsync owns an uncancellable timer that reads mutable
  // epoch properties. Synchronous compile safely retires on loss/cancellation.
  compileMaterial(entry.material);
  if(!current(entry,generation)||!available)throw error('SPRITE_RESOURCE_CANCELLED');
  entry.state='ready';entry.error=null;entry.epoch=epoch;builds++;publish(entry);
 }
 function launch(entry){
  entry.state='loading';entry.error=null;entry.epoch=epoch;const generation=++entry.generation;
  publish(entry);
  entry.promise=prepareGpu(entry,generation).then(()=>undefined,error=>{
   const failure=new Error(spriteResourceError(error));
   if(current(entry,generation)){entry.state='error';entry.error=failure;attemptAll([()=>releasePayload(entry),()=>publish(entry)]);}
   throw failure;
  });entry.promise.catch(()=>{});
 }
 function acquire(spec,{notify=false}={}) {
  if(disposed)throw error('SPRITE_RESOURCES_DISPOSED');
  if(!spec||typeof spec.asset!=='string'||!spec.asset)throw error('SPRITE_RESOURCE_INVALID');
  const catalog=getCatalog(),asset=assetCatalogSpecs(catalog).get(spec.asset);
  if(asset?.kind!=='texture2d')throw error('SPRITE_RESOURCE_ASSET_INVALID',spec.asset);
  const descriptor=spec.descriptor??spriteMaterialDescriptor(spec.material_id,spec.material);
  const key=JSON.stringify([catalog.generation,spec.asset,descriptor.signature]);
  let entry=entries.get(key);
  if(entry?.state==='error'){drop(entry);entry=null;}
  if(!entry){makeRoom(0,1);entry={key,asset:spec.asset,descriptor,leases:new Set(),state:'loading',bytes:0,error:null,epoch,generation:0,controller:new AbortController(),stamp:++stamp,retired:false};entries.set(key,entry);}
  return own(entry,notify?String(spec.id):null,!notify);
 }
 function own(entry,id,unmanaged=false){
  const state={entry,id,unmanaged,released:false};
  const lease=Object.freeze({get state(){return state.released?'released':entry.state;},get epoch(){return epoch;},get bytes(){return entry.bytes;},get error(){return entry.error?spriteResourceError(entry.error):null;},get readyPromise(){const expectedEpoch=epoch;const promise=Promise.resolve(entry.promise).then(()=>{if(state.released)throw error('SPRITE_RESOURCE_RELEASED');if(epoch!==expectedEpoch||entry.state!=='ready')throw error('SPRITE_RESOURCE_NOT_READY');return Object.freeze({epoch,bytes:entry.bytes});});promise.catch(()=>{});return promise;},release(){release(state);}});
  state.lease=lease;privateLeases.set(lease,state);entry.leases.add(state);entry.stamp=++stamp;
  if(!entry.promise&&available)launch(entry);else if(id)publish(entry);
  return lease;
 }
 function release(state){if(state.released)return;state.released=true;state.entry.leases.delete(state);state.entry.stamp=++stamp;if(state.id){if(requests.get(state.id)===state.lease)requests.delete(state.id);updates.delete(state.id);}if(state.entry.state!=='ready'&&!state.entry.leases.size)drop(state.entry);}
 function prepare(spec){
  if(!spec||typeof spec.id!=='string'||!spec.id.trim()||new TextEncoder().encode(spec.id).length>1024||Object.keys(spec).some(k=>!['id','asset','material_id','material'].includes(k)))throw error('SPRITE_RESOURCE_INVALID');
  const descriptor=spriteMaterialDescriptor(spec.material_id,spec.material),fingerprint=JSON.stringify([spec.asset,descriptor.id,descriptor.signature,descriptor.defaults]);
  const existing=requests.get(spec.id);if(existing){if(privateLeases.get(existing).fingerprint!==fingerprint)throw error('SPRITE_RESOURCE_ID_REDEFINED');return existing;}
  if(requests.size>=queueLimit)throw error('SPRITE_RESOURCE_HANDLE_LIMIT');
  const lease=acquire({...spec,descriptor},{notify:true});privateLeases.get(lease).fingerprint=fingerprint;requests.set(spec.id,lease);return lease;
 }
 function invalidate(){
  epoch++;available=false;updates.clear();appearanceUpdates.clear();const values=[...entries.values()];
  // Fence every entry before the first potentially throwing disposal hook.
  for(const entry of values){entry.generation++;entry.state='loading';entry.error=null;entry.promise=null;entry.epoch=epoch;}
  attemptAll(values.map(entry=>()=>attemptAll([()=>destroyGpu(entry),()=>publish(entry)])));
 }
 function reset(){
  if(disposed)return;let failure;try{onReset();}catch(error){failure=error;}
  epoch++;const values=[...entries.values()];
  for(const entry of values){for(const state of entry.leases)state.released=true;entry.leases.clear();}
  requests.clear();updates.clear();appearanceUpdates.clear();
  try{attemptAll(values.map(entry=>()=>drop(entry)));}catch(error){failure??=error;}finally{entries.clear();}
  if(failure)throw failure;
 }
 function takeUpdates(){
  const resources=[],appearances=[];
  for(const [id,value]of updates){updates.delete(id);resources.push(value);if(resources.length===256)break;}
  for(const [id,value]of appearanceUpdates){
   appearanceUpdates.delete(id);const {resource,...receipt}=value;appearances.push(receipt);if(appearances.length===256)break;
  }
  return {resources,appearances};
 }
 const publicApi=Object.freeze({prepare,reset,takeUpdates});
 return {public:publicApi,acquire,read(lease){const state=privateLeases.get(lease);return state&&!state.released&&!state.entry.retired?state.entry:null;},
  fromId(id){return requests.get(id);},retain(lease){const state=privateLeases.get(lease);if(!state||state.released||state.entry.retired)throw error('SPRITE_RESOURCE_RELEASED');return own(state.entry,null);},appearance(value){event(value.entity,value,appearanceUpdates);},
  contextLost:invalidate,contextRestored(){available=true;for(const entry of entries.values())if(entry.leases.size)launch(entry);},
  async ready(){await Promise.all([...entries.values()].filter(entry=>[...entry.leases].some(lease=>!lease.id)).map(entry=>entry.promise?.catch(error=>{
   if(error.message.startsWith('IMAGE_ASSET_DIMENSIONS_UNAVAILABLE')&&[...entry.leases].some(lease=>lease.unmanaged))return;throw error;
  })));},
  metrics(){let textures=0,images=0,pending=0,ready=0,errors=0;for(const e of entries.values()){if(e.texture)textures++;if(e.imageLease)images++;if(e.state==='loading')pending++;if(e.state==='ready')ready++;if(e.state==='error')errors++;}return {supported:true,epoch,entries:entries.size,handles:requests.size,live_textures:textures,image_leases:images,pending,ready,errors,cpu_reserved_bytes_estimate:reserved,gpu_reserved_bytes_estimate:reserved,builds,retired,limits,scope:'Managed sprite resources, conservative per-resource RGBA reservations; broker sharing, shader programs and other renderer owners are separate'};},
  dispose(){if(disposed)return;try{reset();}finally{disposed=true;stageGeometry.dispose();}},get epoch(){return epoch;}};
}
