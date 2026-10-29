// Deterministic fault injection through the official host/core/executor.
// The ABI and WebGPU device below are synthetic: these are lifecycle tests,
// not evidence that a real driver/device-loss event was reproduced.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpatialHost} from './spatial-host.mjs';
import {createRuntimeCore} from './runtime-core.mjs';
import {createSpatialGpuExecutor} from './spatial-gpu.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve=yes; reject=no; });
  return {promise, resolve, reject};
}

function bridge({onTick}={}) {
  const calls=[], tasks=[], inputs=[];
  let length=0, frame=0, generation=0;
  const module={
    HEAPU8:new Uint8Array(65536), _unone_web_alloc:()=>0,
    _unone_web_observation_ptr:()=>32768, _unone_web_observation_len:()=>length,
  };
  const snapshot=()=>({world:{frame,instances3d:{}}});
  const publish=value=>{
    const bytes=new TextEncoder().encode(JSON.stringify(value));
    module.HEAPU8.set(bytes,32768);length=bytes.length;return 0;
  };
  const input=(p,n)=>JSON.parse(new TextDecoder().decode(module.HEAPU8.slice(p,p+n)));
  module._unone_web_spatial_request=(p,n)=>{
    const request=input(p,n);calls.push({...request,generation});
    return publish(request.kind==='drain'?tasks.splice(0):null);
  };
  module._unone_web_load_project=()=>{generation++;frame=0;tasks.length=0;return publish(snapshot());};
  module._unone_web_set_instance_transport=()=>publish(snapshot());
  module._unone_web_set_input_frame=(p,n)=>{inputs.push(input(p,n));return 0;};
  module._unone_web_tick=()=>{frame++;onTick?.({frame,generation,tasks});return publish(snapshot());};
  return {module,calls,tasks,inputs,get frame(){return frame;},get generation(){return generation;}};
}

test('auto execution failure stays terminal on WebGPU and suppresses the rest of a task group',async()=>{
  const {module,calls,tasks}=bridge(), seen=[];
  const host=createSpatialHost(module,{backend:'auto',createExecutor:async()=>({
    async execute(batch){seen.push(batch.version);throw Error('synthetic device lost');},close(){},
  })});
  await host.load();tasks.push({id:1,batch:{version:1}},{id:2,batch:{version:2}});host.dispatch();
  await assert.rejects(host.barrier(),/synthetic device lost/);
  assert.deepEqual(seen,[1]);
  assert.equal(calls.filter(call=>call.kind==='complete').length,0);
  assert.equal(calls.filter(call=>call.kind==='fault').length,1);
  assert.equal(host.report().backend,'webgpu');
  assert.equal(host.report().fallback_reason,null,'auto fallback is initialization-only');
  await assert.rejects(host.barrier(),/synthetic device lost/);
  host.close();
});

test('a rejected old executor promise cannot fault or complete the reloaded host epoch',async()=>{
  const {module,calls,tasks}=bridge(), gate=deferred(), started=deferred();
  let created=0,closed=0;
  const host=createSpatialHost(module,{backend:'gpu',createExecutor:async()=>{
    const version=++created;
    return {async execute(batch){if(version===1){started.resolve();await gate.promise;}return {version:batch.version,results:[]};},close(){closed++;}};
  }});
  await host.load();tasks.push({id:1,batch:{version:1}});host.dispatch();await started.promise;
  const reload=host.load();gate.reject(Error('synthetic stale device error'));await reload;
  assert.equal(host.report().fault,null);assert.equal(closed,1);
  assert.equal(calls.some(call=>call.kind==='fault'||call.kind==='complete'),false);
  tasks.push({id:2,batch:{version:2}});host.dispatch();await host.barrier();
  assert.deepEqual(calls.filter(call=>call.kind==='complete').map(call=>call.id),[2]);
  host.close();assert.equal(closed,2);
});

test('closing the host suppresses both delayed success and delayed rejection',async t=>{
  for(const fail of [false,true])await t.test(fail?'late rejection':'late success',async()=>{
    const {module,calls,tasks}=bridge(), gate=deferred(), started=deferred();let closed=0;
    const host=createSpatialHost(module,{backend:'gpu',createExecutor:async()=>({
      async execute(){started.resolve();await gate.promise;return {version:1,results:[]};},close(){closed++;},
    })});
    await host.load();tasks.push({id:1,batch:{version:1}});host.dispatch();await started.promise;
    const barrier=host.barrier();host.close();
    if(fail)gate.reject(Error('synthetic closed executor error'));else gate.resolve();
    await barrier;
    assert.equal(closed,1);assert.equal(host.report().fault,null);
    assert.equal(calls.some(call=>call.kind==='complete'||call.kind==='fault'),false);
  });
});

test('the official runtime core waits before applying input or advancing the next tick',async()=>{
  const fixture=bridge({onTick({frame,tasks}){if(frame===1)tasks.push({id:1,batch:{version:1}});}});
  const gate=deferred(),started=deferred();
  const core=createRuntimeCore(fixture.module,{spatialBackend:'gpu',createSpatialExecutor:async()=>({
    async execute(batch){started.resolve();await gate.promise;return {version:batch.version,results:[]};},close(){},
  })});
  await core.execute({kind:'load',payload:{config:{}}});
  await core.execute({kind:'tick',input:{tag:'first'}});await started.promise;
  let advanced=false;
  const second=core.execute({kind:'tick',input:{tag:'second'}}).then(value=>{advanced=true;return value;});
  await Promise.resolve();await Promise.resolve();
  assert.equal(advanced,false);assert.equal(fixture.frame,1);
  assert.deepEqual(fixture.inputs,[{tag:'first'}]);
  gate.resolve();const result=await second;
  assert.equal(result.world.frame,2);assert.deepEqual(fixture.inputs,[{tag:'first'},{tag:'second'}]);
  assert.equal(fixture.calls.filter(call=>call.kind==='complete').length,1);
  core.close();
});

test('the official runtime core blocks ticks after execution failure and recovers by a fresh load',async()=>{
  const fixture=bridge({onTick({frame,generation,tasks}){if(frame===1)tasks.push({id:generation,batch:{version:generation}});}});
  let created=0,closed=0;
  const core=createRuntimeCore(fixture.module,{spatialBackend:'auto',createSpatialExecutor:async()=>{
    const executor=++created;
    return {async execute(batch){if(executor===1)throw Error('synthetic core device loss');return {version:batch.version,results:[]};},close(){closed++;}};
  }});
  await core.execute({kind:'load',payload:{config:{}}});
  await core.execute({kind:'tick',input:{tag:'first'}});
  await assert.rejects(core.execute({kind:'tick',input:{tag:'blocked'}}),/synthetic core device loss/);
  assert.equal(fixture.frame,1);assert.deepEqual(fixture.inputs,[{tag:'first'}]);
  assert.equal(core.report().spatial.backend,'webgpu');assert.equal(core.report().spatial.fallback_reason,null);
  await core.execute({kind:'load',payload:{config:{}}});
  assert.equal(core.report().spatial.fault,null);assert.equal(closed,1);
  await core.execute({kind:'tick',input:{tag:'reloaded'}});
  await core.execute({kind:'tick',input:{tag:'after-completion'}});
  assert.equal(fixture.frame,2);
  assert.deepEqual(fixture.calls.filter(call=>call.kind==='fault').map(call=>call.generation),[1]);
  assert.deepEqual(fixture.calls.filter(call=>call.kind==='complete').map(call=>[call.generation,call.id]),[[2,2]]);
  core.close();assert.equal(closed,2);
});

const batch=()=>({version:1,bodies:[{id:17,position:[1,0,0],radius:1}],queries:[{kind:'nearest',point:[0,0,0],max_distance:10}]});

function syntheticDevice() {
  const lost=deferred(),events=[],buffers=[];
  let mapFailure=false,validationFailure=false,pops=0;
  const device={
    limits:{maxStorageBuffersPerShaderStage:3,maxStorageBufferBindingSize:1024*772*4,maxComputeInvocationsPerWorkgroup:64},
    lost:lost.promise,createShaderModule:()=>({}),async createComputePipelineAsync(){return {getBindGroupLayout:()=>({})};},
    createBuffer({size}){
      const data=new ArrayBuffer(size),buffer={
        async mapAsync(){events.push('map');if(mapFailure)throw Error('synthetic map failure');},
        getMappedRange:()=>data,unmap(){events.push('unmap');},destroy(){events.push('destroy');},
      };buffers.push(buffer);return buffer;
    },
    queue:{writeBuffer(){events.push('upload');},submit(){events.push('submit');}},
    createBindGroup:()=>({}),pushErrorScope(){events.push('push');},
    async popErrorScope(){events.push('pop');return validationFailure&&++pops%2===1?{message:'synthetic validation failure'}:null;},
    createCommandEncoder:()=>({beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}}),copyBufferToBuffer(){},finish:()=>({})}),
    destroy(){events.push('device-destroy');},
  };
  return {device,lost,events,buffers,set mapFailure(value){mapFailure=value;},set validationFailure(value){validationFailure=value;}};
}

async function withGpuConstants(run) {
  const previousUsage=globalThis.GPUBufferUsage,previousMode=globalThis.GPUMapMode;
  globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,UNIFORM:4,COPY_SRC:8,MAP_READ:16};globalThis.GPUMapMode={READ:1};
  try{await run();}finally{
    if(previousUsage===undefined)delete globalThis.GPUBufferUsage;else globalThis.GPUBufferUsage=previousUsage;
    if(previousMode===undefined)delete globalThis.GPUMapMode;else globalThis.GPUMapMode=previousMode;
  }
}

test('the official GPU executor observes synthetic device loss before allocating later work',async()=>withGpuConstants(async()=>{
  const fixture=syntheticDevice();
  const executor=await createSpatialGpuExecutor({device:fixture.device,shaderSource:'synthetic shader'});
  await executor.execute(batch());const successful=executor.profile(),allocated=fixture.buffers.length;
  fixture.lost.resolve({reason:'unknown',message:'synthetic device loss signal'});await Promise.resolve();
  await assert.rejects(executor.execute(batch()),/device lost.*synthetic device loss signal/);
  assert.equal(fixture.buffers.length,allocated);assert.deepEqual(executor.profile(),successful);
  assert.equal(executor.describe().pending,0);assert.equal(executor.describe().device_loss.message,'synthetic device loss signal');
  executor.close();assert.equal(fixture.events.includes('device-destroy'),false,'supplied device remains host-owned');
}));

test('map and validation failures clean every allocated buffer and preserve the last successful profile',async t=>{
  for(const failure of ['map','validation'])await t.test(failure,async()=>withGpuConstants(async()=>{
    const fixture=syntheticDevice();
    const executor=await createSpatialGpuExecutor({device:fixture.device,shaderSource:'synthetic shader'});
    await executor.execute(batch());const successful=executor.profile();fixture.events.length=0;
    if(failure==='map')fixture.mapFailure=true;else fixture.validationFailure=true;
    await assert.rejects(executor.execute({...batch(),version:2}),new RegExp(`synthetic ${failure} failure`));
    assert.equal(fixture.events.filter(event=>event==='destroy').length,5);
    assert.equal(fixture.events.filter(event=>event==='push').length,2);
    assert.equal(fixture.events.filter(event=>event==='pop').length,2);
    assert.equal(fixture.events.filter(event=>event==='unmap').length,failure==='map'?0:1);
    assert.deepEqual(executor.profile(),successful);assert.equal(executor.describe().pending,0);
    executor.close();
  }));
});
