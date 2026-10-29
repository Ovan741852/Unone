import {createBinaryJobTransport} from './job-binary.mjs';
import {chooseJobWorkers,createJobPool,jobRequest} from './job-pool.mjs';
import {loadProject,readObservation,releaseObservationResources} from './load-project.js';
import {createSpatialHost} from './spatial-host.mjs';
const commandEncoder=new TextEncoder();
export function createRuntimeCore(module,{url,jobPolicy={},device={},spatialBackend='cpu',createSpatialExecutor,requirePhysicalViewport=true,profile=false}={}){
 if(typeof requirePhysicalViewport!=='boolean')throw Error('VIEWPORT_POLICY_INVALID');
 if(typeof profile!=='boolean')throw Error('RUNTIME_PROFILE_POLICY_INVALID');
 // Opt-in profiling: consecutive host-clock marks of the last executed command. The tick ABI
 // runs game update and observation serialization in one WASM call; it is reported unsplit.
 let lastTrace=null;
 const mark=(name,bytes)=>{lastTrace.marks.push([name,performance.now()]);if(bytes!==undefined)lastTrace.observation_bytes=bytes;};
 const spatial=createSpatialHost(module,{backend:spatialBackend,createExecutor:createSpatialExecutor});
 const read=()=>readObservation(module),binary=createBinaryJobTransport(module);
 function send(name,value){const bytes=commandEncoder.encode(JSON.stringify(value)),p=module._unone_web_alloc(bytes.length);module.HEAPU8.set(bytes,p);if(module[name](p,bytes.length)!==0)throw Error(JSON.stringify(read()));}
 let loaded=false,closed=false,latest,pool,policy={workers:0,reason:'jobs_disabled'},pending=[],fault=null,instanceTransport=1;
 const hasPhysicalViewport=()=>typeof module._unone_web_set_viewport_size==='function';
 const validSize=(width,height)=>[width,height].every(n=>Number.isInteger(n)&&n>0&&n<=32768);
 function viewportReport(){return {mode:hasPhysicalViewport()?'physical':requirePhysicalViewport?'physical-unavailable':'aspect-only',required:requirePhysicalViewport,physical_api:hasPhysicalViewport(),aspect_api:typeof module._unone_web_set_viewport_aspect==='function'};}
 function loadPayload(payload){
  if(!payload||!Object.hasOwn(payload,'viewport_size')||hasPhysicalViewport())return payload;
  if(requirePhysicalViewport)throw Error('PROJECTED_VIEWPORT_ABI_UNAVAILABLE: rebuild the Web runtime');
  const {viewport_size:size,...compatible}=payload;
  if(size!=null){if(!Array.isArray(size)||size.length!==2||!validSize(...size))throw Error('PROJECTED_VIEWPORT_INVALID');compatible.viewport_aspect=size[0]/size[1];}
  return compatible;
 }
 async function barrier(){await spatial.barrier();if(closed)throw Error('RUNTIME_CLOSED');const results=await Promise.all(pending);if(closed)throw Error('RUNTIME_CLOSED');pending=[];for(const r of results){if(closed)throw Error('RUNTIME_CLOSED');if(r.error){fault=r.error;throw fault;}binary.complete(r.value);}}
 function dispatchJobs(){if(!pool)return;const tasks=binary.drain();pending=tasks.map(work=>pool.submit(work).then(value=>({value}),error=>({error})));}

 return {module,trace:()=>lastTrace,close(){if(closed)return;closed=true;loaded=false;latest=undefined;pending=[];pool?.close();pool=null;spatial.close();releaseObservationResources(module);module._unone_web_unload_project?.();},report(){return {closed,policy,pool:pool?.report()??null,binary_transport:binary.report(),spatial:spatial.report(),viewport:viewportReport(),fault:fault?String(fault):null};},async execute(command){
  if(closed)throw Error('RUNTIME_CLOSED');
  if(profile)lastTrace={kind:String(command?.kind),start_ms:performance.now(),marks:[]};
  const allowed={load:['payload','seed'],tick:['input'],aspect:['value'],viewport:['width','height'],transport:['mode'],developer:['request'],ui:['request'],hostTime:['request']};
  if(!command||!Object.hasOwn(allowed,command.kind)||Object.keys(command).some(k=>k!=='kind'&&!allowed[command.kind].includes(k)))throw Error('RUNTIME_COMMAND_INVALID');
  if(command.kind!=='load'&&!loaded)throw Error('RUNTIME_NOT_LOADED');
  switch(command.kind){
   case 'load':{
    loaded=false;
    // Retire the previous executor epoch; captured promises cannot inject late replies.
    pool?.close();pool=null;pending=[];fault=null;
    latest=loadProject(module,loadPayload(command.payload),BigInt(command.seed??'42'));
    await spatial.load();
    if(closed)throw Error('RUNTIME_CLOSED');
    instanceTransport=1;if(module._unone_web_set_instance_transport?.(instanceTransport)!==0)throw Error('INSTANCE_TRANSPORT_UNAVAILABLE');latest=read();
    if(typeof module._unone_web_set_ui_transport==='function'){
     if(module._unone_web_set_ui_transport(1)!==0)throw Error('UI_IMAGE_TRANSPORT_UNAVAILABLE');latest=read();
    }
    if(command.payload.config?.systems?.jobs===true){
      policy=chooseJobWorkers(jobPolicy,{...device,workerAvailable:typeof globalThis.Worker==='function',heapBytes:module.HEAPU8.buffer.byteLength});
      if(policy.workers>0){jobRequest(module,{kind:'configure',workers:policy.workers});pool=createJobPool({url,workers:policy.workers,executeInline:work=>binary.execute(work)});}
    } else policy={workers:0,reason:'jobs_disabled'};
    loaded=true;return latest;
   }
   case 'tick':if(fault)throw fault;await barrier();if(closed)throw Error('RUNTIME_CLOSED');if(profile)mark('barrier_wait');send('_unone_web_set_input_frame',command.input);if(profile)mark('input_abi');if(module._unone_web_tick()!==0)throw Error(JSON.stringify(read()));if(profile)mark('tick_abi_atomic');latest=profile?readObservation(module,mark):read();dispatchJobs();if(profile)mark('jobs_dispatch');spatial.dispatch();if(profile)mark('spatial_dispatch');return latest;
   case 'hostTime':if(typeof module._unone_web_host_time_request!=='function')throw Error('HOST_TIME_ABI_UNAVAILABLE: rebuild the Web runtime');send('_unone_web_host_time_request',command.request);return read();
   case 'ui':if(typeof module._unone_web_ui_request!=='function')throw Error('UI_SCROLL_ABI_UNAVAILABLE: rebuild the Web runtime');send('_unone_web_ui_request',command.request);latest=read();return latest;
   case 'aspect':if(!Number.isFinite(command.value)||command.value<=0)throw Error('VIEWPORT_INVALID');if(module._unone_web_set_viewport_aspect(command.value)!==0)throw Error(JSON.stringify(read()));return latest;
   case 'viewport':{
    if(!validSize(command.width,command.height))throw Error('PROJECTED_VIEWPORT_INVALID');
    if(!hasPhysicalViewport()){
     if(requirePhysicalViewport)throw Error('PROJECTED_VIEWPORT_ABI_UNAVAILABLE: rebuild the Web runtime');
     if(typeof module._unone_web_set_viewport_aspect!=='function')throw Error('VIEWPORT_ASPECT_ABI_UNAVAILABLE');
     if(module._unone_web_set_viewport_aspect(command.width/command.height)!==0)throw Error(JSON.stringify(read()));return latest;
    }
    if(module._unone_web_set_viewport_size(command.width,command.height)!==0)throw Error(JSON.stringify(read()));latest=read();return latest;
   }
   case 'transport':if(!['json','memory'].includes(command.mode))throw Error('INSTANCE_TRANSPORT_INVALID');instanceTransport=command.mode==='memory'?1:0;if(module._unone_web_set_instance_transport(instanceTransport)!==0)throw Error(JSON.stringify(read()));latest=read();return latest;
   case 'developer':await barrier();if(closed)throw Error('RUNTIME_CLOSED');if(typeof module._unone_web_developer_request!=='function')throw Error('DEVELOPER_ABI_UNAVAILABLE');send('_unone_web_developer_request',command.request);{
    const result=read();if(!result.ok)throw Error(JSON.stringify(result));
    if(result.value?.observation?.world){
     // Developer snapshots omit packed instance payloads. Republish the render
     // transport without advancing simulation before a host accepts this world.
     if(module._unone_web_set_instance_transport(instanceTransport)!==0)throw Error(JSON.stringify(read()));
     latest=read();result.value.observation=latest;
    }
    return result.value;
   }
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
