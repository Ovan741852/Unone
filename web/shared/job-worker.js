let module;
onmessage=async({data})=>{
 try {
  if(data.kind==='init'&&!module){
   const url=new URL(data.url);if(url.origin!==location.origin)throw Error('JOB_RUNTIME_ORIGIN_INVALID');
   const {loadRuntime}=await import('./runtime-core.mjs');module=await loadRuntime(url.href,url=>importScripts(url));postMessage({kind:'ready'});return;
  }
  if(data.kind!=='execute'||!module)throw Error('JOB_WORKER_REQUEST_INVALID');
  const {jobRequest}=await import('./job-pool.mjs');
  postMessage({id:data.id,ok:true,result:jobRequest(module,{kind:'execute',...data.work})});
 }catch(e){postMessage({id:data.id,ok:false,error:String(e.message??e)});}
};
