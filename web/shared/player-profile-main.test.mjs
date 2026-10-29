// Actual official-player main.js acceptSnapshot/draw/advance/tickOnce with the real backend
// (deterministic worker), real interpolator and real player profiler.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRuntimeBackend} from './runtime-backend.mjs';
import {createPresentationInterpolator} from './presentation-interpolation.mjs';
import {createPlayerProfiler} from './raster-diagnostics.mjs';
const source=fs.readFileSync(process.env.UNONE_PROFILE_MAIN_SOURCE??new URL('../player/main.js',import.meta.url),'utf8');
const slice=source.slice(source.indexOf('function acceptSnapshot('),source.indexOf('async function setPaused('));
class Remote{
 constructor(){this.fail=false;this.frame=0;this.posts=[];}
 postMessage({id,command}){this.posts.push(command.kind);setTimeout(()=>{
  if(command.kind==='init')return this.onmessage({data:{id,ok:true,packet:{value:null,updates:[],removed:[]}}});
  if(this.fail)return this.onmessage({data:{id,ok:false,error:'TICK_FAILED'}});
  this.onmessage({data:{id,ok:true,packet:{value:{world:{frame:++this.frame,entities:{}},save_payload:{n:this.frame}},updates:[],removed:[]},metrics:{}}});});}
 terminate(){}
}
async function fixture(profiler,{throwDraw=false}={}){
 let remote;class W extends Remote{constructor(){super();remote=this;}}
 const backend=await createRuntimeBackend({kind:'worker',url:'http://unone.test/r.js',WorkerClass:W,...(profiler?{profiler}:{})});
 const log=[],storage=new Map(),body={dataset:{}};
 const renderer={draw(s){log.push(['render',s.world.frame]);profiler?.renderer.mark('frame_decode_validate');if(throwDraw)throw Error('RENDER_FAILED');profiler?.renderer.outcome('completed');},
  metrics:()=>({}),};
 const context={profiler,profileFlight:null,profileLastSource:null,backend,renderer,snapshot:{world:{frame:0,entities:{}}},interpolator:createPresentationInterpolator(),presentationMemory:null,tickFlight:null,
  bridgeMs:0,renderMs:0,renderCount:0,frozen:false,manualInput:null,lastStats:null,hasWorldPointer:false,saved:'null',key:'k',orderedQueue:null,scheduler:null,audio:null,
  input:{consumeFrame:()=>({actions:[]})},renderUi:()=>log.push(['ui']),uiRenderer:{report:()=>({})},cursorHost:{update(){},report:()=>({})},canvas:{width:1,height:1},
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
