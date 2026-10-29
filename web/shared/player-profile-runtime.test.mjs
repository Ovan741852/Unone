// Real runtime-worker.js + real createRuntimeBackend + real runtime-core over a fake WASM ABI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRuntimeBackend} from './runtime-backend.mjs';
import * as diagnostics from './raster-diagnostics.mjs';
const workerURL=new URL('./runtime-worker.js',import.meta.url),workerSource=fs.readFileSync(workerURL,'utf8');
const RUNTIME='http://unone.test/runtime/unone-player.js';
// One fake ABI per process: loadRuntime caches the realm's module by URL.
const abi={log:[],frame:0,fail:false,len:0};
const heap=new Uint8Array(1<<20),OBS=65536;
function publish(v){const b=new TextEncoder().encode(JSON.stringify(v));heap.set(b,OBS);abi.len=b.length;return 0;}
const world=()=>({world:{frame:abi.frame,instances3d:{},projected_frame:{draws:[]}}});
const fakeModule={HEAPU8:heap,_unone_web_alloc:n=>{abi.log.push('alloc:'+n);return 0;},_unone_web_observation_ptr:()=>OBS,_unone_web_observation_len:()=>abi.len,
 _unone_web_load_project:()=>{abi.log.push('load');abi.frame=0;return publish(world());},_unone_web_set_instance_transport:m=>{abi.log.push('transport:'+m);return publish(world());},
 _unone_web_set_input_frame:()=>{abi.log.push('input');return 0;},
 _unone_web_tick:()=>{abi.log.push('tick');if(abi.fail){publish({ok:false,code:'TICK_FAILED'});return 1;}abi.frame++;return publish(world());}};
function importScripts(url){// Realm loading happens once per process; it is not an ABI call.
 Object.assign(globalThis.Module,fakeModule);globalThis.Module.onRuntimeInitialized();}
// The dynamically imported runtime-core runs in this test's main realm, so the vm worker must
// share its clock here. Cross-realm alignment is exercised separately with a deterministic worker.
class VmWorker{
 constructor(url){
  assert.equal(new URL(url).pathname.endsWith('/runtime-worker.js'),true);
  const offset=0,ctx=vm.createContext({console,URL,TextEncoder,TextDecoder,structuredClone,setTimeout,location:{origin:'http://unone.test'},importScripts,
   performance:{now:()=>{VmWorker.clockReads++;return performance.now()-offset;},timeOrigin:performance.timeOrigin+offset},
   postMessage:(data,transfer)=>{this.received.push(data);setTimeout(()=>this.onmessage?.({data:structuredClone(data)}));}});
  this.sent=[];this.received=[];this.ctx=ctx;
  new vm.Script(workerSource,{filename:workerURL.href,importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER}).runInContext(ctx);
 }
 postMessage(message){this.sent.push(structuredClone(message));setTimeout(()=>this.ctx.onmessage({data:structuredClone(message)}));}
 terminate(){this.terminated=true;}
}
VmWorker.clockReads=0;
let lastWorker=null;class TrackedWorker extends VmWorker{constructor(u){super(u);lastWorker=this;}}
async function session(profiler){
 abi.log.length=0;abi.fail=false;
 const backend=await createRuntimeBackend({kind:'worker',url:RUNTIME,WorkerClass:TrackedWorker,...(profiler?{profiler}:{})});
 const values=[await backend.request({kind:'load',payload:{config:{}},seed:'42'},'startup')];
 for(let i=0;i<3;i++)values.push(await backend.request({kind:'tick',input:{actions:[]}},'update:'+(i+1)));
 return {backend,values,worker:lastWorker,log:[...abi.log]};
}
const profilerFor=()=>{assert.equal(typeof diagnostics.createPlayerProfiler,'function');return diagnostics.createPlayerProfiler({limit:64});};
const strip=v=>JSON.parse(JSON.stringify(v));
test('disabled profiling leaves ABI call order, worker messages and observations unchanged',async()=>{
 VmWorker.clockReads=0;const off=await session(null),offReads=VmWorker.clockReads;
 // Pre-existing worker metrics read the clock 3 times per non-init command (execute_ms, pack_ms).
 assert.equal(offReads,3*4,'disabled profiling adds no worker clock reads');
 const on=await session(profilerFor());
 assert.deepEqual(on.log,off.log,'identical WASM ABI call sequence');
 assert.deepEqual(strip(on.values),strip(off.values),'identical observations');
 assert.deepEqual(Object.keys(off.worker.sent[0].command).sort(),['device','jobPolicy','kind','requirePhysicalViewport','spatialBackend','url']);
 assert.deepEqual(off.worker.sent.map(m=>Object.keys(m).sort()),off.worker.sent.map(()=>['command','id','recycled']));
 assert.equal(off.worker.received.some(m=>m.metrics?.profile!==undefined),false,'no worker profile payload when disabled');
 assert.deepEqual(on.worker.sent.slice(1).map(m=>m.command),off.worker.sent.slice(1).map(m=>m.command),'non-init commands unchanged');
 off.backend.close();on.backend.close();
});
test('each backend command is one event with disjoint host spans, aligned worker spans and an atomic tick ABI',async()=>{
 const profiler=profilerFor(),{backend,values}=await session(profiler);
 const events=profiler.report().events.filter(e=>e.kind==='command');
 assert.deepEqual(events.map(e=>[e.id,e.attrs.command_kind,e.status,e.attrs.owner??null]),
  [['command:1','init','ok',null],['command:2','load','ok','startup'],['command:3','tick','ok','update:1'],['command:4','tick','ok','update:2'],['command:5','tick','ok','update:3']]);
 const tick=events[2],top=tick.spans.filter(s=>s.parent===null);
 assert.deepEqual(top.map(s=>s.name),['queue_wait','post_to_worker','worker_execute','worker_pack','worker_to_main','admission']);
 for(let i=1;i<top.length;i++)assert(Math.abs(top[i].start_ms-top[i-1].end_ms)<1e-6,'consecutive top-level spans');
 assert(top[0].start_ms>=tick.start_ms-1e-6&&top.at(-1).end_ms<=tick.end_ms+1e-6,'spans inside event wall');
 const core=tick.spans.filter(s=>s.parent==='worker_execute');
 assert.deepEqual(core.map(s=>s.name),['barrier_wait','input_abi','tick_abi_atomic','observation_copy','observation_utf8','observation_parse','jobs_dispatch','spatial_dispatch']);
 const exec=top.find(s=>s.name==='worker_execute');for(const s of core)assert(s.start_ms>=exec.start_ms-1e-6&&s.end_ms<=exec.end_ms+1e-6,'core span inside worker_execute');
 assert.equal(tick.attrs.tick_abi,'atomic_update_and_serialization_unsplit');assert.equal(tick.attrs.backend,'worker');
 assert.equal(tick.attrs.observation_bytes,new TextEncoder().encode(JSON.stringify(values[1])).length);
 assert.equal(profiler.sourceOf(values[1]),'command:3','snapshot tagged with its producing command');
 backend.close();
});
test('rejected, failed and closed requests are recorded with identity and status',async()=>{
 const profiler=profilerFor(),{backend}=await session(profiler);abi.fail=true;
 await assert.rejects(backend.request({kind:'tick',input:{}},'update:4'));
 const failed=profiler.report().events.at(-1);assert.deepEqual([failed.id,failed.status,failed.attrs.owner],['command:6','error','update:4']);
 assert.equal(failed.attrs.error_code,'UNCLASSIFIED','JSON observation error text is not exposed');
 abi.fail=false;const flood=Array.from({length:33},()=>backend.request({kind:'tick',input:{}}).catch(e=>e));
 const results=await Promise.all(flood);assert.equal(results.filter(r=>r instanceof Error&&/QUEUE_FULL/.test(r.message)).length,1);
 assert.equal(profiler.report().events.filter(e=>e.status==='rejected'&&e.attrs.error_code==='RUNTIME_QUEUE_FULL').length,1);
 backend.close();await assert.rejects(backend.request({kind:'tick',input:{}}),/RUNTIME_CLOSED/);
 const closed=profiler.report().events.at(-1);assert.deepEqual([closed.status,closed.attrs.error_code],['rejected','RUNTIME_CLOSED']);
 const ids=profiler.report().events.map(e=>e.id);assert.equal(new Set(ids).size,ids.length);
});
test('worker clock boundaries are converted with performance.timeOrigin, not assumed equal',async()=>{
 // Deterministic worker realm whose clock origin is 1000ms later than the main realm.
 let t=0;const profiler=diagnostics.createPlayerProfiler({now:()=>t,timeOrigin:5000});
 class Remote{postMessage({id,command}){
  const at=t;t+=1;setTimeout(()=>{t+=10;const reply=command.kind==='init'?{id,ok:true,packet:{value:null,updates:[],removed:[]}}:
   {id,ok:true,packet:{value:{world:{frame:1}},updates:[],removed:[]},metrics:{profile:{time_origin:6000,received_ms:at+1-1000,executed_ms:at+5-1000,packed_ms:at+6-1000,
    core:{kind:'tick',start_ms:at+1-1000,marks:[['barrier_wait',at+2-1000],['tick_abi_atomic',at+4-1000]],observation_bytes:9}}}};this.onmessage({data:reply});});}terminate(){}}
 const backend=await createRuntimeBackend({kind:'worker',url:RUNTIME,WorkerClass:Remote,profiler});
 t=100;await backend.request({kind:'tick',input:{}},'update:1');
 const e=profiler.report().events.at(-1);
 assert.deepEqual(e.spans.map(s=>[s.name,s.parent,s.start_ms,s.end_ms]),[
  ['queue_wait',null,100,100],['post_to_worker',null,100,101],['worker_execute',null,101,105],['barrier_wait','worker_execute',101,102],
  ['tick_abi_atomic','worker_execute',102,104],['worker_pack',null,105,106],['worker_to_main',null,106,111],['admission',null,111,111]]);
 assert.equal(e.attrs.clock_alignment,'worker performance.timeOrigin');assert.equal(e.attrs.observation_bytes,9);backend.close();
});
