// One structured API for the human panel, browser agents and automation.
import {createAssetUsageReader} from './asset-usages.js';
export const methods = {
  describe:[], jobs:[], snapshot:[], observations:[], hierarchy:[], console:[], network:[], profile:[], 'profile.start':['sampling'], 'profile.stop':[], memory:[],
  'tools.list':[], 'tools.invoke':['id','revision','value'], pause:['paused'], step:['count'],
  input:['frame'], bloom:['enabled'], journal:[], screenshot:['max_width','max_height'],
  'instances.transport':['mode'], restart:[], assets:[], 'asset.usages':['id'],
  'memory.sample':['label','collect','warmup'], 'memory.report':[], 'memory.reset':[],
};
export const requestSchema={type:'object',additionalProperties:false,required:['method'],properties:{
  method:{type:'string',enum:Object.keys(methods)},id:{type:'string',minLength:1,maxLength:1024},revision:{type:'integer',minimum:0},
  value:{type:'boolean'},paused:{type:'boolean'},sampling:{type:'boolean'},count:{type:'integer',minimum:1,maximum:120},
  frame:{type:'object'},enabled:{type:'boolean'},max_width:{type:'integer',minimum:16,maximum:2048},max_height:{type:'integer',minimum:16,maximum:2048},
  mode:{type:'string',enum:['json','memory']},
  label:{type:'string',minLength:1,maxLength:160,description:'Also limited to 160 UTF-8 bytes; non-ASCII labels may reach the byte limit sooner.'},collect:{type:'boolean'},warmup:{type:'boolean'},
}};
const fail=(code,message)=>{const e=new Error(message);e.code=code;throw e;};
const clone=value=>JSON.parse(JSON.stringify(value));
export function createDeveloperAPI(host,telemetry){
  const assetReader=createAssetUsageReader(host);
  const journal=[];let sequence=0;
  async function core(request={method:'snapshot'}){
    if(host.coreRequest)return host.coreRequest(request);
    const m=host.module,bytes=new TextEncoder().encode(JSON.stringify(request));
    if(bytes.length>65536)fail('REQUEST_TOO_LARGE','Maximum request size is 65536 bytes');
    const p=m._unone_web_alloc(bytes.length);m.HEAPU8.set(bytes,p);
    const status=m._unone_web_developer_request(p,bytes.length);
    const response=JSON.parse(new TextDecoder().decode(m.HEAPU8.slice(m._unone_web_observation_ptr(),m._unone_web_observation_ptr()+m._unone_web_observation_len())));
    if(status!==0||!response.ok){const e=new Error(response.diagnostics?.[0]?.explanation??'Developer bridge failed');e.code=response.diagnostics?.[0]?.code??'DEVELOPER_BRIDGE_FAILED';throw e;}
    return response.value;
  }
  function record(request,result){journal.push({sequence:++sequence,frame:host.getSnapshot()?.world?.frame??null,request:clone(request),ok:result.ok,diagnostics:result.diagnostics});if(journal.length>200)journal.shift();}
  async function request(input){
    let mutating=false;
    try {
      if(!input||typeof input!=='object'||Array.isArray(input)||!Object.hasOwn(methods,input.method))fail('DEVELOPER_REQUEST_INVALID','Use describe to discover a supported method');
      const allowed=['method',...methods[input.method]];
      if(Object.keys(input).some(k=>!allowed.includes(k)))fail('DEVELOPER_REQUEST_INVALID','Unknown field for '+input.method);
      const bool=(key)=>{if(typeof input[key]!=='boolean')fail('DEVELOPER_REQUEST_INVALID',key+' must be boolean');return input[key];};
      let value;
      switch(input.method){
        case 'describe':value={version:1,schema:requestSchema,methods,limits:{step_frames:120,journal_entries:200},profiling:{start:'profile.start',read:'profile',stop:'profile.stop',paths:{vm:'window.vm',core_phases:'window.core_phases',execution:'execution',host_timeline:'host_window.timeline',function_samples:'window.functions',publication:'publication',jobs:'jobs'},join:'Core, VM, publication and host tick entries share world frame; host spans use performance.now milliseconds. Phase-only builds retain opt2 without VM callbacks and reject sampling=true. Check execution, capabilities and retained limits before drawing conclusions.',unsupported:['JS GC pauses','Rust allocation throughput','automatic full Luau GC duration (explicit memory.sample collection is measured)','verified display presentation']},semantics:'Requests are asynchronous and ordered. Mutations execute between ticks. Tool callbacks are Lua gameplay code; failures may leave changes. No arbitrary eval.'};break;
        case 'jobs':{const data=await core({method:'profile'});value={runtime:data.jobs??null,host:host.backendReport?.().jobs??null,note:'Wall-clock diagnostics are excluded from deterministic state; results become visible no earlier than the next tick.'};break;}
        case 'snapshot':value=await core();break;
        case 'observations':{const s=host.getSnapshot();value={frame:s.world.frame,observations:s.world.observations,renderer:host.getStats(),paused:host.getPaused()};break;}
        case 'instances.transport':{
          if(!['json','memory'].includes(input.mode))fail('INSTANCE_TRANSPORT_INVALID','mode must be json or memory');
          if(host.setTransport){mutating=true;await host.setTransport(input.mode);host.draw();value={mode:input.mode};break;}
          const m=host.module;if(!m._unone_web_set_instance_transport)fail('INSTANCE_TRANSPORT_UNAVAILABLE','Rebuild a player with the instance memory ABI');
          mutating=true;const code=m._unone_web_set_instance_transport(input.mode==='memory'?1:0);
          const s=JSON.parse(new TextDecoder().decode(m.HEAPU8.slice(m._unone_web_observation_ptr(),m._unone_web_observation_ptr()+m._unone_web_observation_len())));
          if(code!==0)fail('INSTANCE_TRANSPORT_FAILED',JSON.stringify(s));host.acceptSnapshot(s);host.draw();value={mode:input.mode};break;
        }
        case 'screenshot':{
          const max_width=input.max_width??1280,max_height=input.max_height??720;
          if(![max_width,max_height].every(v=>Number.isInteger(v)&&v>=16&&v<=2048))fail('DEVELOPER_REQUEST_INVALID','max_width/max_height must be integers 16..2048');
          value=host.capture({max_width,max_height});break;
        }
        case 'hierarchy':value={entities:host.getSnapshot().world.entities,ui:host.getSnapshot().world.ui??null,note:'Entities are flat roots: this runtime has no entity parenting contract.'};break;
        case 'assets':value=await assetReader.assets();break;
        case 'asset.usages':{
          if(typeof input.id!=='string'||!input.id.trim()||input.id.length>1024)fail('DEVELOPER_REQUEST_INVALID','id must be a declared asset id or primary source path, 1..1024 characters');
          value=await assetReader.usages(input.id);break;
        }
        case 'tools.list':value=(await core({method:'tools'})).tools;break;
        case 'console':value={game:(await core()).logs,browser:telemetry.console(),retention:200};break;
        case 'network':value={resources:telemetry.network(),note:'Resource timings only; no request bodies/headers or arbitrary network interception. Zero transfer size may mean cache or restricted timing.'};break;
        case 'profile':case 'profile.start':case 'profile.stop':{
          const method=input.method==='profile'?'profile':input.method.replace('.','_');
          const sampling=input.method==='profile.start'?('sampling'in input?bool('sampling'):false):undefined;
          const data=await core({method,...(sampling===undefined?{}:{sampling})});
          if(input.method==='profile.start'){host.profileWindow?.start(host.getStats()??{});mutating=true;}
          if(input.method==='profile.stop'){host.profileWindow?.stop(host.getStats()??{});mutating=true;}
          value={frame:data.counts_frame,runtime:data.performance,window:data.window,build:data.build,execution:data.execution??null,jobs:data.jobs??null,host_window:host.profileWindow?.read(host.getStats()??{})??null,publication:data.publication??null,backend:host.backendReport?.()??null,renderer:host.getStats(),paused:host.getPaused(),note:'renderer counters may use a different rolling window; bridge_ms includes WASM tick, not pure bridge cost'};break;
        }
        case 'memory':{const data=await core({method:'profile'});const wasm=host.backendReport?.().wasm_linear_bytes??host.module?.HEAPU8?.buffer.byteLength;value={luau_used_bytes:data.performance.luau_memory_bytes,native_process_rss_bytes:'unavailable',wasm_linear_bytes:wasm??'unavailable',js_heap:telemetry.heap()??'unavailable',gpu_memory_bytes:'unavailable',renderer:host.getStats(),note:'WASM capacity is not live allocation; renderer counters are not GPU byte usage. Unavailable values are reported explicitly.'};break;}
        case 'memory.sample':case 'memory.report':case 'memory.reset':{
          const command={method:input.method.replace('.','_')};
          if(input.method==='memory.sample'){
            if(typeof input.label!=='string'||!input.label.length||new TextEncoder().encode(input.label).length>160)fail('DEVELOPER_REQUEST_INVALID','label must be 1..160 UTF-8 bytes');
            command.label=input.label;command.collect='collect'in input?bool('collect'):false;command.warmup='warmup'in input?bool('warmup'):false;
          }
          mutating=input.method!=='memory.report';value=await core(command);break;
        }
        case 'journal':value={events:journal};break;
        case 'pause':mutating=true;await host.setPaused(bool('paused'));host.releaseInput();value={paused:host.getPaused()};break;
        case 'step':{
          if(!host.getPaused())fail('PAUSE_REQUIRED','Pause the player before stepping frames');
          const count=input.count??1;if(!Number.isInteger(count)||count<1||count>120)fail('DEVELOPER_REQUEST_INVALID','count must be 1..120');
          mutating=true;for(let i=0;i<count;i++)await host.tick();host.draw();value=host.getSnapshot();break;
        }
        case 'input':if(!input.frame||typeof input.frame!=='object')fail('DEVELOPER_REQUEST_INVALID','frame is required');mutating=true;host.queueInput(input.frame);value={queued:true,semantics:'Consumed once on the next simulation tick'};break;
        case 'bloom':mutating=true;host.setBloom(bool('enabled'));host.draw();value={enabled:input.enabled};break;
        case 'restart':if(!host.restart)fail('RESTART_UNAVAILABLE','This host does not expose project restart');mutating=true;await host.restart();value={frame:host.getSnapshot().world.frame,semantics:'Reload project from assets and restore latest save; not script hot reload'};break;
        case 'tools.invoke':{
          if(typeof input.id!=='string'||!Number.isSafeInteger(input.revision)||input.revision<0||('value'in input&&typeof input.value!=='boolean'))fail('DEVELOPER_REQUEST_INVALID','Use the registered ID, revision, and a boolean only for checkboxes');
          mutating=true;const data=await core({method:'invoke',id:input.id,revision:input.revision,...('value'in input?{value:input.value}:{})});
          host.acceptSnapshot(data.observation);host.draw();value=data;break;
        }
      }
      const result=clone({ok:true,value,diagnostics:[],effects:mutating?[{kind:'developer_operation',method:input.method}]:[]});
      if(mutating)record(input,result);return result;
    }catch(error){
      if(mutating){try{host.acceptSnapshot((await core()).observation);host.draw();}catch{}}
      const result={ok:false,value:null,diagnostics:[{code:error.code??'DEVELOPER_REQUEST_FAILED',explanation:error.message}],effects:mutating?[{kind:'inspect_state_before_retry',reason:'An operation may have partially changed game state.'}]:[]};
      record(input&&typeof input==='object'?input:{method:String(input)},result);return result;
    }
  }
  let tail=Promise.resolve(),pending=0;return Object.freeze({request(input){if(pending>=32)return Promise.resolve({ok:false,value:null,diagnostics:[{code:'DEVELOPER_QUEUE_FULL',explanation:'Wait for outstanding requests'}],effects:[]});pending++;const result=tail.then(()=>request(input));tail=result.catch(()=>{});return result.finally(()=>pending--);}});
}
