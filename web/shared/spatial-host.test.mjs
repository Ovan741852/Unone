import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpatialHost} from './spatial-host.mjs';

function bridge() {
  const calls=[];let length=0,tasks=[];
  const module={HEAPU8:new Uint8Array(65536),_unone_web_alloc:()=>0,
    _unone_web_observation_ptr:()=>32768,_unone_web_observation_len:()=>length};
  module._unone_web_spatial_request=(p,n)=>{
    const input=JSON.parse(new TextDecoder().decode(module.HEAPU8.slice(p,p+n)));
    calls.push(input);
    const response=input.kind==='drain'?tasks.splice(0):null;
    const bytes=new TextEncoder().encode(JSON.stringify(response));
    module.HEAPU8.set(bytes,32768);length=bytes.length;return 0;
  };
  return {module,calls,tasks};
}

test('CPU policy works with older runtimes and never creates a GPU device',async()=>{
  const host=createSpatialHost({}, {createExecutor:()=>assert.fail('unexpected GPU initialization')});
  await host.load();host.dispatch();await host.barrier();
  assert.equal(host.report().backend,'cpu');host.close();
});
test('closing during GPU creation retires the candidate without configuring a later runtime',async()=>{
 const {module,calls}=bridge();let release,entered;const starting=new Promise(resolve=>entered=resolve);
 const candidate=new Promise(resolve=>release=resolve);let disposed=0;
 const host=createSpatialHost(module,{backend:'gpu',createExecutor:async()=>{entered();return candidate;}});
 const loading=host.load();await starting;host.close();release({close(){disposed++;},execute(){assert.fail('retired executor');}});
 await assert.rejects(loading,/SPATIAL_SESSION_RETIRED/);assert.equal(disposed,1);assert.equal(calls.length,0);
});

test('GPU completion is awaited and delivered in submission order before the next tick',async()=>{
  const {module,calls,tasks}=bridge();let release;
  const gate=new Promise(resolve=>release=resolve),seen=[];
  const host=createSpatialHost(module,{backend:'gpu',createExecutor:async()=>({
    async execute(batch){seen.push(batch.version);await gate;return {version:batch.version,results:[]};},close(){},
  })});
  await host.load();tasks.push({id:1,batch:{version:3}},{id:2,batch:{version:4}});host.dispatch();
  let passed=false;const barrier=host.barrier().then(()=>passed=true);
  await Promise.resolve();assert.equal(passed,false);
  assert.equal(calls.filter(call=>call.kind==='complete').length,0);
  release();await barrier;
  assert.deepEqual(seen,[3,4]);
  assert.deepEqual(calls.filter(call=>call.kind==='complete').map(call=>call.id),[1,2]);
  host.close();
});

test('auto reports initialization fallback while forced GPU fails',async()=>{
  const createExecutor=async()=>{throw Error('adapter unavailable');};
  const auto=createSpatialHost(bridge().module,{backend:'auto',createExecutor});
  await auto.load();assert.equal(auto.report().backend,'cpu');
  assert.match(auto.report().fallback_reason,/adapter unavailable/);
  await assert.rejects(createSpatialHost(bridge().module,{backend:'gpu',createExecutor}).load(),/adapter unavailable/);
  const legacy=createSpatialHost({}, {backend:'auto'});await legacy.load();
  assert.match(legacy.report().fallback_reason,/SPATIAL_ABI_UNAVAILABLE/);
});

test('execution failure faults the runtime instead of completing with default data',async()=>{
  const {module,calls,tasks}=bridge();
  const host=createSpatialHost(module,{backend:'gpu',createExecutor:async()=>({
    async execute(){throw Error('device lost');},close(){},
  })});
  await host.load();tasks.push({id:1,batch:{version:1}});host.dispatch();
  await assert.rejects(host.barrier(),/device lost/);
  assert.equal(calls.some(call=>call.kind==='complete'),false);
  assert.equal(calls.filter(call=>call.kind==='fault').length,1);host.close();
});

test('reload retires old task completions without injecting them into the new epoch',async()=>{
  const {module,calls,tasks}=bridge();let release;
  const gate=new Promise(resolve=>release=resolve);
  const host=createSpatialHost(module,{backend:'gpu',createExecutor:async()=>({
    async execute(){await gate;return {version:1,results:[]};},close(){},
  })});
  await host.load();tasks.push({id:1,batch:{version:1}});host.dispatch();
  await Promise.resolve();const reload=host.load();release();await reload;
  assert.equal(calls.some(call=>call.kind==='complete'),false);host.close();
});

test('host forwards optional execution profiles separately from canonical query results',async()=>{
  const {module,calls,tasks}=bridge();
  const profile={clock:'host_monotonic',total_ms:1,phases_ms:{preparation:0,queue_wait:0,validation:0,packing:0.1,upload:0.2,encode_submit:0.1,readback_wait:0.4,decode:0.1,cpu_execute:null,gpu_kernel:null},gpu_kernel_unavailable_reason:'GPU timestamp queries are not enabled; host timings do not measure kernel duration',upload_bytes:128,readback_bytes:3088};
  const host=createSpatialHost(module,{backend:'gpu',createExecutor:async()=>({async execute(batch){return {version:batch.version,results:[]};},profile:()=>profile,close(){}})});
  await host.load();tasks.push({id:1,batch:{version:3}});host.dispatch();await host.barrier();
  const completion=calls.find(call=>call.kind==='complete');assert.deepEqual(completion.result,{version:3,results:[]});assert.deepEqual(completion.profile,profile);
  const report=host.report();assert.deepEqual(report.profile,profile);report.profile.total_ms=-1;assert.equal(host.report().profile.total_ms,1);
  host.close();
});
