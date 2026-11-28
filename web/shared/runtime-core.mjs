import {createBinaryJobTransport} from './job-binary.mjs';
import {chooseJobWorkers,createJobPool,jobRequest} from './job-pool.mjs';
import {loadProject,readObservation,releaseObservationResources} from './load-project.js';
import {createSpatialHost} from './spatial-host.mjs';
import {createDeferredDataHost} from './deferred-data-host.mjs';
const commandEncoder=new TextEncoder(),controlDecoder=new TextDecoder('utf-8',{fatal:true});
export function createRuntimeCore(module,{url,jobPolicy={},device={},spatialBackend='cpu',createSpatialExecutor,requirePhysicalViewport=true,profile=false,readDeferredSource,observationDigest=true}={}){
 if(typeof requirePhysicalViewport!=='boolean')throw Error('VIEWPORT_POLICY_INVALID');
 if(typeof observationDigest!=='boolean')throw Error('OBSERVATION_DIGEST_POLICY_INVALID');
 // Publications carry observation_digest (SHA-256 of the canonical world) unless the host only presents: hashing every
 // tick costs about as much as encoding the world. A runtime without the switch keeps publishing digests.
 const digestSwitch=typeof module._unone_web_set_observation_digest==='function';
 if(!observationDigest&&digestSwitch&&module._unone_web_set_observation_digest(0)!==0)throw Error('OBSERVATION_DIGEST_UNAVAILABLE');
 const observationDigestMode=observationDigest||!digestSwitch?'on':'off';
 if(typeof profile!=='boolean')throw Error('RUNTIME_PROFILE_POLICY_INVALID');
 // Opt-in profiling: consecutive host-clock marks of the last executed command. The tick ABI
 // runs game update and observation serialization in one WASM call; it is reported unsplit.
 let lastTrace=null;
 const mark=(name,bytes,publication)=>{lastTrace.marks.push([name,performance.now()]);if(bytes!==undefined)lastTrace.observation_bytes=bytes;if(publication)(lastTrace.world_field_publications??=[]).push(publication);};
 const spatial=createSpatialHost(module,{backend:spatialBackend,createExecutor:createSpatialExecutor});
 const read=()=>readObservation(module),binary=createBinaryJobTransport(module);
 function send(name,value){const bytes=commandEncoder.encode(JSON.stringify(value)),p=module._unone_web_alloc(bytes.length);module.HEAPU8.set(bytes,p);if(module[name](p,bytes.length)!==0)throw Error(JSON.stringify(read()));}
 let deferred=null;
 let loaded=false,closed=false,latest,pool,policy={workers:0,reason:'jobs_disabled'},pending=[],fault=null,instanceTransport=1,spritePlanRevision=null,imageGroupRevision=null,markRevision=0,markSequence=0;
 function withSpriteResourcePlan(value){
  if(typeof module._unone_web_sprite_resources_request!=='function')return value;
  send('_unone_web_sprite_resources_request',{kind:'plan',after:spritePlanRevision});
  // Detached control replies must not retire the retained UI/save generations
  // of the world publication that was just admitted.
  const pointer=module._unone_web_observation_ptr(),length=module._unone_web_observation_len();
  if(!Number.isSafeInteger(pointer)||pointer<0||!Number.isSafeInteger(length)||length<1||length>16*1024*1024||pointer+length>module.HEAPU8.byteLength)throw Error('SPRITE_RESOURCE_PLAN_INVALID');
  const plan=JSON.parse(controlDecoder.decode(module.HEAPU8.subarray(pointer,pointer+length)));
  if(!plan||!Number.isSafeInteger(plan.revision)||plan.revision<0||Object.keys(plan).some(key=>!['revision','resources'].includes(key))||Object.hasOwn(plan,'resources')&&!Array.isArray(plan.resources))throw Error('SPRITE_RESOURCE_PLAN_INVALID');
  spritePlanRevision=plan.revision;
  // Preserve the decoder's private publication identities on this fresh host
  // envelope; cloning it would lose retained-save provenance in worker packing.
  if(Object.hasOwn(plan,'resources'))value.sprite_resource_plan=plan;
  return value;
 }
 // The image groups the game wants held (api.assets.imageGroups) ride beside
 // the world, never inside it, so they cannot change its digest.
 function withImageGroupPlan(value){
  if(typeof module._unone_web_image_groups_request!=='function')return value;
  send('_unone_web_image_groups_request',{kind:'plan',after:imageGroupRevision});
  const pointer=module._unone_web_observation_ptr(),length=module._unone_web_observation_len();
  if(!Number.isSafeInteger(pointer)||pointer<0||!Number.isSafeInteger(length)||length<1||length>1024*1024||pointer+length>module.HEAPU8.byteLength)throw Error('IMAGE_GROUP_PLAN_INVALID');
  const plan=JSON.parse(controlDecoder.decode(module.HEAPU8.subarray(pointer,pointer+length)));
  if(!plan||!Number.isSafeInteger(plan.revision)||plan.revision<0||Object.keys(plan).some(key=>!['revision','groups','retries'].includes(key))||Object.hasOwn(plan,'groups')&&(!plan.groups||typeof plan.groups!=='object'||Array.isArray(plan.groups)))throw Error('IMAGE_GROUP_PLAN_INVALID');
  if(Object.hasOwn(plan,'retries')&&(!Array.isArray(plan.retries)||plan.retries.length>4096||plan.retries.some(name=>typeof name!=='string'||!Object.hasOwn(plan.groups??{},name))))throw Error('IMAGE_GROUP_PLAN_INVALID');
  imageGroupRevision=plan.revision;
  if(Object.hasOwn(plan,'groups'))value.image_group_plan=plan;
  return value;
 }
 // Milestones the game declared with api.profile.mark ride beside the world, never inside it.
 // One integer is read per publication; the marks themselves only when it changed.
 function withProfileMarks(value){
  if(typeof module._unone_web_profile_marks_revision!=='function')return value;
  const revision=module._unone_web_profile_marks_revision()>>>0;
  if(revision===markRevision)return value;
  send('_unone_web_profile_marks_request',{kind:'marks',after:markSequence});
  const pointer=module._unone_web_observation_ptr(),length=module._unone_web_observation_len();
  if(!Number.isSafeInteger(pointer)||pointer<0||!Number.isSafeInteger(length)||length<1||length>1024*1024||pointer+length>module.HEAPU8.byteLength)throw Error('PROFILE_MARKS_INVALID');
  const update=JSON.parse(controlDecoder.decode(module.HEAPU8.subarray(pointer,pointer+length)));
  if(!update||!Number.isSafeInteger(update.revision)||!Array.isArray(update.marks)||!Number.isSafeInteger(update.dropped)||Object.keys(update).some(key=>!['revision','marks','dropped'].includes(key)))throw Error('PROFILE_MARKS_INVALID');
  for(const mark of update.marks){
   if(!mark||typeof mark.name!=='string'||!Number.isSafeInteger(mark.frame)||mark.frame<0||!Number.isSafeInteger(mark.sequence)||mark.sequence<=markSequence)throw Error('PROFILE_MARKS_INVALID');
   markSequence=mark.sequence;
  }
  markRevision=revision;
  value.profile_marks={marks:update.marks,dropped:update.dropped};
  return value;
 }
 const hasPhysicalViewport=()=>typeof module._unone_web_set_viewport_size==='function';
 const validSize=(width,height)=>[width,height].every(n=>Number.isInteger(n)&&n>0&&n<=32768);
 function viewportReport(){return {mode:hasPhysicalViewport()?'physical':requirePhysicalViewport?'physical-unavailable':'aspect-only',required:requirePhysicalViewport,physical_api:hasPhysicalViewport(),aspect_api:typeof module._unone_web_set_viewport_aspect==='function'};}
 function loadPayload(payload){
  if(payload&&Object.hasOwn(payload,'viewport_safe_area')&&typeof module._unone_web_set_viewport_safe_area!=='function'){
   const {viewport_safe_area,...compatible}=payload;payload=compatible;
  }
  if(!payload||!Object.hasOwn(payload,'viewport_size')||hasPhysicalViewport())return payload;
  if(requirePhysicalViewport)throw Error('PROJECTED_VIEWPORT_ABI_UNAVAILABLE: rebuild the Web runtime');
  const {viewport_size:size,...compatible}=payload;
  if(size!=null){if(!Array.isArray(size)||size.length!==2||!validSize(...size))throw Error('PROJECTED_VIEWPORT_INVALID');compatible.viewport_aspect=size[0]/size[1];}
  return compatible;
 }
 async function barrier(){await spatial.barrier();if(closed)throw Error('RUNTIME_CLOSED');const results=await Promise.all(pending);if(closed)throw Error('RUNTIME_CLOSED');pending=[];for(const r of results){if(closed)throw Error('RUNTIME_CLOSED');if(r.error){fault=r.error;throw fault;}binary.complete(r.value);}}
 function dispatchJobs(){if(!pool)return;const tasks=binary.drain();pending=tasks.map(work=>pool.submit(work).then(value=>({value}),error=>({error})));}

 return {module,trace:()=>lastTrace,close(){if(closed)return;closed=true;loaded=false;latest=undefined;pending=[];deferred?.close();deferred=null;pool?.close();pool=null;spatial.close();releaseObservationResources(module);module._unone_web_unload_project?.();},// Memory beside the world: linear capacity (only grows) and the Luau VM in use, garbage included.
 // Reading either never collects; a runtime without the export reports null, never a guess.
 memory(){const heap=typeof module._unone_web_luau_heap_bytes==='function'?module._unone_web_luau_heap_bytes():-1;return {wasm_linear_bytes:module.HEAPU8.buffer.byteLength,luau_heap_bytes:Number.isFinite(heap)&&heap>=0?heap:null};},report(){return {closed,policy,pool:pool?.report()??null,binary_transport:binary.report(),spatial:spatial.report(),viewport:viewportReport(),observation_digest:observationDigestMode,fault:fault?String(fault):null};},async execute(command){
  if(closed)throw Error('RUNTIME_CLOSED');
  if(profile)lastTrace={kind:String(command?.kind),start_ms:performance.now(),marks:[]};
  const allowed={load:['payload','seed','data','contentBaseURL'],tick:['input','presenting'],aspect:['value'],viewport:['width','height'],safeArea:['value'],transport:['mode'],developer:['request'],ui:['request'],hostTime:['request']};
  if(!command||!Object.hasOwn(allowed,command.kind)||Object.keys(command).some(k=>k!=='kind'&&!allowed[command.kind].includes(k)))throw Error('RUNTIME_COMMAND_INVALID');
  if(command.kind!=='load'&&!loaded)throw Error('RUNTIME_NOT_LOADED');
  switch(command.kind){
   case 'load':{
    loaded=false;spritePlanRevision=null;imageGroupRevision=null;markRevision=0;markSequence=0;
    // Retire the previous executor epoch; captured promises cannot inject late replies.
    deferred?.close();deferred=null;
    pool?.close();pool=null;pending=[];fault=null;
    latest=loadProject(module,loadPayload(command.payload),BigInt(command.seed??'42'),command.data);
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
    deferred=createDeferredDataHost(module,command.payload,{baseURL:command.contentBaseURL,readSource:readDeferredSource});
    deferred?.refresh();
    loaded=true;latest=withProfileMarks(withImageGroupPlan(withSpriteResourcePlan(latest)));return latest;
   }
   case 'tick':if(fault)throw fault;await barrier();if(closed)throw Error('RUNTIME_CLOSED');if(profile)mark('barrier_wait');if(typeof module._unone_web_set_presenting==='function')module._unone_web_set_presenting(command.presenting===false?0:1);const input=deferred?await deferred.input(command.input):command.input;if(closed)throw Error('RUNTIME_CLOSED');send('_unone_web_set_input_frame',input);if(profile)mark('input_abi');if(module._unone_web_tick()!==0)throw Error(JSON.stringify(read()));if(profile)mark('tick_abi_atomic');latest=profile?readObservation(module,mark):read();dispatchJobs();if(profile)mark('jobs_dispatch');spatial.dispatch();if(profile)mark('spatial_dispatch');deferred?.refresh();latest=withProfileMarks(withImageGroupPlan(withSpriteResourcePlan(latest)));return latest;
   case 'hostTime':if(typeof module._unone_web_host_time_request!=='function')throw Error('HOST_TIME_ABI_UNAVAILABLE: rebuild the Web runtime');send('_unone_web_host_time_request',command.request);return read();
   case 'ui':if(typeof module._unone_web_ui_request!=='function')throw Error('UI_SCROLL_ABI_UNAVAILABLE: rebuild the Web runtime');send('_unone_web_ui_request',command.request);latest=read();return latest;
   case 'safeArea': {
    const v=command.value;
    if(!Array.isArray(v)||v.length!==4||!v.every(n=>Number.isFinite(n)&&n>=0)||v[0]+v[2]>=100||v[1]+v[3]>=100)throw Error('VIEWPORT_SAFE_AREA_INVALID');
    if(typeof module._unone_web_set_viewport_safe_area==='function'&&module._unone_web_set_viewport_safe_area(...v)!==0)throw Error(JSON.stringify(read()));
    return latest;
   }
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
let runtimePromise,runtimeURL,runtimePrefetch=null;
// The engine binary next to the runtime script; the SDK runtime manifest records it as "wasm".
export const RUNTIME_WASM='unone_player.wasm';
/**
 * Starts downloading the runtime script and downloading + compiling its WebAssembly, so a host can overlap that work
 * with steps that come before Core (image preparation, fonts). Nothing is evaluated, instantiated or constructed:
 * loadRuntime still creates Core, and only when it is called. A failed prefetch only means loadRuntime fetches the
 * binary itself, exactly as without a prefetch. Returns the compile promise, or null when this realm cannot prefetch.
 */
export function prefetchRuntime(url,{fetchImpl=globalThis.fetch,compileStreaming=globalThis.WebAssembly?.compileStreaming,doc=globalThis.document}={}){
 if(runtimePromise)return null;
 if(runtimePrefetch)return runtimePrefetch.url===url?runtimePrefetch.module:null;
 if(typeof fetchImpl!=='function'||typeof compileStreaming!=='function')return null;
 try{const link=doc?.createElement?.('link');if(link&&doc.head){link.rel='preload';link.as='script';link.href=url;doc.head.append(link);}}catch{/* only a hint */}
 let module;try{module=Promise.resolve(compileStreaming.call(globalThis.WebAssembly,fetchImpl(new URL(RUNTIME_WASM,url).href,{credentials:'same-origin'})));}catch(error){module=Promise.reject(error);}
 module.catch(()=>{});
 runtimePrefetch={url,module};
 return module;
}
// Emscripten's instantiateWasm hook: instantiate the prefetched module, or fetch the binary like the loader would.
function prefetchedInstantiation(url,module){
 return (imports,receive)=>{
  const fallback=()=>WebAssembly.instantiateStreaming(fetch(new URL(RUNTIME_WASM,url).href,{credentials:'same-origin'}),imports).then(({instance,module:compiled})=>receive(instance,compiled));
  module.then(compiled=>WebAssembly.instantiate(compiled,imports).then(instance=>receive(instance,compiled)),fallback).catch(error=>globalThis.Module?.onAbort?.(error));
  return {};
 };
}
export async function loadRuntime(url,loader){
 if(runtimePromise){if(runtimeURL!==url)throw Error('RUNTIME_URL_CHANGE_REQUIRES_NEW_REALM');return runtimePromise;}
 runtimeURL=url;
 return runtimePromise=new Promise((resolve,reject)=>{
  const prefetched=runtimePrefetch?.url===url?runtimePrefetch.module:null;
  globalThis.Module={noInitialRun:true,locateFile:path=>new URL(path,url).href,onRuntimeInitialized(){resolve(globalThis.Module)},onAbort:e=>reject(Error(String(e))),printErr:console.error,...(prefetched&&!loader?{instantiateWasm:prefetchedInstantiation(url,prefetched)}:{})};
  if(loader){globalThis.window=globalThis;globalThis.document={currentScript:{src:url}};try{loader(url);}catch(e){reject(e);}}
  else{const script=document.createElement('script');script.src=url;script.onerror=()=>reject(Error('RUNTIME_LOAD_FAILED'));document.head.append(script);}
 });
}
