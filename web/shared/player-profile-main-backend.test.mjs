// Real createRuntimeBackend(kind:'main') + real loadRuntime + real runtime-core over a fake WASM ABI.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeBackend} from './runtime-backend.mjs';
import {createPlayerProfiler} from './raster-diagnostics.mjs';
const heap=new Uint8Array(1<<20),OBS=65536,abi={log:[],frame:0,len:0,fail:false};
function publish(v){const b=new TextEncoder().encode(JSON.stringify(v));heap.set(b,OBS);abi.len=b.length;return 0;}
const world=()=>({world:{frame:abi.frame,instances3d:{}}});
const fake={HEAPU8:heap,_unone_web_alloc:()=>0,_unone_web_observation_ptr:()=>OBS,_unone_web_observation_len:()=>abi.len,
 _unone_web_load_project:()=>{abi.log.push('load');abi.frame=0;return publish(world());},_unone_web_set_instance_transport:()=>{abi.log.push('transport');return publish(world());},
 _unone_web_set_input_frame:()=>{abi.log.push('input');return 0;},_unone_web_tick:()=>{abi.log.push('tick');if(abi.fail)return 1;abi.frame++;return publish(world());}};
// Classic script injection as in the browser player.
globalThis.document={createElement:()=>({}),head:{append(){Object.assign(globalThis.Module,fake);globalThis.Module.onRuntimeInitialized();}}};
async function run(profiler){
 abi.log.length=0;abi.fail=false;const backend=await createRuntimeBackend({kind:'main',url:'http://unone.test/runtime.js',...(profiler?{profiler}:{})});
 const values=[await backend.request({kind:'load',payload:{config:{}},seed:'42'})];
 for(let i=0;i<2;i++)values.push(await backend.request({kind:'tick',input:{}},'update:'+(i+1)));
 return {backend,values:JSON.parse(JSON.stringify(values)),log:[...abi.log]};
}
test('main-thread backend: identical ABI sequence when disabled; enabled commands carry execute and atomic tick spans',async()=>{
 const now=performance.now.bind(performance);let reads=0;performance.now=()=>{reads++;return now();};
 let off;try{off=await run(null);}finally{performance.now=now;}
 // Pre-existing reads: 2 per command (start, execute_ms) + 2 for CPU spatial setup on load.
 // The same disabled run against the SDK3 (pre-review2) modules also reads 8 (review2/raw/clock-reads-sdk3-vs-sdk4.txt).
 assert.equal(reads,2*3+2,'disabled profiling adds no main-thread clock reads');
 const profiler=createPlayerProfiler({limit:32}),on=await run(profiler);
 assert.deepEqual(on.log,off.log);assert.deepEqual(on.values,off.values);
 const tick=profiler.report().events.find(e=>e.attrs.owner==='update:1');
 assert.deepEqual(tick.spans.filter(s=>s.parent===null).map(s=>s.name),['queue_wait','execute']);
 assert.deepEqual(tick.spans.filter(s=>s.parent==='execute').map(s=>s.name),['barrier_wait','input_abi','tick_abi_atomic','observation_copy','observation_utf8','observation_parse','jobs_dispatch','spatial_dispatch']);
 assert.equal(tick.attrs.backend,'main');assert.equal(tick.attrs.tick_abi,'atomic_update_and_serialization_unsplit');
 abi.fail=true;await assert.rejects(on.backend.request({kind:'tick',input:{}},'update:3'));
 const failed=profiler.report().events.at(-1);assert.equal(failed.status,'error');
 assert.deepEqual(failed.spans.filter(s=>s.parent==='execute').map(s=>s.name),['barrier_wait','input_abi'],'partial trace up to the failing ABI');
 off.backend.close();on.backend.close();
});
