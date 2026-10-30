import {DRAW_COMPLETED,DRAW_SKIPPED} from './player-completion.mjs';
const invalid=()=>{throw Error('UI_CURSOR_INVALID: explicit kind, image pixels and in-image hotspot required');};
export function validateCursor(cursor){
 if(cursor==null)return {kind:'default'};
 if(typeof cursor!=='object'||Array.isArray(cursor))invalid();
 const image=cursor.kind==='image',keys=image?['kind','asset','width','height','hotspot_x','hotspot_y','filter']:['kind'];
 if(Object.keys(cursor).some(key=>!keys.includes(key))||!['default','hidden','image'].includes(cursor.kind))invalid();
 if(image){
  if(typeof cursor.asset!=='string'||!/^(texture|asset):\/\//.test(cursor.asset)||cursor.asset.trim()!==cursor.asset||cursor.asset.length>512)invalid();
  if(![cursor.width,cursor.height,cursor.hotspot_x,cursor.hotspot_y].every(Number.isSafeInteger)
   ||cursor.width<1||cursor.height<1||cursor.width>512||cursor.height>512||cursor.hotspot_x<0||cursor.hotspot_y<0
   ||cursor.hotspot_x>=cursor.width||cursor.hotspot_y>=cursor.height||!['nearest','linear'].includes(cursor.filter))invalid();
 }
 return {...cursor};
}

export function cursorRect(cursor,point){
 return {x:point.x-cursor.hotspot_x,y:point.y-cursor.hotspot_y,width:cursor.width,height:cursor.height};
}

export function loadCursorImage(url){
 return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);
  image.onerror=()=>reject(Error('UI_CURSOR_ASSET_FAILED: '+url));image.src=url;});
}

export function createUiCursorHost({target,layer,focus=globalThis.window,loadImage,getImageAssets,onError=error=>{throw error;}}){
 if(getImageAssets!==undefined&&typeof getImageAssets!=='function')throw Error('UI_CURSOR_IMAGE_PROVIDER_INVALID');
 const context=layer.getContext('2d');if(!context)throw Error('UI_CURSOR_CANVAS_UNAVAILABLE');
 const previous=target.style.cursor,images=new Map(),readyWaiters=new Set();let spec={kind:'default'},pointer=null,disposed=false,visible=false,rect=null;
 Object.assign(layer.style,{position:'fixed',pointerEvents:'none',zIndex:'2147483000'});
 function restore(){if(target.style.cursor==='none')target.style.cursor=previous;}
 function clear(){context.clearRect(0,0,layer.width,layer.height);visible=false;rect=null;restore();}
 function retire(asset,entry){entry.retired=true;entry.lease?.release();entry.lease=null;entry.image=null;if(images.get(asset)===entry)images.delete(asset);}
 function resource(asset){
  const broker=getImageAssets?.()??null;
  let entry=images.get(asset);if(entry&&entry.broker===broker)return entry;if(entry)retire(asset,entry);
  entry={image:null,error:false,broker,retired:false,lease:null};images.set(asset,entry);
  const current=()=>!disposed&&!entry.retired&&images.get(asset)===entry;
  const failed=error=>{if(!current()||entry.error)return;entry.error=true;try{if(spec.kind==='image'&&spec.asset===asset){clear();onError(error);}}finally{notifyReady();}};
  if(broker){
   const adopt=()=>{if(!current())return;const lease=entry.lease;if(lease.state==='error')throw lease.error??Error('UI_CURSOR_ASSET_FAILED: '+asset);if(lease.state!=='ready'||!lease.image)throw Error('UI_CURSOR_ASSET_NOT_READY: '+asset);entry.image=lease.image;if(spec.kind==='image'&&spec.asset===asset)renderAndNotify();};
   try{entry.lease=broker.acquire(asset);if(entry.lease.state==='ready'){if(!entry.lease.image)throw Error('UI_CURSOR_ASSET_NOT_READY: '+asset);entry.image=entry.lease.image;}
    else if(entry.lease.state==='error'){entry.lease.promise.catch(()=>{});failed(entry.lease.error??Error('UI_CURSOR_ASSET_FAILED: '+asset));}
    else entry.lease.promise.then(adopt).catch(failed);
   }catch(error){failed(error);}return entry;
  }
  let loading;try{loading=loadImage(asset);}catch(error){entry.error=true;clear();onError(error);return entry;}
  Promise.resolve(loading).then(image=>{
   if(!current())return;entry.image=image;if(spec.kind==='image'&&spec.asset===asset)renderAndNotify();
  }).catch(failed);
  return entry;
 }
 function render(){
  if(disposed)return DRAW_SKIPPED.cursor_diagnostics;const css=target.getBoundingClientRect(),width=target.width,height=target.height;
  if(layer.width!==width)layer.width=width;if(layer.height!==height)layer.height=height;
  Object.assign(layer.style,{left:css.left+'px',top:css.top+'px',width:css.width+'px',height:css.height+'px'});
  clear();
  if(!pointer||css.width<=0||css.height<=0||width<=0||height<=0||spec.kind==='default')return DRAW_COMPLETED;
  const x=(pointer.x-css.left)*width/css.width,y=(pointer.y-css.top)*height/css.height;
  if(x<0||y<0||x>=width||y>=height)return DRAW_COMPLETED;
  if(spec.kind==='hidden'){target.style.cursor='none';return DRAW_COMPLETED;}
  const entry=resource(spec.asset),image=entry.image;if(!image)return entry.error?DRAW_SKIPPED.cursor_diagnostics:DRAW_SKIPPED.cursor_assets_pending;
  rect=cursorRect(spec,{x,y});context.imageSmoothingEnabled=spec.filter==='linear';
  context.drawImage(image,rect.x,rect.y,rect.width,rect.height);target.style.cursor='none';visible=true;return DRAW_COMPLETED;
 }
 function readiness(){
  if(disposed)return DRAW_SKIPPED.cursor_diagnostics;
  if(!pointer||spec.kind!=='image')return DRAW_COMPLETED;
  const css=target.getBoundingClientRect();if(css.width<=0||css.height<=0||target.width<=0||target.height<=0||pointer.x<css.left||pointer.y<css.top||pointer.x>=css.left+css.width||pointer.y>=css.top+css.height)return DRAW_COMPLETED;
  const entry=images.get(spec.asset);return entry?.image?DRAW_COMPLETED:entry?.error?DRAW_SKIPPED.cursor_diagnostics:DRAW_SKIPPED.cursor_assets_pending;
 }
 function notifyReady(){if(!readyWaiters.size)return;const value=readiness();if(value===DRAW_SKIPPED.cursor_assets_pending)return;
  for(const waiter of readyWaiters)value===DRAW_COMPLETED?waiter.resolve():waiter.reject(Error(disposed?'UI_CURSOR_DISPOSED':'UI_CURSOR_ASSET_FAILED'));readyWaiters.clear();}
 function renderAndNotify(){const value=render();notifyReady();return value;}
 function move(event){pointer=event.pointerType==='touch'?null:{x:event.clientX,y:event.clientY};renderAndNotify();}
 function leave(){pointer=null;clear();notifyReady();}
 target.addEventListener('pointermove',move,{passive:true});target.addEventListener('pointerenter',move,{passive:true});
 target.addEventListener('pointerleave',leave,{passive:true});focus?.addEventListener('blur',leave);
 return {
  update(value){const next=validateCursor(value);spec=next;
   // Pin the incoming cursor before retiring the outgoing lease can sweep it
   // from the shared idle cache. Retire old ownership even if onError throws.
   try{if(spec.kind==='image')resource(spec.asset);}
   finally{for(const [asset,entry]of images)if(entry.broker&&(spec.kind!=='image'||asset!==spec.asset))retire(asset,entry);}
   return renderAndNotify();},render:renderAndNotify,
  ready(){const value=readiness();if(value===DRAW_COMPLETED)return Promise.resolve();if(value!==DRAW_SKIPPED.cursor_assets_pending)return Promise.reject(Error(disposed?'UI_CURSOR_DISPOSED':'UI_CURSOR_ASSET_FAILED'));return new Promise((resolve,reject)=>readyWaiters.add({resolve,reject}));},
  report(){let leases=0;for(const entry of images.values())if(entry.lease)leases++;return {mode:spec.kind,asset:spec.asset??null,visible,rect:rect?{...rect}:null,shared_image_leases:leases,units:'drawing_buffer_pixels',input:'passive real pointer; no event injection'};},
  invalidateAssets(){for(const [asset,entry]of images)retire(asset,entry);if(!disposed&&spec.kind==='image')resource(spec.asset);return renderAndNotify();},
  dispose(){if(disposed)return;disposed=true;clear();for(const [asset,entry]of images)retire(asset,entry);notifyReady();target.removeEventListener('pointermove',move);
   target.removeEventListener('pointerenter',move);target.removeEventListener('pointerleave',leave);focus?.removeEventListener('blur',leave);},
 };
}
