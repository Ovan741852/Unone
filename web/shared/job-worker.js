let module,binary;
onmessage=async({data})=>{
 try {
  if(data.kind==='init'&&!module){
   const url=new URL(data.url);if(url.origin!==location.origin)throw Error('JOB_RUNTIME_ORIGIN_INVALID');
   const {loadRuntime}=await import('./runtime-core.mjs');module=await loadRuntime(url.href,url=>importScripts(url));const {createBinaryJobTransport}=await import('./job-binary.mjs');binary=createBinaryJobTransport(module);postMessage({kind:'ready'});return;
  }
  if(data.kind!=='execute'||!module)throw Error('JOB_WORKER_REQUEST_INVALID');
  const result=binary.execute(data.work);
  postMessage({id:data.id,ok:true,result,transport:binary.report()},result.output?[result.output]:[]);
 }catch(e){postMessage({id:data.id,ok:false,error:String(e.message??e)});}
};
