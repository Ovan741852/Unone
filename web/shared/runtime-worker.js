// Classic Worker: Emscripten's shipped web glue is loaded without a second VM on main.
let core,transfer,failed=false,profile=false;
// Opt-in profiling (init profile:true): worker-clock span boundaries plus performance.timeOrigin.
const profiled=extra=>profile?{profile:{time_origin:performance.timeOrigin,...extra,core:core?.trace()??null}}:{};
onmessage=async({data})=>{
 const {id,command,recycled=[]}=data??{};const received=profile?performance.now():0;
 try{
  if(!Number.isSafeInteger(id)||id<1||failed)throw Error('WORKER_SESSION_INVALID');
  if(!core){if(command?.kind!=='init'||Object.keys(command).some(k=>!['kind','url','jobPolicy','device','spatialBackend','requirePhysicalViewport','profile'].includes(k))||![undefined,true].includes(command.profile))throw Error('WORKER_INIT_REQUIRED');profile=command.profile===true;const [{createRuntimeCore,loadRuntime},{InstanceTransfer}]=await Promise.all([import('./runtime-core.mjs'),import('./instance-transfer.mjs')]);const url=new URL(command.url);if(url.origin!==location.origin)throw Error('WORKER_RUNTIME_ORIGIN_INVALID');core=createRuntimeCore(await loadRuntime(url.href,url=>importScripts(url)),{url:url.href,jobPolicy:command.jobPolicy,device:command.device,spatialBackend:command.spatialBackend,requirePhysicalViewport:command.requirePhysicalViewport,profile});transfer=new InstanceTransfer();postMessage({id,ok:true,packet:{value:null,updates:[],removed:[]}});return;}
  transfer.recycle(recycled);if(command.kind==='load')transfer.reset();
  const at=performance.now(),value=await core.execute(command),executed=performance.now();const packet=transfer.encode(value,core.module.HEAPU8.buffer);
  postMessage({id,ok:true,packet,metrics:{backend:'worker',jobs:core.report(),viewport:core.report().viewport,execute_ms:executed-at,pack_ms:performance.now()-executed,wasm_linear_bytes:core.module.HEAPU8.buffer.byteLength,transfer:transfer.report(),...profiled({received_ms:received,executed_ms:executed,packed_ms:profile?performance.now():0})}},packet.updates.map(u=>u.buffer));
 }catch(error){postMessage({id,ok:false,error:String(error.message??error),...profiled({received_ms:received,failed_ms:profile?performance.now():0})});}
};
