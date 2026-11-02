import {assetCatalogSpecs} from '../shared/asset-encoding.js';
import {configureTexture} from './presentation3d.js';
import {spriteMaterialDescriptor,createSpriteMaterial} from './shader-materials.js';

const error=(code,detail='')=>Error(`${code}${detail?`: ${detail}`:''}`);
const SAMPLER_KEY='nearest-clamp-srgb-no-mips-v1';
export function spriteResourceError(value){const text=String(value?.message??value??'SPRITE_RESOURCE_FAILED');let out='',bytes=0;for(let point of text){let cp=point.codePointAt(0);if(cp>=0xd800&&cp<=0xdfff){point='\ufffd';cp=0xfffd;}const n=cp<128?1:cp<2048?2:cp<65536?3:4;if(bytes+n>4096)break;out+=point;bytes+=n;}return out.trim()?out:'SPRITE_RESOURCE_FAILED';}
export function parseSpriteResourceBudget(value={max_bytes:64*1024*1024,max_entries:128}) {
 if(!value||typeof value!=='object'||Object.keys(value).some(k=>!['max_bytes','max_entries'].includes(k))
  ||!Number.isSafeInteger(value.max_bytes)||value.max_bytes<1||value.max_bytes>1073741824
  ||!Number.isSafeInteger(value.max_entries)||value.max_entries<1||value.max_entries>65536)throw error('SPRITE_RESOURCE_BUDGET_INVALID');
 return Object.freeze({...value});
}

/** Material/program entries retain independent shared texture owners.
 * A private catalog + asset + fixed sampler identifies image/texture ownership;
 * source/type layout identifies material readiness. Uniform values are not keys.
 * The hard admission budget counts unique textures, not material variants.
 * Automatic appearances can hold a bounded, explicit idle-cache owner under
 * the same physical texture controller used by the ordinary renderer records.
 * Public leases expose metadata only; readiness is scoped to the current epoch.
 */
export function createSpriteResourcePool({THREE,renderer,getCatalog,getImages,budget,textureCache,backend='webgl',onReset=()=>{},withPreparationTargets=fn=>fn()}) {
 if(!textureCache||typeof textureCache.trackOwner!=='function'||typeof textureCache.reclaim!=='function')throw error('SPRITE_RESOURCE_CACHE_UNAVAILABLE');
 const limits=parseSpriteResourceBudget(budget),entries=new Map(),textures=new Map(),requests=new Map(),privateLeases=new WeakMap(),updates=new Map(),appearanceUpdates=new Map();
 let epoch=1,disposed=false,retiring=false,available=true,reserved=0,builds=0,retired=0,textureBuilds=0,textureRetired=0;
 const stageGeometry=new THREE.PlaneGeometry(1,1),stageCamera=new THREE.PerspectiveCamera();
 const queueLimit=4096;
 const cacheDomain=Object.freeze({}),idleMaterialLimit=Math.min(textureCache.policy.max_entries,queueLimit);
 let idleHead=null,idleTail=null,idleCount=0;
 function removeIdle(entry){if(!entry.cacheOwner)return;entry.cacheOwner=null;if(entry.idlePrevious)entry.idlePrevious.idleNext=entry.idleNext;else idleHead=entry.idleNext;if(entry.idleNext)entry.idleNext.idlePrevious=entry.idlePrevious;else idleTail=entry.idlePrevious;entry.idlePrevious=entry.idleNext=null;idleCount--;}
 function updatePin(owner){if(!owner||owner.retired||!owner.cacheTracked)return;let live=false;for(const entry of owner.entries)if(entry.leases.size){live=true;break;}textureCache.pinOwner(owner,live);}
 function evictIdleMaterial(entry){removeIdle(entry);if(!entry.leases.size)drop(entry);}
 function sweepIdleMaterials(){let failure;while(idleHead&&(idleCount>idleMaterialLimit||textureCache.frame-idleHead.lastAutoUse>=textureCache.policy.idle_frames))try{evictIdleMaterial(idleHead);}catch(error){failure??=error;}if(failure)throw failure;}
 function cacheAuto(entry){
  if(entry.cacheOwner||entry.retired||entry.state!=='ready'||disposed||retiring||!available)return;
  entry.cacheOwner=Object.freeze({});entry.idlePrevious=idleTail;entry.idleNext=null;if(idleTail)idleTail.idleNext=entry;else idleHead=entry;idleTail=entry;idleCount++;sweepIdleMaterials();
 }
 function clearIdleMaterials(){let failure;while(idleHead)try{evictIdleMaterial(idleHead);}catch(error){failure??=error;}if(failure)throw failure;}
 function retireCachedTexture(owner){
  owner.cacheTracked=false;const wasRetiring=retiring;retiring=true;
  const values=[...owner.entries];let failure;
  try{for(const entry of values)try{removeIdle(entry);if(entry.leases.size)throw error('SPRITE_RESOURCE_CACHE_PIN_VIOLATION');drop(entry);}catch(error){failure??=error;}}
  finally{retiring=wasRetiring;}
  if(failure)throw failure;
 }
 function event(id,value,map=updates){if(!map.has(id)&&map.size>=queueLimit)throw error('SPRITE_RECEIPT_QUEUE_FULL');map.set(id,value);}
 function publish(entry){for(const lease of entry.leases)if(lease.id&&!lease.released)event(lease.id,{id:lease.id,state:entry.state,epoch,bytes:entry.bytes,...(entry.error?{error:spriteResourceError(entry.error)}:{})});}
 function attemptAll(actions){let failure;for(const action of actions)try{action();}catch(error){failure??=error;}if(failure)throw failure;}
 function destroyMaterial(entry){const material=entry.material;entry.material=null;material?.dispose();}
 function destroyTextureBinding(owner){const texture=owner.texture;owner.texture=null;if(texture)textureRetired++;texture?.dispose();}
 function dropTexture(owner){
  if(owner.retired)return;owner.retired=true;owner.generation++;owner.state='released';
  if(textures.get(owner.key)===owner)textures.delete(owner.key);
  owner.cacheTracked=false;textureCache.untrackOwner(owner);
  const lease=owner.imageLease;owner.imageLease=null;reserved-=owner.bytes;owner.bytes=0;
  attemptAll([()=>owner.controller.abort(),()=>destroyTextureBinding(owner),()=>lease?.release()]);
 }
 function releaseTexture(entry){const owner=entry.textureOwner;entry.textureOwner=null;if(!owner)return;owner.entries.delete(entry);if(!owner.entries.size)dropTexture(owner);else updatePin(owner);}
 function releasePayload(entry){attemptAll([()=>destroyMaterial(entry),()=>releaseTexture(entry)]);}
 function drop(entry){
  if(entry.retired)return;removeIdle(entry);entry.retired=true;entry.generation++;
  if(entries.get(entry.key)===entry)entries.delete(entry.key);
  retired++;releasePayload(entry);
 }
 function textureRoom(bytes,extra=0){
  const fits=()=>reserved+bytes<=limits.max_bytes&&textures.size+extra<=limits.max_entries;
  if(!fits())textureCache.reclaim(fits,{eligible:key=>key?.cacheDomain===cacheDomain});
  if(!fits())throw error('SPRITE_RESOURCE_BUDGET_EXCEEDED');
 }
 function current(entry,generation){return !disposed&&!entry.retired&&entry.generation===generation&&entries.get(entry.key)===entry;}
 function currentTexture(owner,generation){return !disposed&&!owner.retired&&owner.generation===generation&&textures.get(owner.key)===owner;}
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
 async function prepareTexture(owner,generation){
  const images=getImages(),metadata=await images.inspect(owner.asset,{signal:owner.controller.signal});
  if(!currentTexture(owner,generation))throw error('SPRITE_RESOURCE_CANCELLED');
  const bytes=metadata.width*metadata.height*4;
  if(!Number.isSafeInteger(bytes)||bytes<1)throw error('SPRITE_RESOURCE_DIMENSIONS_INVALID');
  if(backend!=='webgl'||typeof renderer.initTexture!=='function')throw error('SPRITE_RESOURCE_BACKEND_UNSUPPORTED');
  const cap=renderer.capabilities?.maxTextureSize;
  if(!Number.isSafeInteger(cap)||metadata.width>cap||metadata.height>cap)throw error('SPRITE_RESOURCE_TEXTURE_LIMIT');
  if(!owner.bytes){textureRoom(bytes);owner.bytes=bytes;reserved+=bytes;}
  if(!owner.imageLease)owner.imageLease=images.acquire(owner.asset);
  await owner.imageLease.promise;
  if(!currentTexture(owner,generation)||!available)throw error('SPRITE_RESOURCE_CANCELLED');
  const image=owner.imageLease.image;
  if(owner.imageLease.state!=='ready'||!image)throw owner.imageLease.error??error('SPRITE_IMAGE_NOT_READY');
  const width=image.naturalWidth??image.width,height=image.naturalHeight??image.height;
  const oriented=['jpeg','webp'].includes(metadata.format)&&width===metadata.height&&height===metadata.width;
  if(!oriented&&(width!==metadata.width||height!==metadata.height))throw error('SPRITE_RESOURCE_DIMENSIONS_CHANGED');
  owner.texture=new THREE.Texture(image);configureTexture(THREE,owner.texture);renderer.initTexture(owner.texture);
  if(!currentTexture(owner,generation)||!available)throw error('SPRITE_RESOURCE_CANCELLED');
  owner.state='ready';owner.epoch=epoch;textureBuilds++;
 }
 function launchTexture(owner){
  owner.state='loading';owner.epoch=epoch;const generation=++owner.generation;
  owner.promise=prepareTexture(owner,generation).catch(cause=>{
   const failure=Error(spriteResourceError(cause));
   if(currentTexture(owner,generation)){try{dropTexture(owner);}catch{/* original preparation error remains authoritative after retirement */}}
   throw failure;
  });owner.promise.catch(()=>{});
 }
 function textureFor(entry){
  let owner=entry.textureOwner;
  if(!owner){
   owner=textures.get(entry.textureKey);
   if(!owner){textureRoom(0,1);owner={key:entry.textureKey,cacheDomain,asset:entry.asset,entries:new Set(),bytes:0,generation:0,epoch,state:'loading',retired:false,cacheTracked:false,controller:new AbortController(),promise:null};textureCache.trackOwner(owner,{bytes:()=>owner.texture?owner.bytes:0,loading:()=>owner.state==='loading',retire:()=>retireCachedTexture(owner)});owner.cacheTracked=true;textures.set(owner.key,owner);}
   owner.entries.add(entry);entry.textureOwner=owner;
   updatePin(owner);
  }
  if(!owner.promise&&available)launchTexture(owner);return owner;
 }
 async function prepareGpu(entry,generation){
  const owner=textureFor(entry);await owner.promise;
  if(!current(entry,generation)||!available||owner.retired||owner.state!=='ready')throw error('SPRITE_RESOURCE_CANCELLED');
  entry.material=createSpriteMaterial(THREE,entry.descriptor,owner.texture);
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
  if(retiring)throw error('SPRITE_RESOURCES_RETIRING');
  if(!spec||typeof spec.asset!=='string'||!spec.asset)throw error('SPRITE_RESOURCE_INVALID');
  const catalog=getCatalog(),asset=assetCatalogSpecs(catalog).get(spec.asset);
  if(asset?.kind!=='texture2d')throw error('SPRITE_RESOURCE_ASSET_INVALID',spec.asset);
  const descriptor=spec.descriptor??spriteMaterialDescriptor(spec.material_id,spec.material);
  const textureKey=JSON.stringify([catalog.generation,spec.asset,SAMPLER_KEY]),key=JSON.stringify([textureKey,descriptor.signature]);
  let entry=entries.get(key);
  if(entry?.state==='error'){drop(entry);entry=null;}
  if(!entry){
   while(entries.size>=queueLimit&&idleHead)evictIdleMaterial(idleHead);
   if(entries.size>=queueLimit)throw error('SPRITE_RESOURCE_HANDLE_LIMIT');
   entry={key,textureKey,asset:spec.asset,descriptor,textureOwner:null,leases:new Set(),state:'loading',error:null,epoch,generation:0,retired:false,
    autoRefs:0,lastAutoUse:textureCache.frame,cacheOwner:null,idlePrevious:null,idleNext:null,
    get bytes(){return this.textureOwner?.bytes??0;},get texture(){return this.textureOwner?.texture??null;}};entries.set(key,entry);
  }
  return own(entry,notify?String(spec.id):null,!notify);
 }
 function own(entry,id,unmanaged=false){
  const state={entry,id,unmanaged,released:false};
  const lease=Object.freeze({get state(){return state.released?'released':entry.state;},get epoch(){return epoch;},get bytes(){return entry.bytes;},get error(){return entry.error?spriteResourceError(entry.error):null;},get readyPromise(){const expectedEpoch=epoch;const promise=Promise.resolve(entry.promise).then(()=>{if(state.released)throw error('SPRITE_RESOURCE_RELEASED');if(epoch!==expectedEpoch||entry.state!=='ready')throw error('SPRITE_RESOURCE_NOT_READY');return Object.freeze({epoch,bytes:entry.bytes});});promise.catch(()=>{});return promise;},release(){release(state);}});
  state.lease=lease;privateLeases.set(lease,state);entry.leases.add(state);
  if(unmanaged){entry.autoRefs++;entry.lastAutoUse=textureCache.frame;removeIdle(entry);}
  updatePin(entry.textureOwner);
  if(!entry.promise&&available)launch(entry);else if(id)publish(entry);
  return lease;
 }
 function release(state){
  if(state.released)return;state.released=true;const entry=state.entry;entry.leases.delete(state);if(state.unmanaged)entry.autoRefs--;
  if(state.id){if(requests.get(state.id)===state.lease)requests.delete(state.id);updates.delete(state.id);}
  if(state.unmanaged&&entry.autoRefs===0)cacheAuto(entry);
  if(!entry.leases.size&&!entry.cacheOwner)drop(entry);else updatePin(entry.textureOwner);
 }
 function prepare(spec){
  if(!spec||typeof spec.id!=='string'||!spec.id.trim()||new TextEncoder().encode(spec.id).length>1024||Object.keys(spec).some(k=>!['id','asset','material_id','material'].includes(k)))throw error('SPRITE_RESOURCE_INVALID');
  const descriptor=spriteMaterialDescriptor(spec.material_id,spec.material),fingerprint=JSON.stringify([spec.asset,descriptor.id,descriptor.signature,descriptor.defaults]);
  const existing=requests.get(spec.id);if(existing){if(privateLeases.get(existing).fingerprint!==fingerprint)throw error('SPRITE_RESOURCE_ID_REDEFINED');return existing;}
  if(requests.size>=queueLimit)throw error('SPRITE_RESOURCE_HANDLE_LIMIT');
  const lease=acquire({...spec,descriptor},{notify:true});privateLeases.get(lease).fingerprint=fingerprint;requests.set(spec.id,lease);return lease;
 }
 function invalidate(){
  if(disposed||retiring||!available)return;retiring=true;epoch++;available=false;
  updates.clear();appearanceUpdates.clear();const values=[...entries.values()],owners=[...textures.values()];
  // Fence all material entries and shared texture bindings before callbacks.
  for(const entry of values){entry.generation++;entry.state='loading';entry.error=null;entry.promise=null;entry.epoch=epoch;}
  for(const owner of owners){owner.generation++;owner.state='loading';owner.promise=null;owner.epoch=epoch;}
  let failure;try{clearIdleMaterials();}catch(error){failure=error;}
  try{attemptAll([...values.map(entry=>()=>{if(!entry.retired)attemptAll([()=>destroyMaterial(entry),()=>publish(entry)]);}),...owners.map(owner=>()=>{if(!owner.retired)destroyTextureBinding(owner);})]);}catch(error){failure??=error;}finally{retiring=false;}
  if(failure)throw failure;
 }
 function reset(){
  if(disposed||retiring)return;retiring=true;epoch++;const values=[...entries.values()];
  for(const lease of requests.values())privateLeases.get(lease).released=true;
  for(const entry of values){for(const state of entry.leases)state.released=true;entry.leases.clear();}
  requests.clear();updates.clear();appearanceUpdates.clear();
  let failure;try{onReset();}catch(error){failure=error;}
  try{attemptAll([...values.map(entry=>()=>drop(entry)),...[...textures.values()].map(owner=>()=>dropTexture(owner))]);}catch(error){failure??=error;}finally{entries.clear();textures.clear();retiring=false;}
  idleHead=idleTail=null;idleCount=0;
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
 return {public:publicApi,acquire,beginFrame:sweepIdleMaterials,touchAuto(lease){const state=privateLeases.get(lease);if(!state||state.released||!state.unmanaged)return;state.entry.lastAutoUse=textureCache.frame;removeIdle(state.entry);if(state.entry.textureOwner)textureCache.touchOwner(state.entry.textureOwner);},read(lease){const state=privateLeases.get(lease);return state&&!state.released&&!state.entry.retired?state.entry:null;},
  fromId(id){return requests.get(id);},retain(lease){const state=privateLeases.get(lease);if(!state||state.released||state.entry.retired)throw error('SPRITE_RESOURCE_RELEASED');return own(state.entry,null);},appearance(value){event(value.entity,value,appearanceUpdates);},
  contextLost:invalidate,contextRestored(){if(disposed||retiring||available)return;available=true;attemptAll([...entries.values()].filter(entry=>entry.leases.size).map(entry=>()=>launch(entry)));},
  async ready(){await Promise.all([...entries.values()].filter(entry=>[...entry.leases].some(lease=>!lease.id)).map(entry=>entry.promise?.catch(error=>{
   if(error.message.startsWith('IMAGE_ASSET_DIMENSIONS_UNAVAILABLE')&&[...entry.leases].some(lease=>lease.unmanaged))return;throw error;
  })));},
  metrics(){let liveTextures=0,images=0,pending=0,ready=0,errors=0;for(const owner of textures.values()){if(owner.texture)liveTextures++;if(owner.imageLease)images++;}for(const e of entries.values()){if(e.state==='loading')pending++;if(e.state==='ready')ready++;if(e.state==='error')errors++;}return {supported:true,epoch,entries:entries.size,texture_entries:textures.size,handles:requests.size,live_textures:liveTextures,image_leases:images,pending,ready,errors,cpu_reserved_bytes_estimate:reserved,gpu_reserved_bytes_estimate:reserved,builds,retired,texture_builds:textureBuilds,texture_retired:textureRetired,idle_material_entries:idleCount,idle_material_limit:idleMaterialLimit,limits,scope:'Unique sprite asset/sampler texture reservations with the existing hard admission limit. Automatic idle owners share the renderer texture_cache controller; broker/browser copies and other renderer allocations are separate.'};},
  dispose(){if(disposed)return;if(retiring)throw error('SPRITE_RESOURCES_RETIRING');try{reset();}finally{disposed=true;stageGeometry.dispose();}},get epoch(){return epoch;}};
}
