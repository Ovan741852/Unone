import {createBinaryJobTransport} from './job-binary.mjs';
import {chooseJobWorkers,createJobPool,jobRequest} from './job-pool.mjs';
import {loadProject,readObservation} from './load-project.js';
export function createRuntimeCore(module,{url,jobPolicy={},device={}}={}){
 const read=()=>readObservation(module),binary=createBinaryJobTransport(module);
 function send(name,value){const bytes=new TextEncoder().encode(JSON.stringify(value)),p=module._unone_web_alloc(bytes.length);module.HEAPU8.set(bytes,p);if(module[name](p,bytes.length)!==0)throw Error(JSON.stringify(read()));}
 let loaded=false,latest,pool,policy={workers:0,reason:'jobs_disabled'},pending=[],fault=null;
 async function barrier(){const results=await Promise.all(pending);pending=[];for(const r of results){if(r.error){fault=r.error;throw fault;}binary.complete(r.value);}}
 function dispatchJobs(){if(!pool)return;const tasks=binary.drain();pending=tasks.map(work=>pool.submit(work).then(value=>({value}),error=>({error})));}

 return {module,close(){pool?.close();},report(){return {policy,pool:pool?.report()??null,binary_transport:binary.report(),fault:fault?String(fault):null};},async execute(command){
  const allowed={load:['payload','seed'],tick:['input'],aspect:['value'],transport:['mode'],developer:['request']};
  if(!command||!Object.hasOwn(allowed,command.kind)||Object.keys(command).some(k=>k!=='kind'&&!allowed[command.kind].includes(k)))throw Error('RUNTIME_COMMAND_INVALID');
  if(command.kind!=='load'&&!loaded)throw Error('RUNTIME_NOT_LOADED');
  switch(command.kind){
   case 'load':{
    // Retire the previous executor epoch; captured promises cannot inject late replies.
    pool?.close();pool=null;pending=[];fault=null;
    latest=loadProject(module,command.payload,BigInt(command.seed??'42'));loaded=true;
    if(module._unone_web_set_instance_transport?.(1)!==0)throw Error('INSTANCE_TRANSPORT_UNAVAILABLE');latest=read();
    if(command.payload.config?.systems?.jobs===true){
      policy=chooseJobWorkers(jobPolicy,{...device,workerAvailable:typeof globalThis.Worker==='function',heapBytes:module.HEAPU8.buffer.byteLength});
      if(policy.workers>0){jobRequest(module,{kind:'configure',workers:policy.workers});pool=createJobPool({url,workers:policy.workers,executeInline:work=>binary.execute(work)});}
    } else policy={workers:0,reason:'jobs_disabled'};
    return latest;
   }
   case 'tick':if(fault)throw fault;await barrier();send('_unone_web_set_input_frame',command.input);if(module._unone_web_tick()!==0)throw Error(JSON.stringify(read()));latest=read();dispatchJobs();return latest;
   case 'aspect':if(!Number.isFinite(command.value)||command.value<=0)throw Error('VIEWPORT_INVALID');if(module._unone_web_set_viewport_aspect(command.value)!==0)throw Error(JSON.stringify(read()));return latest;
   case 'transport':if(!['json','memory'].includes(command.mode))throw Error('INSTANCE_TRANSPORT_INVALID');if(module._unone_web_set_instance_transport(command.mode==='memory'?1:0)!==0)throw Error(JSON.stringify(read()));latest=read();return latest;
   case 'developer':await barrier();if(typeof module._unone_web_developer_request!=='function')throw Error('DEVELOPER_ABI_UNAVAILABLE');send('_unone_web_developer_request',command.request);{const result=read();if(!result.ok)throw Error(JSON.stringify(result));if(result.value?.observation?.world)latest=result.value.observation;return result.value;}
  }
 }};
}
let runtimePromise,runtimeURL;
export async function loadRuntime(url,loader){
 if(runtimePromise){if(runtimeURL!==url)throw Error('RUNTIME_URL_CHANGE_REQUIRES_NEW_REALM');return runtimePromise;}
 runtimeURL=url;
 return runtimePromise=new Promise((resolve,reject)=>{
  globalThis.Module={noInitialRun:true,locateFile:path=>new URL(path,url).href,onRuntimeInitialized(){resolve(globalThis.Module)},onAbort:e=>reject(Error(String(e))),printErr:console.error};
  if(loader){globalThis.window=globalThis;globalThis.document={currentScript:{src:url}};try{loader(url);}catch(e){reject(e);}}
  else{const script=document.createElement('script');script.src=url;script.onerror=()=>reject(Error('RUNTIME_LOAD_FAILED'));document.head.append(script);}
 });
}
