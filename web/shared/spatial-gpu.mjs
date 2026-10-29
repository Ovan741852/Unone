// Engine-owned WebGPU executor for the canonical spatial batch protocol.
// v1 scans one body array per query and reads back results. It has no gameplay
// dependencies and makes no claim of outperforming the CPU at small batch sizes.
const BODY_WORDS=12, QUERY_WORDS=16, HIT_WORDS=12, RESULT_WORDS=772;
const MAX_BODIES=65536, MAX_QUERIES=1024, MAX_HITS=64, LIMIT=1e6;
const u32=(value,label)=>{if(!Number.isInteger(value)||value<0||value>0xffffffff)throw Error(`${label} must be a u32`);return value;};
const scalar=(value,label)=>{if(typeof value!=='number'||!Number.isFinite(value)||Math.fround(value)<0||Math.fround(value)>LIMIT)throw Error(`${label} must be finite and in [0, ${LIMIT}]`);return value;};
const distance=(value,label)=>{if(typeof value!=='number'||!Number.isFinite(Math.fround(value))||Math.fround(value)<0)throw Error(`${label} must be a finite nonnegative f32`);return value;};
const coordinate=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(Math.fround(n))<=LIMIT;
const vector=(value,label)=>{if(!Array.isArray(value)||value.length!==3||!coordinate(value[0])||!coordinate(value[1])||!coordinate(value[2]))throw Error(`${label} must contain three finite coordinates in [-${LIMIT}, ${LIMIT}]`);return value;};
function fields(value,allowed,label){if(!value||typeof value!=='object'||Array.isArray(value))throw Error(`${label} must be an object`);for(const key of Object.keys(value))if(!allowed.includes(key))throw Error(`${label}: unknown field ${key}`);}

/** Validates a public batch before allocating GPU resources. */
export function validateSpatialGpuBatch(batch){
 fields(batch,['version','bodies','queries'],'batch');u32(batch.version,'version');
 if(!Array.isArray(batch.bodies)||batch.bodies.length>MAX_BODIES)throw Error(`bodies must be an array of at most ${MAX_BODIES}`);
 if(!Array.isArray(batch.queries)||batch.queries.length>MAX_QUERIES)throw Error(`queries must be an array of at most ${MAX_QUERIES}`);
 const ids=new Set();for(const body of batch.bodies){fields(body,['id','position','radius','category','previous_position'],'body');u32(body.id,'body.id');if(ids.has(body.id))throw Error(`duplicate body id ${body.id}`);ids.add(body.id);vector(body.position,'body.position');scalar(body.radius,'body.radius');u32(body.category===undefined?1:body.category,'body.category');if(body.previous_position!=null)vector(body.previous_position,'body.previous_position');}
 for(const query of batch.queries){
  const common=['kind','mask','exclude_id'];
  if(query?.kind==='nearest'){fields(query,[...common,'point','max_distance'],'query');vector(query.point,'query.point');distance(query.max_distance,'query.max_distance');}
  else if(query?.kind==='overlap_sphere'){fields(query,[...common,'center','radius'],'query');vector(query.center,'query.center');scalar(query.radius,'query.radius');}
  else if(query?.kind==='sweep_sphere'){fields(query,[...common,'from','to','radius'],'query');vector(query.from,'query.from');vector(query.to,'query.to');scalar(query.radius,'query.radius');}
  else throw Error(`unsupported spatial query kind: ${query?.kind}`);
  u32(query.mask===undefined?0xffffffff:query.mask,'query.mask');if(query.exclude_id!=null)u32(query.exclude_id,'query.exclude_id');
 }
 return batch;
}

/** Shared wire layout, exported for host contract tests and offline inspection. */
export function packSpatialGpuBatch(batch){
 validateSpatialGpuBatch(batch);
 return packValidatedBatch(batch);
}

function packValidatedBatch(batch){
 const bodies=new Uint32Array(Math.max(1,batch.bodies.length)*BODY_WORDS),bf=new Float32Array(bodies.buffer);
 for(let i=0;i<batch.bodies.length;i++){const b=batch.bodies[i],o=i*BODY_WORDS;bodies[o]=b.id;bodies[o+1]=b.category??1;bf[o+2]=b.radius;bf.set(b.position,o+4);bf.set(b.previous_position??b.position,o+8);}
 const queries=new Uint32Array(batch.queries.length*QUERY_WORDS),qf=new Float32Array(queries.buffer);
 for(let i=0;i<batch.queries.length;i++){const q=batch.queries[i],o=i*QUERY_WORDS;queries[o]=q.kind==='nearest'?0:q.kind==='overlap_sphere'?1:2;queries[o+1]=q.mask??0xffffffff;queries[o+2]=q.exclude_id??0;queries[o+3]=q.exclude_id==null?0:1;qf.set(q.point??q.center??q.from,o+4);qf[o+7]=q.radius??0;qf.set(q.to??[0,0,0],o+8);qf[o+11]=q.max_distance??0;}
 return {bodies,queries,params:new Uint32Array([batch.bodies.length,batch.queries.length,0,0])};
}

export function decodeSpatialGpuResults(version,count,buffer){
 const words=new Uint32Array(buffer),floats=new Float32Array(buffer);
 if(words.length!==count*RESULT_WORDS)throw Error('spatial GPU result byte length mismatch');
 const results=[];for(let i=0;i<count;i++){const base=i*RESULT_WORDS;if(words[base+1])throw Error(`spatial overlap query ${i} exceeds ${MAX_HITS} hits`);if(words[base]>MAX_HITS)throw Error('spatial GPU result count is invalid');const hits=[];for(let slot=0;slot<words[base];slot++){const o=base+4+slot*HIT_WORDS;hits.push({id:words[o],distance:floats[o+1],fraction:floats[o+2],point:Array.from(floats.subarray(o+4,o+7)),normal:Array.from(floats.subarray(o+8,o+11))});}results.push({hits});}
 return {version,results};
}

/** Creates a real WebGPU compute executor. A supplied device remains host-owned. */
export async function createSpatialGpuExecutor({device,shaderSource}={}){
 let ownsDevice=false,adapterInfo=null;
 if(!device){if(!globalThis.navigator?.gpu)throw Error('spatial WebGPU is unavailable');const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('spatial WebGPU adapter is unavailable');adapterInfo=adapter.info??null;device=await adapter.requestDevice();ownsDevice=true;}
 const limit=device.limits;
 if(limit.maxStorageBuffersPerShaderStage<3||limit.maxStorageBufferBindingSize<MAX_QUERIES*RESULT_WORDS*4||limit.maxComputeInvocationsPerWorkgroup<64){if(ownsDevice)device.destroy();throw Error('spatial WebGPU device limits do not support v1 capacity');}
 try{
  if(shaderSource==null){const response=await fetch(new URL('./spatial.wgsl',import.meta.url));if(!response.ok)throw Error(`spatial shader load failed: ${response.status}`);shaderSource=await response.text();}
  const module=device.createShaderModule({label:'Unone spatial compute',code:shaderSource});
  const pipeline=await device.createComputePipelineAsync({label:'Unone spatial batch',layout:'auto',compute:{module,entryPoint:'main'}});
  let closed=false,tail=Promise.resolve(),pending=0,deviceLoss=null,lastProfile=null;
  void device.lost.then(info=>{deviceLoss={reason:info.reason,message:info.message};});
  async function run(batch,timing){
   if(closed)throw Error('spatial GPU executor is closed');
   if(deviceLoss)throw Error(`spatial GPU device lost: ${deviceLoss.message}`);
   // Total spans public execute intake through cleanup. Preparation includes
   // validation and the owned input snapshot; validation is a nested phase.
   // Queue wait is host scheduling time, never GPU kernel time.
   const started=timing.started,phases={preparation:timing.preparation,queue_wait:performance.now()-timing.enqueued,validation:timing.validation,packing:null,upload:null,encode_submit:null,readback_wait:null,decode:null,cpu_execute:null,gpu_kernel:null};
   let phaseStarted;
   phaseStarted=performance.now();const data=packValidatedBatch(batch);phases.packing=performance.now()-phaseStarted;
   const sample=(upload_bytes,readback_bytes,reason)=>({clock:'host_monotonic',total_ms:performance.now()-started,phases_ms:phases,gpu_kernel_unavailable_reason:reason,upload_bytes,readback_bytes});
   if(batch.queries.length===0){
    phases.upload=0;phases.encode_submit=0;phases.readback_wait=0;phases.decode=0;
    lastProfile=sample(0,0,'No GPU dispatch for empty query batch');
    return {version:batch.version,results:[]};
   }
   const resources=[];let mapped=false,readback;
   const make=(label,size,usage)=>{const buffer=device.createBuffer({label,size,usage});resources.push(buffer);return buffer;};
   device.pushErrorScope('out-of-memory');device.pushErrorScope('validation');
   let result;
   try{
    phaseStarted=performance.now();
    const input=(label,array,usage=GPUBufferUsage.STORAGE)=>{const buffer=make(label,array.byteLength,usage|GPUBufferUsage.COPY_DST);device.queue.writeBuffer(buffer,0,array);return buffer;};
    const bodies=input('Spatial bodies',data.bodies),queries=input('Spatial queries',data.queries),params=input('Spatial counts',data.params,GPUBufferUsage.UNIFORM);
    const size=batch.queries.length*RESULT_WORDS*4,output=make('Spatial results',size,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);
    readback=make('Spatial readback',size,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
    const group=device.createBindGroup({label:'Spatial batch buffers',layout:pipeline.getBindGroupLayout(0),entries:[bodies,queries,output,params].map((buffer,binding)=>({binding,resource:{buffer}}))});
    phases.upload=performance.now()-phaseStarted;
    phaseStarted=performance.now();
    const encoder=device.createCommandEncoder({label:'Spatial dispatch'}),pass=encoder.beginComputePass({label:'Spatial queries'});pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(batch.queries.length/64));pass.end();encoder.copyBufferToBuffer(output,0,readback,0,size);device.queue.submit([encoder.finish()]);
    phases.encode_submit=performance.now()-phaseStarted;
    phaseStarted=performance.now();
    await readback.mapAsync(GPUMapMode.READ);mapped=true;
    phases.readback_wait=performance.now()-phaseStarted;
    phaseStarted=performance.now();result=decodeSpatialGpuResults(batch.version,batch.queries.length,readback.getMappedRange());phases.decode=performance.now()-phaseStarted;
   }finally{if(mapped)readback.unmap();for(const buffer of resources)buffer.destroy();const validation=await device.popErrorScope(),memory=await device.popErrorScope();if(validation||memory)throw Error(`spatial GPU execution: ${(validation??memory).message}`);}
   lastProfile=sample(data.bodies.byteLength+data.queries.byteLength+data.params.byteLength,batch.queries.length*RESULT_WORDS*4,'GPU timestamp queries are not enabled; host timings do not measure kernel duration');
   return result;
  }
  return {
   name:'webgpu',
   execute(batch){const started=performance.now();if(closed)return Promise.reject(Error('spatial GPU executor is closed'));try{validateSpatialGpuBatch(batch);}catch(error){return Promise.reject(error);}let validation=performance.now()-started;if(pending>=32)return Promise.reject(Error('spatial GPU queue is full'));let snapshot;try{snapshot=structuredClone(batch);const checked=performance.now();validateSpatialGpuBatch(snapshot);validation+=performance.now()-checked;}catch(error){return Promise.reject(error);}const preparation=performance.now()-started,enqueued=performance.now();pending++;const result=tail.then(()=>run(snapshot,{started,validation,preparation,enqueued}));tail=result.catch(()=>{});return result.finally(()=>pending--);},
   // Detached latest successful execution; timing never enters canonical results.
   profile:()=>lastProfile==null?null:structuredClone(lastProfile),
   describe:()=>({backend:'webgpu',algorithm:'linear_scan',adapter:adapterInfo?{vendor:adapterInfo.vendor,architecture:adapterInfo.architecture,device:adapterInfo.device,description:adapterInfo.description}:null,max_bodies:MAX_BODIES,max_queries:MAX_QUERIES,max_overlap_hits:MAX_HITS,pending,closed,device_loss:deviceLoss}),
   close(){closed=true;if(ownsDevice)void tail.finally(()=>device.destroy());},
  };
 }catch(error){if(ownsDevice)device.destroy();throw error;}
}
