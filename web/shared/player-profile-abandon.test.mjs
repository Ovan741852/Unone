// Real createRuntimeBackend queue/admission under profiler open-set eviction (Root review3 red1).
// A deterministic worker returns legal packets or legal errors; no backend/profiler wrapper is mocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeBackend} from './runtime-backend.mjs';
import {createPlayerProfiler} from './raster-diagnostics.mjs';
function workerClass(fail){
 return class{postMessage({id,command}){queueMicrotask(()=>this.onmessage({data:command.kind==='init'?{id,ok:true,packet:{value:null,updates:[],removed:[]}}:
  fail(id)?{id,ok:false,error:'VIEWPORT_REJECTED_'+id}:{id,ok:true,packet:{value:{world:{frame:id}},updates:[],removed:[]}}}));}terminate(){}};
}
async function run(limit,fail=()=>false){
 const profiler=limit===null?null:createPlayerProfiler({limit});
 const backend=await createRuntimeBackend({kind:'worker',url:'http://unone.test/r.js',WorkerClass:workerClass(fail),...(profiler?{profiler}:{})});
 // 20 admitted requests, below the real queue limit of 32.
 const settled=await Promise.allSettled(Array.from({length:20},()=>backend.request({kind:'viewport',width:1280,height:720})));
 backend.close();
 return {profiler,results:settled.map(s=>s.status==='fulfilled'?{ok:s.value}:{error:String(s.reason?.message??s.reason)})};
}
test('success path: eviction of open events never changes valid command results',async()=>{
 const off=await run(null);assert.equal(off.results.filter(r=>r.ok).length,20);
 for(const limit of [64,16]){
  const on=await run(limit);assert.deepEqual(on.results,off.results,`limit ${limit}`);
 }
 const {profiler}=await run(16),r=profiler.report();
 assert.equal(r.counts.abandoned,4,'commands 2..5 were evicted from the bounded open set');
 assert.equal(r.counts.late_ends,4,'their later continuations are counted, not thrown');
 assert.equal(r.counts.begun,21);assert.equal(r.counts.completed,21,'a late end does not create a second record');
 assert.equal(r.counts.open,0);assert(r.events.length<=16);
 const ids=r.events.map(e=>e.id);assert.equal(new Set(ids).size,ids.length);
 assert.equal(JSON.stringify(r).includes('PLAYER_PROFILE_EVENT_CLOSED'),false);
});
test('error path: eviction never replaces a real command error',async()=>{
 const all=()=>true,odd=id=>id%2===1;
 for(const fail of [all,odd]){
  const off=await run(null,fail);assert(off.results.some(r=>r.error));
  const on=await run(16,fail);assert.deepEqual(on.results,off.results);
  for(const r of on.results)if(r.error)assert.match(r.error,/^VIEWPORT_REJECTED_\d+$/);
 }
});
