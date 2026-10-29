import {safe,validatePhysicalEvent,normalizeZeros} from './ordered-physical-events.mjs';
const profile='ordered_physical_v1',size=v=>new TextEncoder().encode(JSON.stringify(v)).length;
export function createOrderedPhysicalQueue({epoch,maxPending=4096,maxBytes=4194304}={}){
 if(!safe(epoch)||epoch<1||!Number.isInteger(maxPending)||maxPending<1||maxPending>4096||!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>4194304)throw Error('INPUT_PHYSICAL_CONFIG_INVALID');
 let sequence=0,committed=0,lastTime=0,bytes=0,inflight=null,fault=null,admissions=0;const rows=[];
 function fail(message){fault='INPUT_PHYSICAL_'+message;throw Error(fault);}
 const healthy=()=>{if(fault)throw Error(fault);};
 function append(payload){
  healthy();if(Object.hasOwn(payload,'sequence'))fail('INVALID: reserved sequence');
  const e=normalizeZeros({...structuredClone(payload),sequence:sequence+1});
  try{validatePhysicalEvent(e);}catch(error){fail('INVALID: '+error.message);}
  if(e.received_us<lastTime)fail('TIME: received_us decreased');
  const n=size(e);if(rows.length>=maxPending||bytes+n>maxBytes)fail('QUEUE_FULL: pending and inflight bound');
  sequence++;lastTime=e.received_us;rows.push(e);bytes+=n;return sequence;
 }
 function admit(payload,route,cancel=()=>{}){
  const id=append(payload),row=rows.at(-1),before=size(row);admissions++;
  try{
   const owner=route();if(!['game','engine_ui','host_ui'].includes(owner))throw Error('INPUT_PHYSICAL_ROUTE_INVALID');
   row.route=owner;bytes+=size(row)-before;if(bytes>maxBytes)fail('QUEUE_FULL: routed row budget');return id;
  }catch(error){let cancellation='';try{cancel();}catch(e){cancellation='; cancellation failed: '+e.message;}
   if(!fault)fault='INPUT_PHYSICAL_ROUTE_FAILED: '+error.message+cancellation;throw error;}
  finally{admissions--;}
 }
 function lease(){
  healthy();if(admissions)throw Error('INPUT_PHYSICAL_ADMISSION_PENDING');if(inflight)return structuredClone(inflight);
  const events=[];
  for(const row of rows.slice(0,256)){
   const candidate={profile,epoch,after_sequence:committed,through_sequence:row.sequence,events:[...events,row]};
   if(size(candidate)>262144){if(!events.length)fail('QUEUE_FULL: event exceeds batch budget');break;}events.push(row);
  }
  inflight={profile,epoch,after_sequence:committed,through_sequence:events.at(-1)?.sequence??committed,events};
  return structuredClone(inflight);
 }
 function commit(receipt){
  healthy();if(!inflight||!receipt||receipt.profile!==profile||receipt.epoch!==epoch||receipt.through_sequence!==inflight.through_sequence)fail('RECEIPT_INVALID');
  const removed=rows.splice(0,inflight.events.length);for(const row of removed)bytes-=size(row);
  committed=inflight.through_sequence;inflight=null;
 }
 return {append,admit,lease,commit,terminate:reason=>fail('TERMINAL: '+reason),report:()=>({profile,epoch,committed,next_sequence:sequence+1,pending:rows.length,pending_bytes:bytes,
  inflight:inflight?{after_sequence:inflight.after_sequence,through_sequence:inflight.through_sequence,events:inflight.events.length}:null,fault,
  ...(fault?{last_pending:rows.length?{sequence:rows.at(-1).sequence,kind:rows.at(-1).kind,reason:rows.at(-1).reason??null}:null}:{})})};
}
