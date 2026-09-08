// One structured API for the human panel, browser agents and automation.
export const methods = {
  describe:[], snapshot:[], hierarchy:[], console:[], network:[], profile:[], memory:[],
  'tools.list':[], 'tools.invoke':['id','revision','value'], pause:['paused'], step:['count'],
  input:['frame'], bloom:['enabled'], journal:[],
};
export const requestSchema={type:'object',additionalProperties:false,required:['method'],properties:{
  method:{type:'string',enum:Object.keys(methods)},id:{type:'string'},revision:{type:'integer',minimum:0},
  value:{type:'boolean'},paused:{type:'boolean'},count:{type:'integer',minimum:1,maximum:120},
  frame:{type:'object'},enabled:{type:'boolean'},
}};
const fail=(code,message)=>{const e=new Error(message);e.code=code;throw e;};
const clone=value=>JSON.parse(JSON.stringify(value));
export function createDeveloperAPI(host,telemetry){
  const journal=[];let sequence=0;
  function core(request={method:'snapshot'}){
    const m=host.module,bytes=new TextEncoder().encode(JSON.stringify(request));
    if(bytes.length>65536)fail('REQUEST_TOO_LARGE','Maximum request size is 65536 bytes');
    const p=m._unone_web_alloc(bytes.length);m.HEAPU8.set(bytes,p);
    const status=m._unone_web_developer_request(p,bytes.length);
    const response=JSON.parse(new TextDecoder().decode(m.HEAPU8.slice(m._unone_web_observation_ptr(),m._unone_web_observation_ptr()+m._unone_web_observation_len())));
    if(status!==0||!response.ok){const e=new Error(response.diagnostics?.[0]?.explanation??'Developer bridge failed');e.code=response.diagnostics?.[0]?.code??'DEVELOPER_BRIDGE_FAILED';throw e;}
    return response.value;
  }
  function record(request,result){journal.push({sequence:++sequence,frame:host.getSnapshot()?.world?.frame??null,request:clone(request),ok:result.ok,diagnostics:result.diagnostics});if(journal.length>200)journal.shift();}
  function request(input){
    let mutating=false;
    try {
      if(!input||typeof input!=='object'||Array.isArray(input)||!Object.hasOwn(methods,input.method))fail('DEVELOPER_REQUEST_INVALID','Use describe to discover a supported method');
      const allowed=['method',...methods[input.method]];
      if(Object.keys(input).some(k=>!allowed.includes(k)))fail('DEVELOPER_REQUEST_INVALID','Unknown field for '+input.method);
      const bool=(key)=>{if(typeof input[key]!=='boolean')fail('DEVELOPER_REQUEST_INVALID',key+' must be boolean');return input[key];};
      let value;
      switch(input.method){
        case 'describe':value={version:1,schema:requestSchema,methods,limits:{step_frames:120,journal_entries:200},semantics:'Mutations execute between ticks. Tool callbacks are Lua gameplay code; failures may leave changes. No arbitrary eval.'};break;
        case 'snapshot':value=core();break;
        case 'hierarchy':value={entities:host.getSnapshot().world.entities,ui:host.getSnapshot().world.ui??null,note:'Entities are flat roots: this runtime has no entity parenting contract.'};break;
        case 'tools.list':value=core().tools;break;
        case 'console':value={game:core().logs,browser:telemetry.console(),retention:200};break;
        case 'network':value={resources:telemetry.network(),note:'Resource timings only; no request bodies/headers or arbitrary network interception. Zero transfer size may mean cache or restricted timing.'};break;
        case 'profile':value={runtime:core().performance,renderer:host.getStats(),startup:host.getBoot(),paused:host.getPaused()};break;
        case 'memory':{const data=core();value={luau_used_bytes:data.performance.luau_memory_bytes,wasm_linear_bytes:host.module.HEAPU8.buffer.byteLength,js_heap:telemetry.heap(),renderer:host.getStats(),note:'WASM capacity is not live allocation; renderer counters are not GPU byte usage. Unsupported JS heap is null.'};break;}
        case 'journal':value={events:journal};break;
        case 'pause':mutating=true;host.setPaused(bool('paused'));host.releaseInput();value={paused:host.getPaused()};break;
        case 'step':{
          if(!host.getPaused())fail('PAUSE_REQUIRED','Pause the player before stepping frames');
          const count=input.count??1;if(!Number.isInteger(count)||count<1||count>120)fail('DEVELOPER_REQUEST_INVALID','count must be 1..120');
          mutating=true;for(let i=0;i<count;i++)host.tick();host.draw();value=host.getSnapshot();break;
        }
        case 'input':if(!input.frame||typeof input.frame!=='object')fail('DEVELOPER_REQUEST_INVALID','frame is required');mutating=true;host.queueInput(input.frame);value={queued:true,semantics:'Consumed once on the next simulation tick'};break;
        case 'bloom':mutating=true;host.setBloom(bool('enabled'));host.draw();value={enabled:input.enabled};break;
        case 'tools.invoke':{
          if(typeof input.id!=='string'||!Number.isSafeInteger(input.revision)||input.revision<0||('value'in input&&typeof input.value!=='boolean'))fail('DEVELOPER_REQUEST_INVALID','Use the registered ID, revision, and a boolean only for checkboxes');
          mutating=true;const data=core({method:'invoke',id:input.id,revision:input.revision,...('value'in input?{value:input.value}:{})});
          host.acceptSnapshot(data.observation);host.draw();value=data;break;
        }
      }
      const result=clone({ok:true,value,diagnostics:[],effects:mutating?[{kind:'developer_operation',method:input.method}]:[]});
      if(mutating)record(input,result);return result;
    }catch(error){
      if(mutating){try{host.acceptSnapshot(core().observation);host.draw();}catch{}}
      const result={ok:false,value:null,diagnostics:[{code:error.code??'DEVELOPER_REQUEST_FAILED',explanation:error.message}],effects:mutating?[{kind:'inspect_state_before_retry',reason:'An operation may have partially changed game state.'}]:[]};
      record(input&&typeof input==='object'?input:{method:String(input)},result);return result;
    }
  }
  return Object.freeze({request});
}
