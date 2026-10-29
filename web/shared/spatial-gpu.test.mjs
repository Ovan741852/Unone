import test from 'node:test';
import assert from 'node:assert/strict';
import {packSpatialGpuBatch,decodeSpatialGpuResults,validateSpatialGpuBatch,createSpatialGpuExecutor} from './spatial-gpu.mjs';

const batch=()=>({version:1,bodies:[{id:0xffffffff,position:[1,2,3],radius:2}],queries:[{kind:'sweep_sphere',from:[0,0,0],to:[4,0,0],radius:1,exclude_id:0}]});
test('binary layout preserves full u32 IDs, defaults, previous positions and exclusion presence',()=>{
 const b=batch(),data=packSpatialGpuBatch(b),bf=new Float32Array(data.bodies.buffer),qf=new Float32Array(data.queries.buffer);
 assert.equal(data.bodies[0],0xffffffff);assert.equal(data.bodies[1],1);assert.equal(bf[2],2);assert.deepEqual([...bf.slice(8,11)],[1,2,3]);
 assert.equal(data.queries[0],2);assert.equal(data.queries[1],0xffffffff);assert.equal(data.queries[2],0);assert.equal(data.queries[3],1);assert.deepEqual([...qf.slice(8,11)],[4,0,0]);
 assert.deepEqual([...data.params],[1,1,0,0]);
});
test('public GPU entrypoint rejects invalid or oversized input before device allocation',()=>{
 for(const change of [b=>b.bodies.push({...b.bodies[0]}),b=>b.bodies[0].position[1]=NaN,b=>b.bodies[0].position=new Array(3),b=>delete b.queries[0].from[1],b=>b.queries[0].radius=-1,b=>b.queries[0].mask=2**32,b=>b.extra=true,b=>b.queries[0].kind='damage',b=>b.queries=Array(1025).fill(b.queries[0])]){const b=batch();change(b);assert.throws(()=>validateSpatialGpuBatch(b));}
 assert.equal(packSpatialGpuBatch({version:1,bodies:[],queries:[]}).bodies.byteLength,48);
 // Rust deserializes to f32 before validating; browser input follows that rule.
 const rounded=batch();rounded.bodies[0].position=[1e6+0.01,0,0];rounded.bodies[0].radius=-1e-50;rounded.queries=[{kind:'nearest',point:[0,0,0],max_distance:3e38}];assert.doesNotThrow(()=>validateSpatialGpuBatch(rounded));rounded.queries[0].max_distance=1e100;assert.throws(()=>validateSpatialGpuBatch(rounded));
});
test('decoder returns contact data and fails atomically on overflow',()=>{
 const buffer=new ArrayBuffer(772*4),words=new Uint32Array(buffer),floats=new Float32Array(buffer);words[0]=1;words[4]=123;floats[5]=3;floats[6]=0.25;floats.set([1,2,3],8);floats.set([0,0,1],12);
 assert.deepEqual(decodeSpatialGpuResults(7,1,buffer),{version:7,results:[{hits:[{id:123,distance:3,fraction:0.25,point:[1,2,3],normal:[0,0,1]}]}]});
 words[1]=1;assert.throws(()=>decodeSpatialGpuResults(7,1,buffer),/exceeds 64/);assert.throws(()=>decodeSpatialGpuResults(7,2,buffer),/byte length/);
});
test('unavailable WebGPU rejects explicitly instead of reporting CPU work as GPU',async()=>{
 if(!globalThis.navigator?.gpu)await assert.rejects(createSpatialGpuExecutor(),/WebGPU is unavailable/);
});

test('executor profiles host phases without claiming GPU kernel duration or changing results',async()=>{
 const previousUsage=globalThis.GPUBufferUsage,previousMode=globalThis.GPUMapMode;
 globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,UNIFORM:4,COPY_SRC:8,MAP_READ:16};globalThis.GPUMapMode={READ:1};
 const events=[],buffers=[];let mapGate=null;
 const device={
  limits:{maxStorageBuffersPerShaderStage:3,maxStorageBufferBindingSize:1024*772*4,maxComputeInvocationsPerWorkgroup:64},
  lost:new Promise(()=>{}),createShaderModule(){return {};},async createComputePipelineAsync(){return {getBindGroupLayout:()=>({})};},
  createBuffer({label,size}){const data=new ArrayBuffer(size),buffer={async mapAsync(){events.push('map');if(mapGate)await mapGate;},getMappedRange:()=>data,unmap(){events.push('unmap');},destroy(){events.push('destroy');}};buffers.push({label,size});return buffer;},
  queue:{writeBuffer(){events.push('upload');},submit(){events.push('submit');}},
  createBindGroup(){return {};},pushErrorScope(){},async popErrorScope(){return null;},
  createCommandEncoder(){return {beginComputePass(){return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){events.push('dispatch');},end(){}};},copyBufferToBuffer(){},finish:()=>({})};},
 };
 try{
  const executor=await createSpatialGpuExecutor({device,shaderSource:'mock shader'});
  assert.equal(executor.profile(),null);
  assert.deepEqual(await executor.execute(batch()),{version:1,results:[{hits:[]}]});
  const profile=executor.profile();
  assert.equal(profile.clock,'host_monotonic');assert.ok(Number.isFinite(profile.total_ms)&&profile.total_ms>=0);
  for(const name of ['preparation','queue_wait','validation','packing','upload','encode_submit','readback_wait','decode'])assert.ok(Number.isFinite(profile.phases_ms[name])&&profile.phases_ms[name]>=0,name);
  assert.ok(profile.phases_ms.preparation>=profile.phases_ms.validation,'validation is nested within preparation');assert.ok(profile.total_ms>=profile.phases_ms.preparation);
  assert.equal(profile.phases_ms.cpu_execute,null);assert.equal(profile.phases_ms.gpu_kernel,null);
  assert.match(profile.gpu_kernel_unavailable_reason,/timestamp queries.*host timings do not measure kernel/);
  assert.equal(profile.upload_bytes,48+64+16);assert.equal(profile.readback_bytes,772*4);
  assert.ok(events.indexOf('submit')<events.indexOf('map'));assert.ok(events.includes('dispatch'));assert.equal(buffers.length,5);
  profile.phases_ms.upload=-1;assert.ok(executor.profile().phases_ms.upload>=0,'profile returns a detached copy');
  await assert.rejects(executor.execute({version:1,bodies:[],queries:[{kind:'nearest',point:[0,0,0],max_distance:-1}]}));
  assert.equal(executor.profile().readback_bytes,772*4,'rejected work preserves last successful sample');
  let radiusReads=0;const accessorBatch=batch(),allocated=buffers.length;
  Object.defineProperty(accessorBatch.bodies[0],'radius',{enumerable:true,get(){return ++radiusReads===1?0:-1;}});
  await assert.rejects(executor.execute(accessorBatch),/radius/);
  assert.equal(buffers.length,allocated,'validate the owned clone before allocating GPU buffers');
  let release;mapGate=new Promise(resolve=>release=resolve);
  const first=executor.execute(batch()),second=executor.execute({...batch(),version:2});
  await Promise.resolve();release();await Promise.all([first,second]);mapGate=null;
  const queued=executor.profile();assert.ok(queued.phases_ms.queue_wait>0);assert.ok(queued.total_ms>=queued.phases_ms.preparation+queued.phases_ms.queue_wait,'total includes preparation and queue latency');
  events.length=0;
  assert.deepEqual(await executor.execute({version:2,bodies:[],queries:[]}),{version:2,results:[]});
  const empty=executor.profile();assert.equal(empty.upload_bytes,0);assert.equal(empty.readback_bytes,0);assert.equal(empty.phases_ms.gpu_kernel,null);assert.match(empty.gpu_kernel_unavailable_reason,/No GPU dispatch/);assert.equal(events.length,0);
  executor.close();
 }finally{if(previousUsage===undefined)delete globalThis.GPUBufferUsage;else globalThis.GPUBufferUsage=previousUsage;if(previousMode===undefined)delete globalThis.GPUMapMode;else globalThis.GPUMapMode=previousMode;}
});
