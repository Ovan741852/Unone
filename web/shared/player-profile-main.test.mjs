// Actual official-player main.js acceptSnapshot/draw/advance/tickOnce with the real backend
// (deterministic worker), real interpolator and real player profiler.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRuntimeBackend} from './runtime-backend.mjs';
import {createPresentationInterpolator} from './presentation-interpolation.mjs';
import {createPlayerProfiler} from './raster-diagnostics.mjs';
import {createPlayerCompletionMetrics,installPlayerPerformanceAccessor} from './player-completion.mjs';
import {createAsyncScheduler} from './async-scheduler.mjs';
import {serializedSavePayload} from './save-publication.mjs';
const source=fs.readFileSync(process.env.UNONE_PROFILE_MAIN_SOURCE??new URL('../player/main.js',import.meta.url),'utf8');
const slice=source.slice(source.indexOf('function acceptSnapshot('),source.indexOf('async function setPaused('));
class Remote{
 constructor(){this.fail=false;this.frame=0;this.posts=[];}
 postMessage({id,command}){this.posts.push(command.kind);const deliver=()=>{
  if(command.kind==='init')return this.onmessage({data:{id,ok:true,packet:{value:null,updates:[],removed:[]}}});
  if(this.fail)return this.onmessage({data:{id,ok:false,error:'TICK_FAILED'}});
  this.onmessage({data:{id,ok:true,packet:{value:{world:{frame:++this.frame,time_seconds:this.frame/60,entities:{}},save_payload:this.savePayload===undefined?{n:this.frame}:this.savePayload},updates:[],removed:[]},metrics:{}}});};if(command.kind==='tick'&&this.holdTick)this.release=()=>{this.holdTick=false;setTimeout(deliver);};else setTimeout(deliver);}
 terminate(){}
}
async function fixture(profiler,{throwDraw=false,drawOutcome,uiOutcome={status:'completed'},cursorOutcome={status:'completed'}}={}){
 let remote;class W extends Remote{constructor(){super();remote=this;}}
 const backend=await createRuntimeBackend({kind:'worker',url:'http://unone.test/r.js',WorkerClass:W,...(profiler?{profiler}:{})});
 const log=[],storage=new Map(),body={dataset:{}};
 const renderer={draw(s){log.push(['render',s.world.frame]);profiler?.renderer.mark('frame_decode_validate');if(throwDraw)throw Error('RENDER_FAILED');profiler?.renderer.outcome('completed');return drawOutcome;},
  metrics:()=>({}),};
 const context={resourceHost:null,profiler,profileFlight:null,profileLastSource:null,backend,renderer,imageAssets:null,serializedSavePayload,playerCompletion:createPlayerCompletionMetrics(),snapshot:{world:{frame:0,entities:{}}},interpolator:createPresentationInterpolator(),presentationMemory:null,tickFlight:null,
  bridgeMs:0,renderMs:0,renderCount:0,frozen:false,manualInput:null,lastStats:null,hasWorldPointer:false,saved:'null',key:'k',orderedQueue:null,scheduler:null,audio:null,
  input:{consumeFrame:()=>({actions:[]})},renderUi:()=>{log.push(['ui']);return uiOutcome;},uiRenderer:{report:()=>({})},cursorHost:{update:()=>cursorOutcome,report:()=>({})},canvas:{width:1,height:1},
  document:{body},localStorage:{setItem:(k,v)=>{storage.set(k,v);log.push(['save']);}},publishPhysical(){},performance,JSON,Error,String};
 vm.createContext(context);vm.runInContext(slice,context);context.acceptSnapshot(context.snapshot,{reset:true});
 return {context,backend,log,storage,body,remote:()=>remote};
}
async function journey(f){
 await f.context.tickOnce();f.context.draw();f.context.draw();
 const a=f.context.tickOnce(),b=f.context.tickOnce();assert.equal(a,b,'in-flight tick is shared');await a;f.context.draw();
}
test('disabled profiling leaves draw/update/save behavior and published datasets unchanged',async()=>{
 const off=await fixture(null),on=await fixture(createPlayerProfiler({limit:64}));
 await journey(off);await journey(on);
 assert.deepEqual(on.log,off.log);assert.deepEqual([...on.storage],[...off.storage]);
 assert.deepEqual(on.remote().posts,off.remote().posts,'no extra backend commands or gameplay updates');
 assert.equal(off.body.dataset.playerProfile,undefined);
 assert.deepEqual(Object.keys(off.body.dataset).sort(),['playerCursor','playerFrame']);
});
test('updates and draws are distinct identities; redraws of one snapshot are flagged, not new updates',async()=>{
 const p=createPlayerProfiler({limit:64}),f=await fixture(p);await journey(f);
 const events=p.report().events,updates=events.filter(e=>e.kind==='update'),draws=events.filter(e=>e.kind==='draw');
 assert.deepEqual(updates.map(e=>[e.id,e.status,e.attrs.command,e.attrs.snapshot_frame]),[['update:1','ok','command:2',1],['update:2','ok','command:3',2]]);
 assert.deepEqual(updates[0].spans.map(s=>s.name),['input_consume','backend_request','accept_snapshot','audio_sync','save_persist']);
 const commands=events.filter(e=>e.kind==='command'&&e.attrs.command_kind==='tick');
 assert.deepEqual(commands.map(e=>[e.id,e.attrs.owner]),[['command:2','update:1'],['command:3','update:2']]);
 assert.deepEqual(draws.map(e=>[e.id,e.status,e.attrs.source_command,e.attrs.snapshot_frame,e.attrs.redraw]),
  [['draw:1','completed','command:2',1,false],['draw:2','completed','command:2',1,true],['draw:3','completed','command:3',2,false]]);
 assert.deepEqual(draws[0].spans.map(s=>[s.name,s.parent]),[['interpolation_sample',null],['frame_decode_validate','renderer_draw'],['renderer_draw',null],['ui_draw',null],['host_publish',null]]);
 const coalesced=events.filter(e=>e.kind==='update_request');
 assert.deepEqual(coalesced.map(e=>[e.status,e.attrs.joined]),[['coalesced','update:2']]);
});
test('failed updates and draws keep identity and status, then rethrow unchanged',async()=>{
 const p=createPlayerProfiler({limit:64}),f=await fixture(p,{throwDraw:true});
 f.remote().fail=true;await assert.rejects(f.context.tickOnce(),/TICK_FAILED/);
 const failed=p.report().events.filter(e=>e.kind==='update').at(-1);assert.deepEqual([failed.id,failed.status,failed.attrs.error_code],['update:1','error','TICK_FAILED']);
 assert.throws(()=>f.context.draw(),/RENDER_FAILED/);
 const draw=p.report().events.filter(e=>e.kind==='draw').at(-1);assert.deepEqual([draw.id,draw.status,draw.attrs.error_code],['draw:1','error','RENDER_FAILED']);
 assert.equal(draw.spans.at(-1).name,'renderer_draw','partial spans up to the failing phase');
});
test('an in-flight update evicted by a command backlog still completes the real tick unchanged',async()=>{
 async function backlog(profiler){
  const f=await fixture(profiler);const tick=f.context.tickOnce();
  // e.g. a resize flood while the tick is in flight: 16 legal queued commands.
  const flood=Array.from({length:16},()=>f.backend.request({kind:'viewport',width:1280,height:720}));
  await tick;await Promise.all(flood);f.context.draw();return f;
 }
 const off=await backlog(null),p=createPlayerProfiler({limit:16}),on=await backlog(p);
 assert.deepEqual(on.log,off.log);assert.deepEqual([...on.storage],[...off.storage]);assert.deepEqual(on.remote().posts,off.remote().posts);
 const r=p.report();assert(r.counts.abandoned>=1);assert.equal(r.counts.late_ends,r.counts.abandoned);
 assert.equal(r.counts.open,0);
});
test('actual main entry with worker snapshots counts only complete world/UI/cursor submissions',async()=>{
 const done={status:'completed'};
 for(const options of [{drawOutcome:{status:'skipped',reason:'frame_resources_pending'}},{drawOutcome:done,uiOutcome:{status:'skipped',reason:'ui_assets_pending'}},{drawOutcome:done,cursorOutcome:{status:'skipped',reason:'cursor_assets_pending'}},{}]){
  const f=await fixture(null,options);await f.context.tickOnce();f.context.draw();
  const r=f.context.playerCompletion.snapshot();assert.equal(r.simulation_frame,1);assert.equal(r.simulation_time_seconds,1/60);assert.equal(r.completed_draws,0);assert.equal(r.last_presented_snapshot_frame,null);
  assert.deepEqual(f.remote().posts,['init','tick'],'metrics add no worker commands');f.backend.close();
 }
 const f=await fixture(null,{drawOutcome:done});await f.context.tickOnce();f.context.draw();f.context.draw();
 let r=f.context.playerCompletion.snapshot();assert.equal(r.completed_draws,2);assert.equal(r.presented_frame_changes,1);assert.equal(r.last_presented_snapshot_frame,1);
 await f.context.tickOnce();r=f.context.playerCompletion.snapshot();assert.equal(r.simulation_frame,2);assert.equal(r.last_presented_snapshot_frame,1,'accepted worker reply is not a completed draw');
 f.context.acceptSnapshot({world:{frame:0,time_seconds:0}},{reset:true,newSession:true});r=f.context.playerCompletion.snapshot();assert.equal(r.draw_attempts,0);assert.equal(r.simulation_frame,0);f.backend.close();
});

test('actual player with real worker accepts then draws each fixed tick under its originating RAF token',async()=>{
 const f=await fixture(null,{drawOutcome:{status:'completed'}}),frames=new Map();let time=0,id=0,prepared,failure=null;
 f.context.performance={now:()=>time};f.context.playerCompletion=createPlayerCompletionMetrics({now:()=>time});f.context.acceptSnapshot(f.context.snapshot,{reset:true,newSession:true});
 const scheduler=createAsyncScheduler({now:()=>time,raf:fn=>{frames.set(++id,fn);return id;},cancelRaf:n=>frames.delete(n),visibilityTarget:null,
  tick:()=>f.context.tickOnce(),render:(at,start,flight,source,budget)=>f.context.draw(at,start,flight,source,budget),onError:error=>failure=error,
  onRafEnd:(...args)=>f.context.playerCompletion.rafEnd(...args),onPreparationStart:()=>f.context.playerCompletion.epoch(),
  onPreparationEnd:(...args)=>{f.context.playerCompletion.preparationEnd(...args);prepared?.();}});f.context.scheduler=scheduler;
 scheduler.start();
 for(let i=1;i<=120;i++){
  time=Math.round(i*1000/60*10)/10;const pending=[...frames.values()];frames.clear();assert.equal(pending.length,1);
  const done=new Promise(resolve=>prepared=resolve);pending[0](time);await done;assert.equal(failure,null);
 }
 const r=f.context.playerCompletion.snapshot();assert.equal(r.simulation_frame,120);assert.equal(r.completed_draws,120);assert.equal(r.presented_frame_changes,120);assert.equal(r.last_presented_snapshot_frame,120);
 assert.deepEqual(f.log.filter(x=>x[0]==='render').map(x=>x[1]),Array.from({length:120},(_,i)=>i+1));assert.equal(scheduler.totalDroppedSteps,0);assert(Math.abs(r.completed_intervals.p99_ms-16.7)<1e-6);
 assert.equal(r.raf_diagnostics.source_counts.scheduler_raf,120);assert.equal(r.raf_diagnostics.preparation_steps,120);assert.equal('samples'in r.raf_diagnostics,false);assert(Math.abs(r.successful_submission_raf_intervals.p99_ms-16.7)<1e-6);
 const pairs=f.context.playerCompletion.snapshot({includeRafSamples:true,windowMs:1000}).raf_diagnostics.samples;assert(pairs.length<=61);assert.equal(pairs.at(-1).snapshot_frame,120);assert.equal(pairs.at(-1).source,'scheduler_raf');assert.equal(pairs.at(-1).callback_end_ms,2000);
 assert.deepEqual(f.remote().posts,['init',...Array(120).fill('tick')]);scheduler.stop();f.backend.close();
});

test('actual player awaits one worker publication and draws once in its originating RAF continuation',async()=>{
 const f=await fixture(null,{drawOutcome:{status:'completed'}}),frames=new Map();let time=0,id=0,prepared,failure=null;
 f.context.performance={now:()=>time};f.context.playerCompletion=createPlayerCompletionMetrics({now:()=>time});f.context.acceptSnapshot(f.context.snapshot,{reset:true,newSession:true});
 const scheduler=createAsyncScheduler({now:()=>time,raf:fn=>{frames.set(++id,fn);return id;},cancelRaf:n=>frames.delete(n),visibilityTarget:null,
  tick:()=>f.context.tickOnce(),render:(at,start,flight,source,budget)=>f.context.draw(at,start,flight,source,budget),onError:error=>failure=error,
  onRafEnd:(...args)=>f.context.playerCompletion.rafEnd(...args),onPreparationStart:()=>f.context.playerCompletion.epoch(),
  onPreparationEnd:(...args)=>{f.context.playerCompletion.preparationEnd(...args);prepared?.();}});f.context.scheduler=scheduler;
 f.remote().holdTick=true;scheduler.start();time=16.7;const draw=[...frames.values()][0];frames.clear();const done=new Promise(resolve=>prepared=resolve);draw(time);
 for(let i=0;i<8;i++)await Promise.resolve();
 assert.deepEqual(f.remote().posts,['init','tick']);assert.equal(frames.size,0);assert.equal(f.context.playerCompletion.snapshot().completed_draws,0);assert.equal(f.context.playerCompletion.snapshot().last_presented_snapshot_frame,null);
 time=30;f.remote().release();await done;assert.equal(failure,null);
 const r=f.context.playerCompletion.snapshot({includeRafSamples:true});assert.equal(r.completed_draws,1);assert.equal(r.presented_frame_changes,1);assert.equal(r.last_presented_snapshot_frame,1);assert.equal(frames.size,1);
 assert.deepEqual(f.log.filter(x=>x[0]==='render'),[['render',1]]);assert.equal(r.raf_diagnostics.samples[0].raf_time_ms,16.7);assert.equal(r.raf_diagnostics.samples[0].start_ms,30);assert.equal(r.callback_sync_wall.max_ms,0);assert(Math.abs(r.preparation_wall.max_ms-13.3)<1e-6);
 time=33.4;const next=[...frames.values()][0];frames.clear();const again=new Promise(resolve=>prepared=resolve);next(time);await again;assert.equal(f.context.playerCompletion.snapshot().last_presented_snapshot_frame,2);scheduler.stop();f.backend.close();
});

test('actual tick persistence skips unchanged saves and commits the marker only after successful change/clear writes',async()=>{
 const f=await fixture(null),writes=[],setItem=f.context.localStorage.setItem;
 f.context.localStorage.setItem=(key,text)=>{writes.push(text);setItem(key,text);};
 f.context.saved='{"coins":1}';f.remote().savePayload={coins:1};await f.context.tickOnce();await f.context.tickOnce();assert.deepEqual(writes,[]);
 f.remote().savePayload={coins:2};await f.context.tickOnce();await f.context.tickOnce();assert.deepEqual(writes,['{"coins":2}']);
 f.remote().savePayload=null;await f.context.tickOnce();await f.context.tickOnce();assert.deepEqual(writes,['{"coins":2}','null']);
 const error=Error('storage quota denied');f.remote().savePayload={coins:3};f.context.localStorage.setItem=()=>{throw error;};
 await assert.rejects(f.context.tickOnce(),e=>e===error);assert.equal(f.context.saved,'null','failed storage cannot mark accepted simulation data as persisted');
 f.context.localStorage.setItem=(key,text)=>{writes.push(text);setItem(key,text);};await f.context.tickOnce();
 assert.deepEqual(writes,['{"coins":2}','null','{"coins":3}']);assert.equal(f.context.saved,'{"coins":3}');f.backend.close();
});

test('actual public accessor forwards opt-in paired RAF samples and rejects unknown or malformed options without backend work',()=>{
 const context={window:{},playerCompletion:createPlayerCompletionMetrics({now:()=>10}),installPlayerPerformanceAccessor,scheduler:null,frozen:false,backend:{kind:'worker'}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('const removePerformanceAccessor='),source.indexOf('let orderedQueue=')),context);
 const read=context.window.unonePlayerPerformance.snapshot;
 for(const options of [null,1,[],{unknown:true},{includeRafSamples:null},{includeRafSamples:1},{windowMs:null}])assert.throws(()=>read(options),/PLAYER_PERFORMANCE/);
 const done={status:'completed'};context.playerCompletion.finish(done,done,done,1,9,'scheduler_raf',5,6);context.playerCompletion.rafEnd(5,6,10);
 assert.equal(read().backend,'worker');assert.equal('samples'in read().raf_diagnostics,false);const requested=read({includeRafSamples:true,windowMs:1000});assert.equal(requested.version,1);assert.equal(requested.raf_diagnostics.samples.length,1);assert.equal(requested.raf_diagnostics.samples[0].raf_time_ms,5);vm.runInContext('removePerformanceAccessor()',context);assert.equal('unonePlayerPerformance'in context.window,false);
});
