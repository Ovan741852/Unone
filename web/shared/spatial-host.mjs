// Official host adapter. CPU uses the Rust reference; WebGPU is an explicit policy.
import {readObservation} from './load-project.js';
import {createSpatialHostMetrics} from './spatial-metrics.mjs';

export function createSpatialHost(module, {backend='cpu', createExecutor}={}) {
  if (!['cpu','gpu','auto'].includes(backend)) throw Error('SPATIAL_BACKEND_INVALID');
  let executor=null, pending=Promise.resolve(), fault=null, closed=false, epoch=0;
  let status={requested:backend, backend:'cpu', fallback_reason:null};
  const metrics=createSpatialHostMetrics();
  function request(value) {
    const sample={success:false,request_bytes:0,response_bytes:0,json_encode_ms:0,copy_in_ms:0,abi_ms:0,response_decode_ms:0};
    let started=performance.now(),phase='json_encode_ms';
    try {
      if (typeof module._unone_web_spatial_request!=='function') throw Error('SPATIAL_ABI_UNAVAILABLE: rebuild the Web runtime');
      const bytes=new TextEncoder().encode(JSON.stringify(value));sample.request_bytes=bytes.length;
      sample.json_encode_ms=performance.now()-started;phase=null;
      if(bytes.length>16*1024*1024) throw Error('SPATIAL_HOST_PAYLOAD_INVALID');
      started=performance.now();phase='copy_in_ms';
      const pointer=module._unone_web_alloc(bytes.length);module.HEAPU8.set(bytes,pointer);
      sample.copy_in_ms=performance.now()-started;
      started=performance.now();phase='abi_ms';const code=module._unone_web_spatial_request(pointer,bytes.length);
      sample.abi_ms=performance.now()-started;
      started=performance.now();phase='response_decode_ms';
      sample.response_bytes=module._unone_web_observation_len();const response=readObservation(module);
      sample.response_decode_ms=performance.now()-started;phase=null;
      if(code!==0) throw Error(JSON.stringify(response));
      sample.success=true;return response;
    } finally {
      if(phase)sample[phase]=performance.now()-started;
      metrics.request(value.kind,sample);
    }
  }
  return {
    async load() {
      // A load retires an entire executor epoch; an old completion cannot enter it.
      ++epoch; await pending; executor?.close(); executor=null; fault=null; closed=false;
      metrics.reset();
      status={requested:backend,backend:'cpu',fallback_reason:null};
      const setupStarted=performance.now();let createMs=0,configureMs=0,createStarted=null,configureStarted=null;
      if(backend==='cpu') {metrics.setup({success:true,total_ms:performance.now()-setupStarted,executor_create_ms:0,configure_ms:0,gpu_initialized:false});return;}
      try {
        if(typeof module._unone_web_spatial_request!=='function') throw Error('SPATIAL_ABI_UNAVAILABLE: rebuild the Web runtime');
        const create=createExecutor??(await import('./spatial-gpu.mjs')).createSpatialGpuExecutor;
        createStarted=performance.now();executor=await create();createMs=performance.now()-createStarted;createStarted=null;
        configureStarted=performance.now();
        request({kind:'configure',backend:'webgpu'});
        configureMs=performance.now()-configureStarted;configureStarted=null;
      } catch(error) {
        if(createStarted!==null)createMs=performance.now()-createStarted;
        if(configureStarted!==null)configureMs=performance.now()-configureStarted;
        metrics.setup({success:false,total_ms:performance.now()-setupStarted,executor_create_ms:createMs,configure_ms:configureMs,gpu_initialized:false});
        executor?.close();executor=null;
        if(backend==='gpu') throw error;
        status.fallback_reason=String(error.message??error);return;
      }
      status.backend='webgpu';
      metrics.setup({success:true,total_ms:performance.now()-setupStarted,executor_create_ms:createMs,configure_ms:configureMs,gpu_initialized:true});
    },
    dispatch() {
      if(!executor) return;
      const tasks=request({kind:'drain'}), generation=epoch;
      if(!Array.isArray(tasks)) throw Error('SPATIAL_HOST_RESPONSE_INVALID');
      pending=pending.then(async()=>{
        for(const task of tasks) {
          if(closed||generation!==epoch)return;
          const result=await executor.execute(task.batch);
          if(closed||generation!==epoch)return;
          const profile=typeof executor.profile==='function'?executor.profile():null;
          request({kind:'complete',id:task.id,result,...(profile==null?{}:{profile})});
        }
      }).catch(error=>{
        if(closed||generation!==epoch)return;
        fault=error;
        try{request({kind:'fault',message:String(error.message??error)});}catch{/* preserve original GPU error */}
      });
    },
    async barrier(){await pending;if(fault)throw fault;},
    diagnostic(){return request({kind:'diagnostic'});},
    report(){return {...status,fault:fault?String(fault):null,profile:typeof executor?.profile==='function'?structuredClone(executor.profile()):null,metrics:metrics.report()};},
    close(){closed=true;++epoch;executor?.close();executor=null;},
  };
}
