// Keep downloads beside the VM (including in a worker). Only input-frame
// receipts admit their bytes, at a deterministic game tick.
const decoder=new TextDecoder('utf-8',{fatal:true});
const uint=value=>Number.isInteger(value)&&value>0&&value<=0xffffffff;

export function createDeferredDataHost(module,payload,{baseURL,readSource}={}){
  const files=new Map((payload?.data_assets??[]).filter(asset=>asset.on_demand===true).map(asset=>[asset.id,asset.source]));
  if(!files.size)return null;
  if(typeof module._unone_web_data_requests!=='function'||typeof module._unone_web_deferred_reserve!=='function')
    throw Error('DEFERRED_DATA_ABI_UNAVAILABLE: rebuild the Web runtime');
  let session=0,revision=0,requests=[],closed=false;

  async function fetchBytes(source,signal){
    const response=await fetch(new URL(source,baseURL),{signal});
    if(!response.ok)throw Error(`CONTENT_LOAD_FAILED: ${source} (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  }
  function start(source){
    const controller=new AbortController();
    const job={controller,state:'loading',bytes:null,sha256:null,done:null};
    job.done=(async()=>{
      try{
        const bytes=await (readSource??fetchBytes)(source,controller.signal);
        if(controller.signal.aborted)return;
        if(!(bytes instanceof Uint8Array))throw Error('DEFERRED_DATA_BYTES_INVALID');
        const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
        if(controller.signal.aborted)return;
        job.bytes=bytes;job.sha256=Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('');job.state='ready';
      }catch{if(!controller.signal.aborted)job.state='failed';}
    })();
    return job;
  }
  function refresh(){
    if(closed)return;
    const status=module._unone_web_data_requests(revision);
    if(status===1)return;
    if(status!==0)throw Error('DEFERRED_DATA_PLAN_FAILED');
    const at=module._unone_web_observation_ptr(),length=module._unone_web_observation_len();
    if(!Number.isSafeInteger(at)||at<0||!Number.isSafeInteger(length)||length<1||length>1024*1024||at+length>module.HEAPU8.length)
      throw Error('DEFERRED_DATA_PLAN_INVALID');
    const plan=JSON.parse(decoder.decode(module.HEAPU8.subarray(at,at+length)));
    if(!plan||!uint(plan.session)||!uint(plan.revision)||plan.revision<=revision||(session&&plan.session!==session)||!Array.isArray(plan.requests)||plan.requests.length>files.size)
      throw Error('DEFERRED_DATA_PLAN_INVALID');
    const prior=new Map(requests.map(row=>[row.request,row]));
    const tokens=new Set(),ids=new Set(),shared=new Map();
    for(const row of plan.requests){
      if(!row||!files.has(row.id)||!uint(row.request)||tokens.has(row.request)||ids.has(row.id))throw Error('DEFERRED_DATA_PLAN_INVALID');
      tokens.add(row.request);ids.add(row.id);
      const existing=prior.get(row.request);
      if(existing&&existing.id!==row.id)throw Error('DEFERRED_DATA_PLAN_INVALID');
      if(existing&&existing.job.state!=='failed')shared.set(files.get(row.id),existing.job);
    }
    // A new request for the same source after release/failure is a fresh
    // attempt, even when the game's release and retry occur in the same tick.
    const next=plan.requests.map(({id,request})=>{
      if(prior.has(request))return prior.get(request);
      const source=files.get(id);
      if(!shared.has(source))shared.set(source,start(source));
      return {id,request,job:shared.get(source)};
    });
    const live=new Set(next.map(row=>row.job));
    for(const {job} of requests)if(!live.has(job))job.controller.abort();
    session=plan.session;revision=plan.revision;requests=next;
  }
  function copyReady(row,job){
    const at=module._unone_web_deferred_reserve(session,row.request,job.bytes.byteLength);
    if(!at)return false;
    if(!Number.isSafeInteger(at)||at<0||at+job.bytes.byteLength>module.HEAPU8.length)throw Error('DEFERRED_DATA_RESERVE_INVALID');
    module.HEAPU8.set(job.bytes,at);
    return true;
  }
  async function input(frame){
    if(closed)throw Error('RUNTIME_CLOSED');
    if(Object.hasOwn(frame,'data_assets')){
      // A replay controls *when* bytes appear, including an explicit empty
      // receipt list. Wait only on a recorded ready receipt for a live request.
      if(!Array.isArray(frame.data_assets))throw Error('DEFERRED_DATA_RECEIPTS_INVALID');
      const deliveries=[];
      for(const row of frame.data_assets){
        const current=row?.state==='ready'&&requests.find(p=>p.id===row.id&&p.request===row.request);
        if(current)deliveries.push({row,job:current.job});
      }
      await Promise.all(deliveries.map(({job})=>job.done));
      if(closed)throw Error('RUNTIME_CLOSED');
      for(const {row,job} of deliveries)if(job.state!=='ready'||job.sha256!==row.sha256)throw Error(`DEFERRED_DATA_REPLAY_MISMATCH: ${row.id}`);
      for(const {row,job} of deliveries)if(!copyReady(row,job))throw Error(`DEFERRED_DATA_REPLAY_MISMATCH: ${row.id}`);
      return frame;
    }
    const receipts=[];
    for(const {id,request,job} of requests){
      if(job.state==='loading')continue;
      if(job.state==='ready'&&copyReady({request},job))receipts.push({id,request,state:'ready',sha256:job.sha256});
      else receipts.push({id,request,state:'failed'});
    }
    return {...frame,data_assets:receipts};
  }
  function close(){
    closed=true;
    for(const {job} of requests)job.controller.abort();
    requests=[];
  }
  return {refresh,input,close};
}
