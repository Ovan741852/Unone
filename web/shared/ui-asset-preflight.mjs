import {createImageBatchResolver} from './ui-image-batch.mjs';
import {DRAW_COMPLETED,DRAW_SKIPPED} from './player-completion.mjs';

// Experimental: pin the incoming assets before the host mutates scroll/IME,
// routing or the GPU back buffer. The currently displayed UI keeps its own
// independent leases until a successfully rendered replacement takes over.
export function createUiAssetPreflight({acquire,onChange=()=>{}}){
 if(typeof acquire!=='function')throw Error('UI_PREFLIGHT_ACQUIRE_REQUIRED');
 const resolver=createImageBatchResolver();let held=new Map(),version=0,disposed=false;
 const data=id=>typeof id==='string'&&id.startsWith('data-texture://');
 function idsFor(snapshot){
  const world=snapshot?.world??snapshot,tree=world?.ui,resources=world?.ui_image_batches,ids=new Set(),batchNodes=[];
  function walk(nodes){for(const node of nodes??[]){
   if(node.kind==='image'&&!data(node.asset))ids.add(node.asset);
   if(node.kind==='image_batch'){batchNodes.push(node);for(const id of resolver.resolve(node,resources).definition.assets)if(!data(id))ids.add(id);}
   if(node.children)walk(node.children);
  }}
  walk(tree?.children);resolver.prune(batchNodes);return ids;
 }
 function update(snapshot){
  if(disposed)throw Error('UI_PREFLIGHT_DISPOSED');
  const ids=idsFor(snapshot),next=new Map(),epoch=++version;let failure;
  try{for(const id of ids){
   let entry=held.get(id);if(!entry){const lease=acquire(id);entry={id,lease};
    if(lease.state==='loading')lease.promise.then(()=>{if(!disposed&&held.get(id)===entry)onChange();},()=>{if(!disposed&&held.get(id)===entry)onChange();});}
   next.set(id,entry);
  }}catch(error){failure=error;}
  if(failure){for(const [id,e]of next)if(held.get(id)!==e)e.lease.release();throw failure;}
  const old=held;held=next;for(const [id,e]of old)if(!next.has(id))e.lease.release();
  for(const e of held.values())if(e.lease.state==='error')return {outcome:DRAW_SKIPPED.ui_diagnostics,error:e.lease.error,id:e.id};
  for(const e of held.values())if(e.lease.state!=='ready')return {outcome:DRAW_SKIPPED.ui_assets_pending};
  return {outcome:DRAW_COMPLETED};
 }
 function release(){version++;const old=held;held=new Map();for(const e of old.values())e.lease.release();}
 function ready(){return Promise.all([...held.values()].map(e=>e.lease.promise));}
 return {update,release,ready,dispose(){if(disposed)return;disposed=true;release();resolver.clear();},report:()=>({disposed,assets:held.size,version})};
}
