import {createThreeRenderer} from '../web/renderer/three.js';
import {boot} from './runtime-host.mjs';
const query=new URLSearchParams(location.search),mode=query.get('mode')??'worker',label=query.get('label')??'manual';
if(!['main','worker'].includes(mode))throw Error('Invalid mode');
const canvas=document.querySelector('#game'),status=document.querySelector('#status');
let snapshot,memory,host,worker,renderer,workerMetrics,workerReady,stepReady;
let messageLagMs=[],rafTotal=0,lastStatus=0;
let rafMs=[],renderMs=[],tickMs=[],tickCount=0,dropped=0,checkpoints=[],transferBytes=0,messageCount=0;
let active=true,measuring=false,last=0,accumulator=0,previousRaf=0,startTime=0;
const ready=new Promise(resolve=>workerReady=resolve);
const summarize=raw=>{if(!raw.length)return null;const sorted=[...raw].sort((a,b)=>a-b);return {count:raw.length,mean_ms:raw.reduce((a,b)=>a+b,0)/raw.length,p95_ms:sorted[Math.ceil(sorted.length*.95)-1],max_ms:sorted.at(-1)};};
function error(e){active=false;status.textContent='ERROR '+String(e.stack??e);document.body.dataset.error=status.textContent;console.error(e);fetch('/__report?name='+label+'-'+mode+'-error',{method:'POST',body:JSON.stringify({error:String(e.stack??e)})});}
async function start(){
 if(mode==='worker'){
  worker=new Worker(new URL('./worker.js',import.meta.url));worker.onerror=e=>error(Error(e.message));
  worker.onmessage=({data})=>{if(data.kind==='error')return error(Error(data.message));if(data.kind==='state'){snapshot=data.snapshot;if(data.binary)memory=data.binary;worker.postMessage({kind:'ack'});stepReady?.();stepReady=null;if(measuring){messageCount++;messageLagMs.push(performance.timeOrigin+performance.now()-data.sent_at);transferBytes+=data.binary?.byteLength??0;}}
   if(data.kind==='ready')workerReady();if(data.kind==='metrics')workerMetrics=data;};worker.postMessage({kind:'boot'});await ready;
 }else{host=await boot();snapshot=host.read();memory=host.module.HEAPU8.buffer;}
 if(query.has('verify')){
  if(!worker)throw Error('Verification requires worker mode');
  const reference=await boot();let checkedBytes=0;
  for(let i=0;i<180;i++){
   const stepped=new Promise(resolve=>stepReady=resolve);worker.postMessage({kind:'step'});await stepped;
   const expected=reference.tick();if(expected.observation_digest!==snapshot.observation_digest)throw Error('WORKER_DIGEST_MISMATCH frame '+expected.world.frame);
   for(const [id,batch]of Object.entries(expected.world.instances3d)){
    const actual=snapshot.world.instances3d[id],a=new Uint8Array(reference.module.HEAPU8.buffer,batch.memory.offset,batch.memory.byte_length),b=new Uint8Array(memory,actual.memory.offset,actual.memory.byte_length);
    if(a.length!==b.length||a.some((value,index)=>value!==b[index]))throw Error('WORKER_INSTANCE_BYTES_MISMATCH '+id);checkedBytes+=a.length;
   }
  }
  worker.terminate();const result={ok:true,frames:180,checked_bytes:checkedBytes,scope:'Actual browser Worker vs main WASM: every-tick canonical digest and every instance byte'};
  status.textContent=JSON.stringify(result,null,2);await fetch('/__report?name='+label+'-parity',{method:'POST',body:JSON.stringify(result)});return;
 }
 const assets=await(await fetch('content/assets.json')).json();
 renderer=await createThreeRenderer(canvas,{kind:'three-webgl',bloom:false,instanceMemory:()=>memory,getAssetManifest:()=>assets,loadAssetUrl:async asset=>new URL('content/'+asset.source,location.href).href});
 renderer.draw(snapshot);await renderer.ready();renderer.draw(snapshot);
 // Fixed 120 engine tick warmup on both backends, with the renderer already loaded.
 const firstFrame=snapshot.world.frame;
 last=performance.now();if(worker)worker.postMessage({kind:'start'});
 requestAnimationFrame(frame);
 async function frame(now){if(!active)return;try{
  if(mode==='main'){
   accumulator+=Math.min(250,now-last);let due=Math.floor(accumulator/(1000/60));if(due>2){if(measuring)dropped+=due-2;accumulator-=(due-2)*1000/60;due=2;}
   for(let i=0;i<due;i++){const at=performance.now();snapshot=host.tick();memory=host.module.HEAPU8.buffer;if(measuring){tickMs.push(performance.now()-at);tickCount++;if(snapshot.world.frame%120===0)checkpoints.push({frame:snapshot.world.frame,digest:snapshot.observation_digest});}accumulator-=1000/60;}
  }
  last=now;
  if(!measuring && snapshot.world.frame-firstFrame>=120){measuring=true;startTime=performance.now();previousRaf=0;if(worker)worker.postMessage({kind:'resetMetrics'});}
  const at=performance.now();renderer.draw(snapshot);const end=performance.now();
  if(measuring){renderMs.push(end-at);if(previousRaf){rafMs.push(now-previousRaf);rafTotal+=now-previousRaf;}previousRaf=now;}
  if(now-lastStatus>250){lastStatus=now;status.textContent=`${mode.toUpperCase()} · 10,000 units · 1280×720 CSS\nFrame ${snapshot.world.frame} · ${measuring?(rafTotal?rafMs.length*1000/rafTotal:0).toFixed(1)+' RAF FPS':'warming up'}\n${renderer.metrics().draw_calls} draws · experiment, not search-only offload`;}
  if(measuring&&end-startTime>=30000){active=false;const wall=end-startTime;if(worker){worker.postMessage({kind:'stop'});for(let i=0;i<100&&!workerMetrics;i++)await new Promise(r=>setTimeout(r,20));if(!workerMetrics)throw Error('Worker stop timed out');}
   const metrics=workerMetrics??{ticks:tickCount,dropped,tickMs,checkpoints};
   const result={mode,label,scope:'Complete unchanged Luau simulation in Worker vs main thread; not targeting-only. 10k immortal units, fixed camera, 120 tick warmup, 30 seconds wall, no active profiler.',user_agent:navigator.userAgent,hardware_concurrency:navigator.hardwareConcurrency,dpr:devicePixelRatio,canvas:[canvas.width,canvas.height],wall_ms:wall,raf_fps:rafMs.length/(rafMs.reduce((a,b)=>a+b,0)/1000),render_completions_per_s:renderMs.length/(wall/1000),simulation_ticks_per_s:metrics.ticks/(wall/1000),dropped_ticks:metrics.dropped,raf:summarize(rafMs),render:summarize(renderMs),tick:summarize(metrics.tickMs),pack:summarize(metrics.packMs??[]),transfer_bytes:transferBytes,message_count:messageCount,message_lag:summarize(messageLagMs),checkpoints:metrics.checkpoints,battle:snapshot.world.observations.battle,renderer:renderer.metrics(),raw:{raf_ms:rafMs,render_ms:renderMs,tick_ms:metrics.tickMs}};
   document.body.dataset.result=JSON.stringify(result);status.textContent=JSON.stringify({...result,raw:undefined,checkpoints:undefined,renderer:undefined,battle:undefined},null,2);
   const response=await fetch('/__report?name='+label+'-'+mode,{method:'POST',body:JSON.stringify(result)});if(!response.ok)throw Error('Report save failed '+response.status);worker?.terminate();return;
  }
  requestAnimationFrame(frame);
 }catch(e){error(e);}}
}
start().catch(error);
