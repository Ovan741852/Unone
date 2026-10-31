import {compareSpriteEntities,spriteCellRect} from '../shared/webgpu-snapshot.js';
import {syncSpriteCell} from './sprite-cells.js';
import {spriteMaterialDescriptor,createSpriteMaterial,validateSpriteUniforms,applySpriteMaterialValues} from './shader-materials.js';
import {spriteResourceError} from './sprite-resources.js';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
function number(value,fallback){const result=value??fallback;if(!finite(result))throw Error('SPRITE_APPEARANCE_INVALID: finite placement required');return result;}
function metadata(entity){const v=entity.sprite_appearance;if(v===undefined)return null;if(!v||typeof v.resource!=='string'||!v.resource||!Number.isSafeInteger(v.revision)||v.revision<1)throw Error('SPRITE_APPEARANCE_INVALID');return v;}

// Owned, reused desired values: animation/placement/value changes never restart I/O.
function capture(record,entity,world,descriptor,values){
 validateSpriteUniforms(descriptor,values);const sprite=entity.sprite;spriteCellRect(sprite,record.cellCheck??={});
 const d=record.desired??={transform:{},scale:{},sprite:{size:{}},uniforms:{},meta:null};
 d.transform.x=number(entity.transform?.x,0);d.transform.y=number(entity.transform?.y,0);
 d.scale.x=number(entity.scale?.x,1);d.scale.y=number(entity.scale?.y,1);d.rotation=number(entity.rotation,0);
 d.sprite.asset=sprite.asset;d.sprite.size.x=number(sprite.size?.x,1);d.sprite.size.y=number(sprite.size?.y,1);
 if(d.sprite.size.x<=0||d.sprite.size.y<=0)throw Error('SPRITE_APPEARANCE_INVALID: positive sprite size required');
 d.sprite.layer=number(sprite.layer,0);d.sprite.frame=sprite.frame??0;
 if(sprite.sheet){d.sprite.sheet??={};d.sprite.sheet.columns=sprite.sheet.columns;d.sprite.sheet.rows=sprite.sheet.rows;}else delete d.sprite.sheet;
 if(record.desiredSignature!==descriptor.signature){d.uniforms={};record.desiredSignature=descriptor.signature;}
 for(const name of descriptor.names){const value=values[name];if(Array.isArray(value)){const target=d.uniforms[name]??=[];for(let i=0;i<value.length;i++)target[i]=value[i];}else d.uniforms[name]=value;}
 const meta=metadata(entity);if(meta){d.meta??={};d.meta.resource=meta.resource;d.meta.revision=meta.revision;}else d.meta=null;
 d.frame=world.frame??0;d.time_seconds=world.time_seconds??0;return d;
}
export function createSpritePresentation({THREE,root,geometry,records,recordFor,resources,legacy=null}) {
 const descriptorCache=new Map(),submitted=new Map(),frameCandidates=[],alive=new Set(),usedMaterials=new Set(),legacyIds=new Set(),visibleEntities=[];let pending=false,disposed=false;
 const matches=(a,b)=>a&&a.resource===b.resource&&a.revision===b.revision&&a.epoch===b.epoch;
 function attemptAll(actions){let failure;for(const action of actions)try{action();}catch(error){failure??=error;}if(failure)throw failure;}
 function stage(id,meta,absence=false){if(!meta)return;const old=submitted.get(id);if(old?.resource===meta.resource&&old.revision===meta.revision&&old.epoch===resources.epoch)return;frameCandidates.push({entity:id,revision:meta.revision,state:'submitted',epoch:resources.epoch,resource:meta.resource,absence});}
 function descriptorFor(entity,world){
  const id=entity.shader_material;if(!id)return spriteMaterialDescriptor();
  const definition=world.shader_materials?.[id];if(!definition)throw Error(`SHADER_MATERIAL_UNKNOWN: ${id}`);
  const old=descriptorCache.get(id);
  if(old?.fragment===definition.fragment){try{validateSpriteUniforms(old.descriptor,definition.uniforms??{});return old.descriptor;}catch{/* changed layout */}}
  const descriptor=spriteMaterialDescriptor(id,definition);descriptorCache.set(id,{fragment:definition.fragment,descriptor});return descriptor;
 }
 function detach(record,remove=false){
  const candidate=record.candidateLease,committed=record.committedLease;record.candidateLease=null;record.committedLease=null;
  record.candidateResource=null;record.committedResource=null;
  if(record.material?.uniforms?.unone_texture)record.material.uniforms.unone_texture.value=null;
  const material=record.material,cell=record.cellGeometry;if(material)material.map=null;record.material=null;record.mesh.material=null;record.mesh.visible=false;
  record.cellGeometry=null;record.mesh.geometry=geometry;record.committedSignature=null;
  if(remove){root.remove(record.mesh);records.delete(record.id);submitted.delete(record.id);}
  attemptAll([()=>material?.dispose(),()=>cell?.dispose(),()=>candidate?.release(),()=>committed?.release()]);
 }
 function failure(record,meta,error){record.candidateLease?.release();record.candidateLease=null;if(record.committedLease?.state!=='ready')record.mesh.visible=false;if(meta)resources.appearance({entity:record.id,revision:meta.revision,state:'error',epoch:resources.epoch,error:spriteResourceError(error)});pending=true;}
 function selectLease(record,entity,world){
  const meta=metadata(entity);
  if(meta){
   const committed=resources.read(record.committedLease),candidate=resources.read(record.candidateLease);
   if(record.committedResource===meta.resource&&committed?.asset===entity.sprite.asset){record.candidateLease?.release();record.candidateLease=null;return record.committedLease;}
   if(record.candidateResource===meta.resource&&candidate?.asset===entity.sprite.asset)return record.candidateLease;
   const caller=resources.fromId(meta.resource);if(!caller)return null;const entry=resources.read(caller);
   if(!entry||entry.asset!==entity.sprite.asset)throw Error('SPRITE_APPEARANCE_RESOURCE_MISMATCH');
   if(resources.read(record.committedLease)===entry){record.candidateLease?.release();record.candidateLease=null;return record.committedLease;}
   if(resources.read(record.candidateLease)===entry)return record.candidateLease;
   const next=resources.retain(caller);record.candidateLease?.release();record.candidateLease=next;record.candidateResource=meta.resource;return next;
  }
  const descriptor=descriptorFor(entity,world),current=resources.read(record.candidateLease??record.committedLease);
  if(current?.asset===entity.sprite.asset&&current.descriptor.signature===descriptor.signature)return record.candidateLease??record.committedLease;
  const next=resources.acquire({asset:entity.sprite.asset,descriptor});record.candidateLease?.release();record.candidateLease=next;return next;
 }
 function adopt(record,lease,entry,desired){
  const previous=record.committedLease,oldMaterial=record.material;
  const material=record.committedSignature===entry.descriptor.signature&&oldMaterial?oldMaterial:createSpriteMaterial(THREE,entry.descriptor,entry.texture);
  // Allocate a first cell geometry before touching the displayed material.
  // Creation failure must leave its old pixels, UVs and uniforms together.
  try{syncSpriteCell(record,desired.sprite,geometry);}catch(error){if(material!==oldMaterial)material.dispose();throw error;}
  applySpriteMaterialValues(material,entry.descriptor,entry.texture,desired.uniforms,desired);
  record.mesh.position.set(desired.transform.x,desired.transform.y,desired.sprite.layer/1000);
  record.mesh.scale.set(desired.sprite.size.x*desired.scale.x,desired.sprite.size.y*desired.scale.y,1);record.mesh.rotation.z=desired.rotation;
  record.material=material;record.mesh.material=material;record.mesh.renderOrder=desired.sprite.layer;record.mesh.visible=true;
  record.committedLease=lease;record.candidateLease=null;record.committedSignature=entry.descriptor.signature;
  record.committedResource=desired.meta?.resource??null;record.candidateResource=null;
  try{if(oldMaterial&&oldMaterial!==material){if(oldMaterial.uniforms?.unone_texture)oldMaterial.uniforms.unone_texture.value=null;oldMaterial.map=null;oldMaterial.dispose();}}
  finally{if(previous&&previous!==lease)previous.release();}
 }
 function update(entity,world){
  const record=recordFor(entity);record.id=String(entity.id);
  if(record.legacyAsset===entity.sprite.asset&&!entity.sprite_appearance){if(!legacy(record,entity,world))pending=true;return;}
  record.legacyAsset=null;
  try{const lease=selectLease(record,entity,world),entry=resources.read(lease);
   if(!entry){pending=true;if(!record.committedLease)record.mesh.visible=false;return;}
   const values=entity.sprite_uniforms??(entity.sprite_appearance?entry.descriptor.defaults:world.shader_materials?.[entity.shader_material]?.uniforms??entry.descriptor.defaults);
   const desired=capture(record,entity,world,entry.descriptor,values);
   if(lease.state==='error'){
    // Unsupported speculative dimensions (notably SVG) retain the ordinary
    // decoded-on-demand path. It is explicitly outside managed atomic readiness.
    if(!desired.meta&&legacy&&lease.error?.startsWith('IMAGE_ASSET_DIMENSIONS_UNAVAILABLE')){
     detach(record);record.legacyAsset=entity.sprite.asset;if(!legacy(record,entity,world))pending=true;return;
    }
    failure(record,desired.meta,lease.error);return;
   }
   if(lease.state!=='ready'){pending=true;if(!record.committedLease||record.committedLease.state!=='ready')record.mesh.visible=false;return;}
   adopt(record,lease,entry,desired);stage(record.id,desired.meta);
  }catch(error){failure(record,metadata(entity),error);if(!entity.sprite_appearance)throw error;}
 }
 function draw(world,visible=true){
  if(disposed)throw Error('SPRITE_PRESENTATION_DISPOSED');pending=false;frameCandidates.length=0;alive.clear();usedMaterials.clear();legacyIds.clear();visibleEntities.length=0;
  const entities=world.entities??{};
  for(const id in entities)if(Object.hasOwn(entities,id)){const e=entities[id];if(e.sprite&&visible&&e.sprite.visible!==false)visibleEntities.push(e);}
  visibleEntities.sort(compareSpriteEntities);
  for(const entity of visibleEntities){const id=String(entity.id);alive.add(id);if(entity.shader_material)usedMaterials.add(entity.shader_material);update(entity,world);if(records.get(id)?.legacyAsset)legacyIds.add(id);}
  for(const [id,record]of records)if(!alive.has(id)){const entity=entities[id];detach(record,!entity?.sprite);if(entity?.sprite)stage(id,metadata(entity),entity.sprite.visible===false);}
  for(const id in entities)if(Object.hasOwn(entities,id)){const entity=entities[id];if(entity.sprite&&!alive.has(String(entity.id))&&!records.has(String(entity.id)))stage(String(entity.id),metadata(entity),entity.sprite.visible===false);}
  for(const id of descriptorCache.keys())if(!usedMaterials.has(id))descriptorCache.delete(id);return !pending;
 }
 return {draw,legacyEntities:()=>legacyIds,submitted(sceneDrawn=true){for(const candidate of frameCandidates)if((sceneDrawn||candidate.absence)&&!matches(submitted.get(candidate.entity),candidate)){const {absence,...value}=candidate;resources.appearance(value);submitted.set(value.entity,value);}},
  reset(){try{attemptAll([...records.values()].map(record=>()=>detach(record,true)));}finally{submitted.clear();descriptorCache.clear();frameCandidates.length=0;visibleEntities.length=0;alive.clear();usedMaterials.clear();legacyIds.clear();}},
  dispose(){if(disposed)return;try{this.reset();}finally{disposed=true;}},get pending(){return pending;}};
}
