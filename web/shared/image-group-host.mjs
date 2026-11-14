// Applies the game's api.assets.imageGroups requests to the official player's
// image group manager (the same broker, plan, budget and epochs as
// window.unonePlayerAssets) and reports each requested group's state back as
// recorded presentation input. Only names and scalar rows cross into Core.
const MAX_GROUPS=128,MAX_NAME_BYTES=128,MAX_ERROR_CHARS=1024;
const encoder=new TextEncoder();
const validName=name=>typeof name==='string'&&name.length>0&&encoder.encode(name).length<=MAX_NAME_BYTES;
const message=error=>String(error?.message??error).slice(0,MAX_ERROR_CHARS)||'IMAGE_ASSET_GROUP_FAILED';
const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;

export function createImageGroupHost({getGroups}={}){
 if(typeof getGroups!=='function')throw Error('IMAGE_GROUP_HOST_INVALID');
 let revision=-1,closed=false;
 // held: what this host asked the manager to hold for the game. Groups that
 // page code holds through window.unonePlayerAssets are never unloaded here.
 const held=new Map(),failures=new Map(),reported=new Set(),admitted=new Map();
 function acceptPlan(plan){
  if(closed||plan===undefined)return;
  if(!plan||typeof plan!=='object'||!Number.isSafeInteger(plan.revision)||plan.revision<0||Object.keys(plan).some(key=>!['revision','groups'].includes(key))
   ||!plan.groups||typeof plan.groups!=='object'||Array.isArray(plan.groups))throw Error('IMAGE_GROUP_PLAN_INVALID');
  const wanted=Object.entries(plan.groups);
  if(wanted.length>MAX_GROUPS||wanted.some(([name,mode])=>!validName(name)||(mode!=='preload'&&mode!=='load')))throw Error('IMAGE_GROUP_PLAN_INVALID');
  if(plan.revision<=revision)return;
  revision=plan.revision;
  const groups=getGroups();
  for(const [name,mode]of wanted){
   reported.add(name);
   if(held.get(name)===mode)continue;
   held.set(name,mode);failures.delete(name);
   try{
    if(!groups)throw Error('IMAGE_ASSET_GROUPS_NOT_READY');
    // Rejections land in the manager's own row (error/unloaded); keep them handled.
    groups[mode](name)?.catch?.(()=>{});
   }catch(error){failures.set(name,message(error));}
  }
  for(const name of [...held.keys()])if(!Object.hasOwn(plan.groups,name)){
   held.delete(name);failures.delete(name);
   try{groups?.unload(name);}catch{}
  }
 }
 function receipt(name){
  const failed=failures.get(name);
  if(failed!==undefined)return {name,state:'error',total:0,ready:0,bytes:0,error:failed};
  let row;
  try{row=getGroups()?.status(name);}catch(error){return {name,state:'error',total:0,ready:0,bytes:0,error:message(error)};}
  if(!row)return null;
  // The manager keeps its ready count after an unload; only held images are ready.
  const total=count(row.total),value={name,state:row.state,total,ready:Math.min(count(row.ready),count(row.held),total),bytes:count(row.reserved_bytes_estimate)};
  if(row.state==='error'&&row.error)value.error=message(row.error);
  return value;
 }
 // Reports go out only while live browser input owns the tick; a manual or
 // replayed frame stays authoritative.
 function leaseInput(frame,{live=true}={}){
  if(closed||!live||!reported.size)return {frame,token:null};
  if(frame.presentation_resources?.image_groups!==undefined)throw Error('IMAGE_GROUP_INPUT_OWNERSHIP');
  const changed=[];
  for(const name of reported){
   const value=receipt(name);if(!value)continue;
   const key=JSON.stringify(value);if(admitted.get(name)===key)continue;
   changed.push({name,key,value});if(changed.length===MAX_GROUPS)break;
  }
  if(!changed.length)return {frame,token:null};
  return {frame:{...frame,presentation_resources:{...frame.presentation_resources,image_groups:changed.map(entry=>entry.value)}},token:changed};
 }
 function commitInput(token){if(!token||closed)return;for(const {name,key}of token)admitted.set(name,key);}
 function reset(){
  const groups=getGroups();
  for(const name of held.keys())try{groups?.unload(name);}catch{}
  held.clear();failures.clear();reported.clear();admitted.clear();revision=-1;
 }
 return Object.freeze({
  acceptSnapshot(snapshot){if(!closed)acceptPlan(snapshot?.image_group_plan);},
  leaseInput,commitInput,reset,
  close(){if(closed)return;reset();closed=true;},
  report:()=>Object.freeze({closed,revision,held:held.size,reported:reported.size,failures:failures.size}),
 });
}
