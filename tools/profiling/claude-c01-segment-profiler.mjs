// Explicit opt-in segmented host wall-time profiler.
// - Disabled (default) profilers run callbacks directly and record nothing.
// - Time comes only from the injected host wall clock; there is no dt input, and the
//   profiler never reads or writes a simulation clock or RNG.
// - Segments must nest. Nested time is reported as inclusive and exclusive; summaries
//   never add a child's time into its parent's exclusive time, so overlap is not counted twice.
// - One record per independent update. Percentiles are computed over records, never
//   over repeated draws of one update unless the caller records each as its own update.
const isPromise=v=>v!==null&&typeof v==='object'&&typeof v.then==='function';
export function percentile(sorted,p){
 if(!sorted.length)return null;
 // Nearest-rank: smallest value with at least p% of samples <= value.
 return sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(p/100*sorted.length)-1))];
}
export function distribution(values){
 const s=values.filter(Number.isFinite).sort((a,b)=>a-b);
 return {count:s.length,p50:percentile(s,50),p95:percentile(s,95),p99:percentile(s,99),max:s.length?s[s.length-1]:null};
}
export function createSegmentProfiler({enabled=false,now=()=>performance.now(),counters=null}={}){
 if(typeof enabled!=='boolean')throw TypeError('PROFILE_ENABLED_BOOLEAN_REQUIRED');
 if(typeof now!=='function')throw TypeError('PROFILE_CLOCK_REQUIRED');
 if(counters!==null&&typeof counters!=='function')throw TypeError('PROFILE_COUNTERS_FUNCTION_REQUIRED');
 const records=[];let current=null;
 // Copy numeric values now: a provider may return one live, mutable stats object every time.
 const sample=()=>{const v=counters();return Object.fromEntries(Object.entries(v??{}).filter(([,n])=>typeof n==='number'));};
 function open(name){
  const frame={name,start:now(),children:0,owner:current};
  current.stack.push(frame);return frame;
 }
 function close(frame){
  // A segment outliving its failed/finished update is ignored; that update was never recorded.
  if(frame.owner!==current)return;
  const top=current.stack[current.stack.length-1];
  if(top!==frame)throw Error('PROFILE_SEGMENT_OVERLAP: '+frame.name+' closed while '+top?.name+' is open');
  current.stack.pop();const inclusive=now()-frame.start;
  const row=current.segments[frame.name]??={inclusive_ms:0,exclusive_ms:0,calls:0};
  row.inclusive_ms+=inclusive;row.exclusive_ms+=inclusive-frame.children;row.calls++;
  const parent=current.stack[current.stack.length-1];if(parent)parent.children+=inclusive;else current.top+=inclusive;
 }
 function run(frame,fn,finish){
  let value;
  try{value=fn();}catch(error){finish(frame);throw error;}
  if(isPromise(value))return value.then(v=>{finish(frame);return v;},e=>{finish(frame);throw e;});
  finish(frame);return value;
 }
 function segment(name,fn){
  if(!enabled)return fn();
  if(typeof name!=='string'||!name)throw TypeError('PROFILE_SEGMENT_NAME_REQUIRED');
  if(!current)throw Error('PROFILE_SEGMENT_OUTSIDE_UPDATE: '+name);
  return run(open(name),fn,close);
 }
 function update(id,fn,meta=undefined){
  if(!enabled)return fn();
  if(current)throw Error('PROFILE_UPDATE_NESTED');
  const before=counters?sample():null;
  current={id,start:now(),stack:[],segments:{},top:0,meta};
  // A failed update is discarded and its original error propagates unchanged.
  const fail=error=>{current=null;throw error;};
  const finish=()=>{
   const r=current;current=null;
   if(r.stack.length)throw Error('PROFILE_SEGMENT_UNCLOSED: '+r.stack.map(f=>f.name).join(','));
   const wall=now()-r.start,after=counters?sample():null;
   const delta=before&&after?Object.fromEntries(Object.keys(after).map(k=>[k,after[k]-(before[k]??0)])):null;
   records.push({id:r.id,wall_ms:wall,unattributed_ms:Math.max(0,wall-r.top),segments:r.segments,
    ...(delta?{counter_delta:delta,counters_after:after}:{}),...(r.meta!==undefined?{meta:r.meta}:{})});
  };
  let value;
  try{value=fn();}catch(error){fail(error);}
  if(isPromise(value))return value.then(v=>{finish();return v;},fail);
  finish();return value;
 }
 return {enabled,segment,update,
  records:()=>records.map(r=>structuredClone(r)),
  reset(){if(current)throw Error('PROFILE_UPDATE_ACTIVE');records.length=0;},
  summary(){
   const names=[...new Set(records.flatMap(r=>Object.keys(r.segments)))].sort();
   return {updates:records.length,
    wall_ms:distribution(records.map(r=>r.wall_ms)),unattributed_ms:distribution(records.map(r=>r.unattributed_ms)),
    segments:Object.fromEntries(names.map(n=>[n,{
     exclusive_ms:distribution(records.map(r=>r.segments[n]?.exclusive_ms??0)),
     inclusive_ms:distribution(records.map(r=>r.segments[n]?.inclusive_ms??0)),
     present_in_updates:records.filter(r=>r.segments[n]).length}]))};
  }};
}
