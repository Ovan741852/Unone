import {createRuntimeCore,loadRuntime} from './runtime-core.mjs';
import {InstanceReceiver} from './instance-transfer.mjs';
export async function createRuntimeBackend({kind='main',url,timeoutMs=30000,jobPolicy={},device={cores:globalThis.navigator?.hardwareConcurrency,memoryGB:globalThis.navigator?.deviceMemory},WorkerClass=globalThis.Worker}){
 if(!['main','worker'].includes(kind))throw Error('RUNTIME_BACKEND_INVALID');
 let closed=false,pending=0,tail=Promise.resolve(),metrics={backend:kind},serial=0,current=null;
 const receiver=new InstanceReceiver();let worker,core;
 function shutdown(error=Error('RUNTIME_CLOSED')){closed=true;worker?.terminate();core?.close();if(current){clearTimeout(current.timer);current.reject(error);current=null;}}
 if(kind==='worker'){
  if(!WorkerClass)throw Error('WORKER_UNAVAILABLE');worker=new WorkerClass(new URL('./runtime-worker.js',import.meta.url));
  worker.onerror=event=>shutdown(Error('WORKER_FAILED: '+event.message));
  worker.onmessage=({data})=>{if(!current||data.id!==current.id){shutdown(Error('WORKER_RESPONSE_STALE'));return;}const request=current;current=null;clearTimeout(request.timer);if(!data.ok){request.reject(Error(data.error));return;}metrics=data.metrics??metrics;request.resolve(receiver.accept(data.packet));};
 }else core=createRuntimeCore(await loadRuntime(url),{url,jobPolicy,device});
 async function dispatch(command){if(closed)throw Error('RUNTIME_CLOSED');if(core){const at=performance.now();const value=await core.execute(command);metrics={backend:'main',jobs:core.report(),execute_ms:performance.now()-at,wasm_linear_bytes:core.module.HEAPU8.buffer.byteLength};return value;}
  return new Promise((resolve,reject)=>{const id=++serial,recycled=receiver.takeRecycled();const timer=setTimeout(()=>shutdown(Error('WORKER_REQUEST_TIMEOUT')),timeoutMs);current={id,resolve,reject,timer};try{worker.postMessage({id,command,recycled},recycled);}catch(error){shutdown(error);}});
 }
 function request(command){if(closed)return Promise.reject(Error('RUNTIME_CLOSED'));if(pending>=32)return Promise.reject(Error('RUNTIME_QUEUE_FULL'));pending++;const result=tail.then(()=>dispatch(command));tail=result.catch(()=>{});return result.finally(()=>pending--);}
 if(worker){try{await request({kind:'init',url,jobPolicy,device});}catch(error){shutdown(error);throw error;}}
 return {kind,request,close:shutdown,report:()=>({...metrics,pending,closed}),memory:batch=>core?core.module.HEAPU8.buffer:receiver.memory(batch)};
}
