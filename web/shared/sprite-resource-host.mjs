// Main-thread presentation ownership. Only small, recorded receipts cross into
// Core input; GPU objects, images and promises never enter the worker/runtime.
const MAX_PENDING=4096,MAX_BATCH=256;
const safe=value=>Number.isSafeInteger(value)&&value>=0;
const id=value=>typeof value==='string'&&/^[1-9][0-9]{0,15}$/.test(value)&&Number.isSafeInteger(Number(value));
export function createSpriteResourceHost(renderer){
 let requests=new Map(),revision=-1,closed=false,world=null;
 const resources=new Map(),appearances=new Map(),admittedResources=new Map();
 const service=()=>renderer?.spriteResources;
 function enqueue(kind,event){
  if(!event||typeof event!=='object')throw Error('SPRITE_RESOURCE_FEEDBACK_INVALID');
  const target=kind==='resources'?resources:appearances,key=kind==='resources'?event.id:event.entity;
  if(typeof key!=='string'||!safe(event.epoch)||event.epoch===0||event.error!=null&&(typeof event.error!=='string'||new TextEncoder().encode(event.error).length>4096))throw Error('SPRITE_RESOURCE_FEEDBACK_INVALID');
  if(kind==='resources'){
   if(!id(key)||!['loading','ready','error'].includes(event.state)||!safe(event.bytes)||event.bytes>1073741824)throw Error('SPRITE_RESOURCE_FEEDBACK_INVALID');
  }else if(!safe(event.revision)||event.revision===0||!['submitted','error'].includes(event.state))throw Error('SPRITE_RESOURCE_FEEDBACK_INVALID');
  const old=target.get(key);
  if(old&&(old.value.epoch>event.epoch||kind==='appearances'&&old.value.revision>event.revision))return;
  if(!old&&target.size>=MAX_PENDING)throw Error('SPRITE_RESOURCE_FEEDBACK_LIMIT');
  const value=kind==='resources'?{id:key,state:event.state,epoch:event.epoch,bytes:event.bytes}:{entity:key,revision:event.revision,state:event.state,epoch:event.epoch};
  if(event.error!=null)value.error=event.error;
  target.set(key,{value:Object.freeze(value)});
 }
 function collect(){
  if(closed)return;
  const updates=service()?.takeUpdates?.();
  for(const event of updates?.resources??[])if(requests.has(event.id))enqueue('resources',event);
  for(const event of updates?.appearances??[]){
   if(world?.entities?.[event.entity]?.sprite_appearance?.revision===event.revision)enqueue('appearances',event);
  }
 }
 function acceptPlan(plan){
  if(closed||plan===undefined)return;
  if(!plan||!safe(plan.revision)||!Array.isArray(plan.resources)||plan.resources.length>4096||Object.keys(plan).some(key=>!['revision','resources'].includes(key)))throw Error('SPRITE_RESOURCE_PLAN_INVALID');
  if(plan.revision<=revision)return;
  const next=new Map();
  for(const spec of plan.resources){
   if(!spec||!id(spec.id)||typeof spec.asset!=='string'||!spec.asset||next.has(spec.id)||Object.keys(spec).some(key=>!['id','asset','material_id','material'].includes(key)))throw Error('SPRITE_RESOURCE_PLAN_INVALID');
   const signature=JSON.stringify(spec),old=requests.get(spec.id);
   if(old&&old.signature!==signature)throw Error('SPRITE_RESOURCE_ID_REUSED');
   next.set(spec.id,old??{signature,spec,lease:null});
  }
  const previous=requests;requests=next;revision=plan.revision;
  for(const [key,entry]of next)if(!entry.lease){
   try{
    if(typeof service()?.prepare!=='function')throw Error('SPRITE_RESOURCE_BACKEND_UNSUPPORTED');
    entry.lease=service().prepare(entry.spec);
    entry.lease.readyPromise?.catch?.(()=>{});
   }catch(error){entry.lease?.release();entry.lease=null;enqueue('resources',{id:key,state:'error',epoch:1,bytes:0,error:String(error?.message??error).slice(0,1024)});}
  }
  for(const [key,entry]of previous)if(!next.has(key)){entry.lease?.release();resources.delete(key);admittedResources.delete(key);}
  collect();
 }
 function acceptSnapshot(snapshot){if(closed)return;world=snapshot?.world??null;acceptPlan(snapshot?.sprite_resource_plan);collect();}
 function leaseInput(frame,{live=true}={}){
  if(closed||!live)return {frame,token:null};
  collect();
  if(Object.hasOwn(frame,'presentation_resources'))throw Error('SPRITE_RESOURCE_INPUT_OWNERSHIP');
  if(!resources.size&&!appearances.size)return {frame,token:null};
  const resourceBatch=[...resources.entries()].slice(0,MAX_BATCH),states=resourceBatch.length?new Map(resourceBatch):null;
  const appearanceBatch=[];
  for(const [key,entry]of appearances){
   const entity=world?.entities?.[key],metadata=entity?.sprite_appearance,event=entry.value;
   if(metadata?.revision!==event.revision){appearances.delete(key);continue;}
   const state=states?.get(metadata.resource)?.value??admittedResources.get(metadata.resource);
   if(entity.sprite?.visible===false||state?.state==='ready'&&state.epoch===event.epoch)appearanceBatch.push([key,entry]);
   else if(state&&state.epoch>event.epoch)appearances.delete(key);
   if(appearanceBatch.length===MAX_BATCH)break;
  }
  const token={resources:resourceBatch,appearances:appearanceBatch};
  if(!token.resources.length&&!token.appearances.length)return {frame,token:null};
  return {frame:{...frame,presentation_resources:{resources:token.resources.map(([,entry])=>entry.value),appearances:token.appearances.map(([,entry])=>entry.value)}},token};
 }
 function commitInput(token){
  if(!token||closed)return;
  for(const [key,entry]of token.resources){admittedResources.set(key,entry.value);if(resources.get(key)===entry)resources.delete(key);}
  for(const [key,entry]of token.appearances)if(appearances.get(key)===entry)appearances.delete(key);
 }
 function reset(){
  for(const entry of requests.values())entry.lease?.release();
  requests.clear();resources.clear();appearances.clear();admittedResources.clear();revision=-1;world=null;
  service()?.reset?.();
 }
 return {acceptSnapshot,collect,leaseInput,commitInput,reset,close(){if(closed)return;reset();closed=true;},report:()=>({closed,revision,leases:requests.size,pending_resources:resources.size,pending_appearances:appearances.size,scope:'Opaque host leases and queued recorded-input receipts; not total GPU memory.'})};
}
