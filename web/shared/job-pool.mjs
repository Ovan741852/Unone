// Resource policy is host-only. It must never choose gameplay delivery ticks.
export function chooseJobWorkers(options={},device={}) {
  if(Object.keys(options).some(k=>!['mode','max_workers','memory_budget_mb'].includes(k)))throw Error('JOB_POLICY_UNKNOWN_FIELD');
  const {mode='auto',max_workers=2,memory_budget_mb=128}=options;
  if(!['auto','inline','workers'].includes(mode)||!Number.isInteger(max_workers)||max_workers<0||max_workers>4||!Number.isFinite(memory_budget_mb)||memory_budget_mb<0||memory_budget_mb>1024)throw Error('JOB_POLICY_INVALID');
  const cores=Number.isInteger(device.cores)&&device.cores>0?device.cores:2;
  const heap=Math.max(device.heapBytes??0,32*1024*1024);
  const budget=Math.min(memory_budget_mb*1024*1024,Number.isFinite(device.memoryGB)?device.memoryGB*1024**3/16:64*1024*1024);
  if(device.workerAvailable===false&&mode==='workers')throw Error('JOB_WORKER_UNAVAILABLE');
  const workers=device.workerAvailable===false?0:mode==='inline'?0:Math.min(max_workers,Math.floor(budget/heap),mode==='workers'?4:Math.max(0,cores-2));
  return {workers,reason:mode==='inline'?'explicit_inline':workers===0?'core_or_memory_budget':'bounded_device_budget',cores,heap_bytes_per_worker:heap,memory_budget_bytes:budget,mode};
}

export function jobRequest(module,value) {
  if(typeof module._unone_web_jobs_request!=='function')throw Error('JOB_ABI_UNAVAILABLE: rebuild the player runtime');
  const bytes=new TextEncoder().encode(JSON.stringify(value)),p=module._unone_web_alloc(bytes.length);
  module.HEAPU8.set(bytes,p);const status=module._unone_web_jobs_request(p,bytes.length);
  const result=JSON.parse(new TextDecoder().decode(module.HEAPU8.subarray(module._unone_web_observation_ptr(),module._unone_web_observation_ptr()+module._unone_web_observation_len())));
  if(status!==0)throw Error(JSON.stringify(result));return result;
}

// A bounded, lazy pool; a slot owns one independent WASM/Luau executor.
export function createJobPool({url,workers,executeInline,WorkerClass=globalThis.Worker,timeoutMs=30000,now=()=>performance.now()}) {
  if(!Number.isInteger(workers)||workers<0||workers>4)throw Error('JOB_WORKER_COUNT_INVALID');
  let closed=false,serial=0,active=0;
  const slots=[],queue=[],history=new Map(),recent=[];
  function record(value){recent.push(value);if(recent.length>64)recent.shift();}
  const metrics={submitted:0,completed:0,inline_jobs:0,worker_jobs:0,input_bytes:0,output_bytes:0,queue_ms:0,roundtrip_ms:0,execution_ms:0,kernel_errors:0,failures:0};
  function finish(slot,error,result){const task=slot.task;if(!task)return;slot.task=null;clearTimeout(slot.timer);active--;if(error){metrics.failures++;record({job:task.work.id,source_path:task.work.path,backend:"worker",error:String(error)});task.reject(error);}else{metrics.completed++;metrics.output_bytes+=result.output?.byteLength??0;if(result.error)metrics.kernel_errors++;record({job:task.work.id,source_path:task.work.path,backend:"worker",reason:"parallel_kernel",queue_ms:task.dispatched-task.queued,roundtrip_ms:now()-task.dispatched,execution_ms:result.run_ms,executor_profile:result.profile,error:result.error??null});metrics.roundtrip_ms+=now()-task.dispatched;metrics.execution_ms+=result.run_ms;const h=history.get(task.work.source)??{count:0,total:0};h.count++;h.total+=result.run_ms;history.set(task.work.source,h);task.resolve(result);}pump();}
  function fail(error){closed=true;for(const slot of slots){slot.worker.terminate();finish(slot,error);}while(queue.length)queue.shift().reject(error);}
  function makeSlot(){
    const worker=new WorkerClass(new URL('./job-worker.js',import.meta.url)),slot={worker,ready:false,task:null,timer:null};slots.push(slot);
    slot.timer=setTimeout(()=>fail(Error('JOB_WORKER_BOOT_TIMEOUT')),timeoutMs);
    worker.onerror=e=>fail(Error('JOB_WORKER_FAILED: '+e.message));
    worker.onmessage=({data})=>{
      if(data.kind==='ready'&&!slot.ready){clearTimeout(slot.timer);slot.ready=true;pump();return;}
      if(!slot.task||data.id!==slot.task.id){fail(Error('JOB_WORKER_RESPONSE_INVALID'));return;}
      if(!data.ok){fail(Error(data.error??'JOB_WORKER_FAILED'));return;}
      if(data.result?.id!==slot.task.work.id||!Number.isFinite(data.result.run_ms)||data.result.run_ms<0){fail(Error('JOB_WORKER_RESPONSE_INVALID'));return;}
      if((data.result.error===null&&(!(data.result.output instanceof ArrayBuffer)||data.result.output.byteLength>262144))||(data.result.error!==null&&(typeof data.result.error!=='string'||data.result.output!==null))){fail(Error('JOB_WORKER_RESPONSE_INVALID'));return;}
      slot.transport=data.transport??null;finish(slot,null,data.result);
    };
    worker.postMessage({kind:'init',url});return slot;
  }
  function pump(){if(closed)return;while(queue.length){let slot=slots.find(s=>s.ready&&!s.task);if(!slot){if(slots.length<workers)makeSlot();return;}const task=queue.shift();slot.task=task;active++;task.dispatched=now();metrics.queue_ms+=task.dispatched-task.queued;metrics.worker_jobs++;slot.timer=setTimeout(()=>fail(Error('JOB_WORKER_TIMEOUT')),timeoutMs);try{slot.worker.postMessage({kind:'execute',id:task.id,work:task.work},[task.work.input]);}catch(e){fail(e);return;}}}
  return {
    submit(work){
      if(closed)return Promise.reject(Error('JOB_POOL_CLOSED'));
      if(queue.length+active>=16)return Promise.reject(Error('JOB_QUEUE_FULL'));
      if(!(work.input instanceof ArrayBuffer)||work.input.byteLength>262144)return Promise.reject(Error('JOB_BINARY_BUFFER_REQUIRED'));
      metrics.submitted++;metrics.input_bytes+=work.input.byteLength;const h=history.get(work.source);
      // Four measured samples before selecting inline for a small kernel.
      if(workers===0||(h&&h.count>=4&&h.total/h.count<0.25)) {
        metrics.inline_jobs++;try{const result=executeInline(work);metrics.output_bytes+=result.output?.byteLength??0;if(result.error)metrics.kernel_errors++;record({job:work.id,source_path:work.path,backend:"inline",reason:workers===0?"no_workers":"measured_small_kernel",execution_ms:result.run_ms,executor_profile:result.profile,error:result.error??null});metrics.completed++;metrics.execution_ms+=result.run_ms;return Promise.resolve(result);}catch(e){metrics.failures++;return Promise.reject(e);}
      }
      return new Promise((resolve,reject)=>{queue.push({id:++serial,work,resolve,reject,queued:now()});pump();});
    },
    close(){fail(Error('JOB_POOL_CLOSED'));},
    report(){return {...metrics,recent:[...recent],worker_limit:workers,workers_started:slots.length,active,queued:queue.length,closed,transport:'UJB1 binary payloads + transferable ArrayBuffer',worker_transport:slots.map(s=>s.transport??null),timing_scope:'host-local, excluded from canonical state'};}
  };
}
