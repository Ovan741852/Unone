// Classic Worker: Emscripten's shipped web glue is loaded without a second VM on main.
let core,transfer,failed=false;
onmessage=async({data})=>{
 const {id,command,recycled=[]}=data??{};
 try{
  if(!Number.isSafeInteger(id)||id<1||failed)throw Error('WORKER_SESSION_INVALID');
  if(!core){if(command?.kind!=='init'||Object.keys(command).some(k=>!['kind','url','jobPolicy','device'].includes(k)))throw Error('WORKER_INIT_REQUIRED');const [{createRuntimeCore,loadRuntime},{InstanceTransfer}]=await Promise.all([import('./runtime-core.mjs'),import('./instance-transfer.mjs')]);const url=new URL(command.url);if(url.origin!==location.origin)throw Error('WORKER_RUNTIME_ORIGIN_INVALID');core=createRuntimeCore(await loadRuntime(url.href,url=>importScripts(url)),{url:url.href,jobPolicy:command.jobPolicy,device:command.device});transfer=new InstanceTransfer();postMessage({id,ok:true,packet:{value:null,updates:[],removed:[]}});return;}
  transfer.recycle(recycled);if(command.kind==='load')transfer.reset();
  const at=performance.now(),value=await core.execute(command),executed=performance.now();const packet=transfer.encode(value,core.module.HEAPU8.buffer);
  postMessage({id,ok:true,packet,metrics:{backend:'worker',jobs:core.report(),execute_ms:executed-at,pack_ms:performance.now()-executed,wasm_linear_bytes:core.module.HEAPU8.buffer.byteLength,transfer:transfer.report()}},packet.updates.map(u=>u.buffer));
 }catch(error){postMessage({id,ok:false,error:String(error.message??error)});}
};
