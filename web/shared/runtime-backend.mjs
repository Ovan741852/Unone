import {createRuntimeCore,loadRuntime} from './runtime-core.mjs';
import {InstanceReceiver} from './instance-transfer.mjs';
export async function createRuntimeBackend({kind='main',url,timeoutMs=30000,jobPolicy={},spatialBackend='cpu',requirePhysicalViewport=true,device={cores:globalThis.navigator?.hardwareConcurrency,memoryGB:globalThis.navigator?.deviceMemory},WorkerClass=globalThis.Worker,profiler=null}){
 if(!['main','worker'].includes(kind))throw Error('RUNTIME_BACKEND_INVALID');
 let closed=false,pending=0,tail=Promise.resolve(),metrics={backend:kind},serial=0,current=null;
 const receiver=new InstanceReceiver();let worker,core;
 function shutdown(error=Error('RUNTIME_CLOSED')){closed=true;worker?.terminate();core?.close();receiver.clear();if(current){clearTimeout(current.timer);current.reject(error);current=null;}}
 if(kind==='worker'){
  if(!WorkerClass)throw Error('WORKER_UNAVAILABLE');worker=new WorkerClass(new URL('./runtime-worker.js',import.meta.url));
  worker.onerror=event=>shutdown(Error('WORKER_FAILED: '+event.message));
  worker.onmessage=({data})=>{
   const arrived=profiler?profiler.now():0;if(!current||data.id!==current.id){shutdown(Error('WORKER_RESPONSE_STALE'));return;}
   const request=current;
   if(!data.ok){current=null;clearTimeout(request.timer);if(request.event)workerSpans(request,data.profile,arrived,arrived);request.reject(Error(data.error));return;}
   // Keep the request and its timeout owned until packet admission succeeds.
   // A rejected resource delta must reject the in-flight request, never leave
   // an unresolvable tick after cancelling its only timeout.
   let value;try{value=receiver.accept(data.packet);if(request.event)workerSpans(request,data.metrics?.profile,arrived,profiler.now());}
   catch(error){shutdown(error);return;}
   metrics=data.metrics??metrics;current=null;clearTimeout(request.timer);request.resolve(value);
  };
 }else core=createRuntimeCore(await loadRuntime(url),{url,jobPolicy,device,spatialBackend,requirePhysicalViewport,...(profiler?{profile:true}:{})});
 async function dispatch(command,event=null){if(closed)throw Error('RUNTIME_CLOSED');if(core){const at=performance.now();if(event)profiler.span(event,'queue_wait',event.start_ms,at);let value;try{value=await core.execute(command);}finally{if(event)coreSpans(event,at,profiler.now());}metrics={backend:'main',jobs:core.report(),viewport:core.report().viewport,execute_ms:performance.now()-at,wasm_linear_bytes:core.module.HEAPU8.buffer.byteLength};return value;}
  return new Promise((resolve,reject)=>{const id=++serial,recycled=receiver.takeRecycled();const timer=setTimeout(()=>shutdown(Error('WORKER_REQUEST_TIMEOUT')),timeoutMs);current={id,resolve,reject,timer,...(event?{event,posted:profiler.now()}:{})};try{worker.postMessage({id,command,recycled},recycled);}catch(error){shutdown(error);}});
 }
 // Opt-in profiling helpers. Core marks are consecutive, so children of one parent never overlap.
 function traceSpans(event,trace,parent,toHost){
  if(!trace)return;let at=toHost(trace.start_ms);for(const [name,t] of trace.marks){const end=toHost(t);profiler.span(event,name,at,end,parent);at=end;}
  if(trace.observation_bytes!==undefined)profiler.set(event,{observation_bytes:trace.observation_bytes});
  if(trace.marks.some(([name])=>name==='tick_abi_atomic'))profiler.set(event,{tick_abi:'atomic_update_and_serialization_unsplit'});
 }
 function coreSpans(event,at,done){profiler.span(event,'execute',at,done);traceSpans(event,core.trace(),'execute',t=>t);}
 function workerSpans(request,remote,arrived,admitted){
  const {event,posted}=request,span=(n,a,b,p)=>profiler.span(event,n,a,b,p);span('queue_wait',event.start_ms,posted);
  if(!remote){span('worker_round_trip',posted,arrived);span('admission',arrived,admitted);return;}
  const toHost=t=>t+remote.time_origin-profiler.timeOrigin,received=toHost(remote.received_ms),done=toHost(remote.executed_ms??remote.failed_ms);
  span('post_to_worker',posted,received);span('worker_execute',received,done);traceSpans(event,remote.core,'worker_execute',toHost);
  if(remote.packed_ms!==undefined){span('worker_pack',done,toHost(remote.packed_ms));span('worker_to_main',toHost(remote.packed_ms),arrived);}else span('worker_to_main',done,arrived);
  span('admission',arrived,admitted);profiler.set(event,{clock_alignment:'worker performance.timeOrigin'});
 }
 function profiledRequest(command,owner){
  const event=profiler.begin('command',{command_kind:String(command?.kind),backend:kind,...(owner?{owner}:{})});
  const rejected=error=>{profiler.end(event,'rejected',{error});return Promise.reject(error);};
  if(closed)return rejected(Error('RUNTIME_CLOSED'));if(pending>=32)return rejected(Error('RUNTIME_QUEUE_FULL'));
  pending++;const result=tail.then(()=>dispatch(command,event));tail=result.catch(()=>{});
  return result.then(value=>{profiler.tag(value,event.id);profiler.end(event,'ok');return value;},error=>{profiler.end(event,'error',{error});throw error;}).finally(()=>pending--);
 }
 // `owner` is the caller's profile identity; it is ignored when profiling is disabled.
 function request(command,owner){if(profiler)return profiledRequest(command,owner);if(closed)return Promise.reject(Error('RUNTIME_CLOSED'));if(pending>=32)return Promise.reject(Error('RUNTIME_QUEUE_FULL'));pending++;const result=tail.then(()=>dispatch(command));tail=result.catch(()=>{});return result.finally(()=>pending--);}
 if(worker){try{await request({kind:'init',url,jobPolicy,device,spatialBackend,requirePhysicalViewport,...(profiler?{profile:true}:{})});}catch(error){shutdown(error);throw error;}}
 return {kind,request,close:shutdown,report:()=>({...metrics,pending,closed}),memory:batch=>core?core.module.HEAPU8.buffer:receiver.memory(batch)};
}
