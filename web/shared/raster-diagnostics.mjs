// Presentation observations only. Old READY is historical, never a current lease.
export function publishRasterState(metrics,body,raster,info=()=>{}){
 metrics.raster=raster;body.dataset.playerMetrics=JSON.stringify(metrics);body.dataset.playerRaster=JSON.stringify(raster);
 info('UNONE_RASTER_STATE '+JSON.stringify(raster));
}
export function assertRasterReady(raster,gameDraws){
 const p=raster?.projected;
 if(p?.requested==='upper_left_checked'&&(p.status!=='validated'||!p.last_validation||gameDraws<1||
   p.last_validation.context_epoch!==p.context_epoch||p.last_validation.target_generation!==p.target_generation))
  throw Error('PROJECTED_RASTER_NOT_VALIDATED: READY requires actual current GPU gate and a legal game draw');
}

// Explicit opt-in host profiling for the official player (?unone_profile=1).
// Disabled players hold no profiler: every call site is a single null branch, with no
// clock reads, records or counters. Times are host wall time from the injected clock and
// are never fed into simulation, scheduling or input. Payloads are never recorded.
export const PLAYER_PROFILE_SCHEMA='unone.player-profile.v1';
export function playerProfileOptions(search){
 const q=new URLSearchParams(search);if(q.get('unone_profile')!=='1')return null;
 const raw=q.get('unone_profile_limit');if(raw===null)return {limit:256};
 const limit=Number(raw);if(!/^[0-9]+$/.test(raw)||limit<16||limit>2048)throw Error('PLAYER_PROFILE_LIMIT_INVALID: 16..2048');
 return {limit};
}
const ATTR_TEXT_LIMIT=128;
// Classify an error by its leading code only; free text may embed observation/save data.
export function profileErrorCode(error){return /^[A-Z][A-Z0-9_]{2,63}/.exec(String(error?.message??error??''))?.[0]??'UNCLASSIFIED';}
function primitive(v){return v===null||typeof v==='boolean'||(typeof v==='number'&&Number.isFinite(v))||(typeof v==='string'&&v.length<=ATTR_TEXT_LIMIT);}
function copyValues(value,numericOnly){
 const out={};for(const [k,v] of Object.entries(value??{}))if(numericOnly?typeof v==='number'&&Number.isFinite(v):primitive(v))out[k]=v;return out;
}
function createProfileRing(limit){
 let events=[],overwritten=0,cleared=0;
 return {push(e){if(events.length===limit){events.shift();overwritten++;}events.push(e);},
  list:()=>events.map(e=>structuredClone(e)),clear(){cleared+=events.length;events=[];},counts:()=>({retained:events.length,overwritten,cleared})};
}
function profileEvent(kind,id,seq,start){return {id,kind,seq,status:'open',start_ms:start,end_ms:null,wall_ms:null,spans:[],attrs:{},resources:{},cursor:start,scope:null,outcome:null};}
function finished(e){const {cursor,scope,outcome,...rest}=e;return rest;}
export function createPlayerProfiler({now=()=>performance.now(),limit=256,publishTarget=null,publishEvery=30,timeOrigin=globalThis.performance?.timeOrigin??0}={}){
 const ring=createProfileRing(limit),open=new Map(),perKind=new Map(),providers=new Map(),sources=new WeakMap(),counters={};
 let seq=0,completed=0,sincePublish=0,current=null;const publishStats={count:0,last_ms:0,max_ms:0,total_ms:0};
 // Fixed-key diagnostics. Profiling must never change a caller's result or error: operations on an
 // event already closed (e.g. abandoned by the bounded open set) are no-ops counted here.
 const faults={abandoned:0,late_ends:0,late_operations:0,orphan_marks:0,dropped_attrs:0,provider_errors:0,publish_errors:0};
 const live=e=>open.get(e?.id)===e;
 function late(e){if(live(e))return false;faults.late_operations++;return true;}
 function set(e,attrs){for(const [k,v] of Object.entries(attrs??{})){if(k==='error'){e.attrs.error_code=profileErrorCode(v);continue;}if(primitive(v))e.attrs[k]=v;else faults.dropped_attrs++;}}
 function begin(kind,attrs){
  if(open.size>=limit){const [,oldest]=open.entries().next().value;faults.abandoned++;close(oldest,'abandoned');}
  const n=(perKind.get(kind)??0)+1;perKind.set(kind,n);const e=profileEvent(kind,`${kind}:${n}`,++seq,now());set(e,attrs);open.set(e.id,e);return e;
 }
 function addSpan(e,name,start,end,parent=null){e.spans.push({name,parent,start_ms:start,end_ms:end,ms:end-start});}
 function addMark(e,name){const t=now();if(e.scope){addSpan(e,name,e.scope.cursor,t,e.scope.name);e.scope.cursor=t;}else{addSpan(e,name,e.cursor,t);e.cursor=t;}}
 function sampleProviders(e,phase){
  for(const [name,{fn,mode}] of providers){if(phase==='before'&&mode==='after')continue;
   let raw;try{raw=fn();}catch{faults.provider_errors++;continue;}
   const values=copyValues(raw,mode==='delta'),row=e.resources[name]??={};row[phase]=values;
   if(phase==='after'&&row.before)row.delta=Object.fromEntries(Object.keys(values).map(k=>[k,values[k]-(row.before[k]??0)]));}
 }
 function within(e,name,fn){
  // The callback always runs and its value/error propagates unchanged.
  if(late(e))return fn();
  const parent={name,cursor:now()};e.scope=parent;current=e;sampleProviders(e,'before');
  try{return fn();}finally{current=null;if(!late(e)){sampleProviders(e,'after');e.scope=null;addMark(e,name);}}
 }
 function close(e,status,attrs){
  open.delete(e.id);set(e,attrs);e.status=status;e.end_ms=now();e.wall_ms=e.end_ms-e.start_ms;completed++;
  const record=finished(e);ring.push(record);
  if(publishTarget&&(++sincePublish>=publishEvery||!['ok','completed'].includes(status)))publish();
  return record;
 }
 // Returns the ended record, or null for a late end of an already closed event.
 function end(e,status,attrs){if(!live(e)){faults.late_ends++;return null;}return structuredClone(close(e,status,attrs));}
 function report(){
  return {schema:PLAYER_PROFILE_SCHEMA,enabled:true,limit,time_origin_ms:timeOrigin,
   clock:'host performance.now() milliseconds in the main realm; worker spans are converted with performance.timeOrigin and may skew by clock resolution',
   semantics:'One record per event identity. Sibling spans are disjoint and sequential; a span with parent P lies inside span P. Never add a parent and its children. CPU submission only: GPU execution and display presentation are not measured. An abandoned event (bounded open set) keeps its partial record; its later operations are counted in late_ends/late_operations only.',
   counts:{begun:seq,completed,open:open.size,...ring.counts(),...faults,...counters},
   publish:{...publishStats},events:ring.list(),
   open:[...open.values()].map(e=>({id:e.id,kind:e.kind,start_ms:e.start_ms,age_ms:now()-e.start_ms,spans:structuredClone(e.spans),attrs:{...e.attrs}}))};
 }
 function publish(){
  // count includes the publication carrying it; *_ms describe completed publications.
  if(!publishTarget)return;const t=now();publishStats.count++;
  try{publishTarget.dataset.playerProfile=JSON.stringify(report());}catch{publishStats.count--;faults.publish_errors++;return;}
  const ms=now()-t;sincePublish=0;publishStats.last_ms=ms;publishStats.total_ms+=ms;publishStats.max_ms=Math.max(publishStats.max_ms,ms);
 }
 const renderer={
  mark(name){if(!current)faults.orphan_marks++;else if(!late(current))addMark(current,name);},
  outcome(status){if(!current)faults.orphan_marks++;else if(!late(current))current.outcome=status;},
  attach(fn){if(!current)faults.orphan_marks++;else if(!late(current))set(current,fn());},
  record:(kind,status,attrs)=>record(kind,status,attrs)};
 function record(kind,status,attrs){return end(begin(kind,attrs),status);}
 return {now,timeOrigin,begin,end,within,record,renderer,report,publish,
  mark(e,name){if(!late(e))addMark(e,name);},span(e,name,start,stop,parent=null){if(!late(e))addSpan(e,name,start,stop,parent);},set(e,attrs){if(!late(e))set(e,attrs);},
  provide(name,fn,mode='delta'){if(!['delta','after'].includes(mode))throw Error('PLAYER_PROFILE_PROVIDER_MODE');providers.set(name,{fn,mode});},
  outcomeOf:e=>e.outcome,count(name){counters[name]=(counters[name]??0)+1;},
  tag(value,id){if(value&&typeof value==='object')sources.set(value,id);},sourceOf:value=>(value&&typeof value==='object'&&sources.get(value))||null,
  clear(){ring.clear();if(publishTarget)publish();}};
}
