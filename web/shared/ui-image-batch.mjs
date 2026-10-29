import {retainedImageGeneration} from './retained-image-generation.mjs';
import {UI_CONTRACT} from './ui-contract.mjs';
const encoder=new TextEncoder(),admitted=new WeakMap();
export const UI_IMAGE_IDENTITY=Object.freeze({a:1,b:0,c:0,d:1,tx:0,ty:0});
const fail=(code,id)=>{throw Error(`${code}: ${id}`);};
function fields(value,allowed,code,id){
 if(!value||typeof value!=='object'||Array.isArray(value))fail(code,id);
 const descriptors=Object.getOwnPropertyDescriptors(value);
 for(const [key,d]of Object.entries(descriptors))if(!allowed.includes(key)||!('value'in d))fail(code,id);
 return value;
}
function rect(value,code,id,stage=false){
 fields(value,['x','y','width','height'],code,id);
 if(!['x','y','width','height'].every(k=>Number.isFinite(value[k]))||value.width<=0||value.height<=0||!Number.isFinite(value.x+value.width)||!Number.isFinite(value.y+value.height))fail(code,id);
 if(stage&&(value.x<0||value.y<0||value.x+value.width>100||value.y+value.height>100))fail(code,id);
 return Object.freeze({x:value.x,y:value.y,width:value.width,height:value.height});
}
function definition(value,id,token,stage=false){
 fields(value,['revision','bounds','quads'],'UI_IMAGE_RESOURCE_INVALID',id);
 if(!Number.isSafeInteger(value.revision)||value.revision<1)fail('UI_IMAGE_RESOURCE_REVISION',id);
 const bounds=rect(value.bounds,'UI_IMAGE_RESOURCE_BOUNDS',id,stage),quads=value.quads;
 if(!Array.isArray(quads)||quads.length>UI_CONTRACT.host_max_nodes)fail('UI_IMAGE_BATCH_QUADS',id);
 if(!quads.length)fail('UI_IMAGE_BATCH_EMPTY',id);
 const out=[],assets=new Set(),requirements=new Map();let stringBytes=0;
 for(let i=0;i<quads.length;i++){
  const q=fields(quads[i],['asset','rect','source','opacity'],'UI_IMAGE_BATCH_FIELDS',id),asset=q.asset,
   match=typeof asset==='string'?asset.match(/^([a-zA-Z0-9+.-]+):\/\/(.*)$/s):null;
  if(!match||!match[2].trim()||['http','https','file','data'].includes(match[1].toLowerCase()))fail('UI_IMAGE_BATCH_ASSET',id);
  const r=rect(q.rect,'UI_IMAGE_BATCH_BOUNDS',id,stage),dx=r.x-bounds.x,dy=r.y-bounds.y;
  if(dx< -1e-8||dy< -1e-8||r.width>bounds.width+1e-8-dx||r.height>bounds.height+1e-8-dy)fail('UI_IMAGE_BATCH_BOUNDS',id);
  if(q.opacity!=null&&(!Number.isFinite(q.opacity)||q.opacity<0||q.opacity>1))fail('UI_IMAGE_BATCH_OPACITY',id);
  const source=q.source==null?undefined:rect(q.source,'UI_IMAGE_BATCH_SOURCE',id);
  if(source&&(source.x<0||source.y<0||!Number.isFinite(source.x+source.width)||!Number.isFinite(source.y+source.height)))fail('UI_IMAGE_BATCH_SOURCE',id);
  assets.add(asset);stringBytes+=encoder.encode(asset).length;
  let need=requirements.get(asset);if(!need){need={asset,maxX:0,maxY:0};requirements.set(asset,need);}if(source){need.maxX=Math.max(need.maxX,source.x+source.width);need.maxY=Math.max(need.maxY,source.y+source.height);}
  if(stringBytes>UI_CONTRACT.max_string_bytes)fail('UI_STRING_LIMIT',`${id}; quads[${i}]`);
  out.push(Object.freeze({asset,rect:r,...(source?{source}:{}),...(q.opacity!=null?{opacity:q.opacity}:{})}));
 }
 return Object.freeze({token,bounds,quads:Object.freeze(out),assets:Object.freeze([...assets]),requirements:Object.freeze([...requirements.values()].map(Object.freeze)),stringBytes,revision:value.revision,originX:bounds.x,originY:bounds.y});
}
export function imageBatchTransform(node,bounds){
 const raw=node.transform;if(raw==null)return UI_IMAGE_IDENTITY;
 fields(raw,['a','b','c','d','tx','ty'],'UI_IMAGE_BATCH_TRANSFORM',node.id);
 if(!['a','b','c','d','tx','ty'].every(k=>Number.isFinite(raw[k])))fail('UI_IMAGE_BATCH_TRANSFORM',node.id);
 for(const x of [bounds.x,bounds.x+bounds.width])for(const y of [bounds.y,bounds.y+bounds.height])
  if(!Number.isFinite(raw.a*x+raw.c*y+raw.tx)||!Number.isFinite(raw.b*x+raw.d*y+raw.ty))fail('UI_IMAGE_BATCH_TRANSFORM',node.id);
 return Object.freeze({a:raw.a,b:raw.b,c:raw.c,d:raw.d,tx:raw.tx,ty:raw.ty});
}
// Only the official reader/receiver's immutable generation grant permits an
// identity lookup. Raw snapshots compare complete validated logical contents.
export function createImageBatchResolver(){
 const raw=new Map(),inline=new Map();
 function resource(id,resources){
  if(typeof id!=='string'||!id.trim()||encoder.encode(id).length>1024)fail('UI_IMAGE_RESOURCE_ID',id);
  const value=resources&&Object.hasOwn(resources,id)?resources[id]:undefined;if(!value)fail('UI_IMAGE_RESOURCE_MISSING',id);
  const grant=retainedImageGeneration(value);
  if(grant){let result=admitted.get(grant);if(!result){result=definition(value,id,grant);admitted.set(grant,result);}return result;}
  const candidate=definition(value,id,null),key=JSON.stringify([candidate.bounds,candidate.quads,candidate.revision]),old=raw.get(id);
  if(old?.key===key)return old.result;
  const result=Object.freeze({...candidate,token:Object.freeze({})});raw.set(id,{key,result});return result;
 }
 function resolve(node,resources){
  fields(node,['kind','id','rect','quads','content','transform','pixel_snap','background_for'],'UI_IMAGE_BATCH_FIELDS',node.id);
  if(node.pixel_snap!==undefined&&typeof node.pixel_snap!=='boolean')fail('UI_IMAGE_BATCH_PIXEL_SNAP',node.id);
  const clip=rect(node.rect,'UI_IMAGE_BATCH_BOUNDS',node.id,true),retained=node.content!==undefined;
  let data;
  if(retained){if(node.quads!==undefined)fail('UI_IMAGE_BATCH_FIELDS',node.id);data=resource(node.content,resources);}
  else{
   if(node.transform!==undefined)fail('UI_IMAGE_BATCH_TRANSFORM',node.id);
   const candidate=definition({revision:1,bounds:clip,quads:node.quads},node.id,null,true),key=JSON.stringify([clip,candidate.quads]),old=inline.get(node.id);
   if(old?.key===key)data=old.result;
   else{data=Object.freeze({...candidate,token:Object.freeze({})});inline.set(node.id,{key,result:data});}
  }
  const transform=imageBatchTransform(node,data.bounds),pixelSnap=node.pixel_snap===true;
  if(pixelSnap&&(transform.b!==0||transform.c!==0))fail('UI_IMAGE_BATCH_PIXEL_SNAP_TRANSFORM',node.id);
  return {node,definition:data,transform,clip,retained,pixelSnap};
 }
 return {resolve,resource,
  prune(nodes){const ids=new Set(),inlineIds=new Set();for(const n of nodes)if(n.kind==='image_batch'){if(n.content!==undefined)ids.add(n.content);else inlineIds.add(n.id);}
   for(const id of raw.keys())if(!ids.has(id))raw.delete(id);for(const id of inline.keys())if(!inlineIds.has(id))inline.delete(id);},
  clear(){raw.clear();inline.clear();}};
}

export function imageBatchCanvasTransform(t,width,height,originX=0,originY=0){
 const tx=t.a*originX+t.c*originY+t.tx,ty=t.b*originX+t.d*originY+t.ty;
 return [width/100*t.a,-height/100*t.b,-width/100*t.c,height/100*t.d,width/100*tx,height-height/100*ty];
}

// Pixel snapping belongs to final presentation, after the authored transform.
// Signed dimensions retain reflection; source UVs and the viewport clip stay
// unchanged. Collapsed rectangles have no covered pixels.
export function imageBatchSnappedRect(instance,rect,width,height){
 const t=instance.transform,round=n=>Math.sign(n)*Math.floor(Math.abs(n)+.5),
  left=round((t.a*rect.x+t.tx)*width/100),right=round((t.a*(rect.x+rect.width)+t.tx)*width/100),
  bottom=round((t.d*rect.y+t.ty)*height/100),top=round((t.d*(rect.y+rect.height)+t.ty)*height/100);
 return {x:left,y:height-top,width:right-left,height:top-bottom};
}
