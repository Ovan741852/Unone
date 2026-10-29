import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {adoptStartupRenderer,completeStartupPresentation,startupCancelled} from './startup-presentation.mjs';
import {assertRasterReady} from './raster-diagnostics.mjs';
import {createStartupPresentationState} from '../renderer/startup-presentation-state.js';
import {createRasterCapability} from '../renderer/projected-raster-capability.js';
import {createPlayerCompletionMetrics,DRAW_COMPLETED,DRAW_SKIPPED} from './player-completion.mjs';
import {createCanvasUi} from './canvas-ui.mjs';
import {serializedSavePayload,createSavePublication,attachSavePublication} from './save-publication.mjs';
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture({checked=true,uiRenderer,uiSnapshot,worldOutcome=DRAW_COMPLETED,cursorOutcome=()=>DRAW_COMPLETED,cursorReady=async()=>{},restoredSave='{}',savePayload={},storageError=null}={}){
 let lost=false,id=0,draws=0,validations=0,starts=0,made=0,disposed=0;
 const frames=new Map(),logs=[],writes=[],metrics={},abort=new AbortController(),view={width:1280,height:720,dpr:1};
 let state;const cap=createRasterCapability({policy:{requested:'upper_left_checked'},profile:{version:'test',hash:'aa'},
  validate:()=>{validations++;return {samples:919,passed:919};},onState:()=>state?.changed()});cap.ensure(view);
 const available=()=>{if(lost){cap.lost();return false;}return cap.metrics().status!=='lost';};
 state=createStartupPresentationState({available,metrics:cap.metrics,view:()=>view});
 const raster=()=>({projected:{...cap.metrics(),completed_game_draw:state.metrics()}});
 const renderer={startupPresentation:state,isPresentationAvailable:available,metrics:()=>({raster:raster()}),ready:async()=>{},dispose:()=>disposed++};
 const raf=f=>{frames.set(++id,f);return id;};
 const playerCompletion=createPlayerCompletionMetrics({now:()=>0}),ui=uiRenderer??{draw:()=>DRAW_COMPLETED,ready:async()=>{},releaseAll(){}},events=new Map();
 const canvas={addEventListener(name,fn){const list=events.get(name)??new Set();list.add(fn);events.set(name,list);},removeEventListener(name,fn){events.get(name)?.delete(fn);}};
 const context={renderer,canvas,playerCompletion,metrics,serializedSavePayload,startupAbort:abort,startupCancelled,assertRasterReady,renderCount:0,orderedRouter:null,publishPhysical(){},
  draw(){draws++;context.renderCount++;const world=available()?worldOutcome:DRAW_SKIPPED.raster_unavailable;if(available()){cap.ensure(view);state.drawn();}playerCompletion.attempt();return playerCompletion.finish(world,ui.draw(context.snapshot,{width:100,height:100,dpr:1}),cursorOutcome(),0,0);},
  requestAnimationFrame:raf,completeStartupPresentation:opts=>completeStartupPresentation({...opts,nextFrame:raf,cancelFrame:n=>frames.delete(n)}),
  performance:{now:()=>0,getEntriesByType:()=>[]},window:{playerBoot:0,addEventListener(){}},URL,
  document:{body:{dataset:{}}},console:{info:s=>logs.push(s)},status:{textContent:'loading'},snapshot:{world:{frame:0,...(uiSnapshot?{ui:uiSnapshot}:{})},save_payload:savePayload},
  saved:restoredSave,key:'startup-save',localStorage:{setItem(key,text){if(storageError)throw storageError;writes.push({key,text,ready:logs.some(s=>s.startsWith('UNONE_PLAYER_READY'))});}},
  createAsyncScheduler(){made++;return {start:()=>starts++};},frozen:false,tickOnce:async()=>{},fail(){},
  uiScroll:{cancel(){}},uiRenderer:ui,cursorHost:{ready:cursorReady},input:{releaseAll(){}},audio:null,physicalViewport:()=>[1280,720],backend:{request:async()=>{}}};
 let source=fs.readFileSync(process.env.UNONE_STARTUP_MAIN_SOURCE??new URL('../player/main.js',import.meta.url),'utf8');
 const persistSource=source.slice(source.indexOf('function persistSave('),source.indexOf('function draw(){'));
 const begin=source.indexOf('async function finishStartup(');
 if(begin>=0)source=source.slice(begin,source.indexOf('async function start(){',begin));
 else source='async function finishStartup(presentation,kind){'+source.slice(source.indexOf(' draw();await renderer.ready();'),source.indexOf('\n}\nfunction pointer'))+'\n}';
 vm.createContext(context);vm.runInContext(persistSource+source,context);
 const result={settled:false,error:null};const promise=context.finishStartup(checked?{projected_raster:'upper_left_checked'}:{},'main').then(()=>result.settled=true,e=>{result.settled=true;result.error=e;});
 return {context,frames,logs,writes,metrics,promise,result,abort,cap,counts:()=>({draws,validations,starts,made,disposed}),
  lose(){lost=true;for(const fn of events.get('webglcontextlost')??[])fn();},restore(){lost=false;cap.restored();for(const fn of events.get('webglcontextrestored')??[])fn();},async frame(before=()=>{}){const fs=[...frames.values()];frames.clear();before();for(const f of fs)f();await flush();}};
}
test('actual production startup entry waits raw-loss event gap, redraws, then publishes exactly one READY and starts scheduler once',async()=>{
 const h=fixture();await flush();assert.equal(h.counts().draws,2);await h.frame(()=>h.lose());
 assert.equal(h.logs.filter(x=>x.startsWith('UNONE_PLAYER_READY')).length,0);assert.equal(h.counts().made,0);assert.equal(h.result.settled,false);
 h.restore();await flush();await h.frame();await h.frame();await h.promise;assert.equal(h.result.error,null);
 assert.deepEqual(h.counts(),{draws:4,validations:2,starts:1,made:1,disposed:0});
 assert.equal(h.metrics.raster.projected.completed_game_draw.context_epoch,2);assert.equal(h.metrics.startup_presentation.phase,'ready');
 assert.equal(h.logs.filter(x=>x.startsWith('UNONE_PLAYER_READY')).length,1);
});
test('actual production startup entry pagehide cancellation prevents late READY and scheduler creation',async()=>{
 const h=fixture();await flush();h.abort.abort();await flush();assert.equal(h.result.settled,true);await h.promise;
 assert.equal(h.result.error.name,'AbortError');assert.equal(h.counts().made,0);assert.equal(h.frames.size,0);assert.equal(h.logs.length,0);
});
test('actual production factory assignment disposes a late resolved renderer after pagehide',async()=>{
 const source=fs.readFileSync(process.env.UNONE_STARTUP_MAIN_SOURCE??new URL('../player/main.js',import.meta.url),'utf8');
 const assignment=source.split('\n').find(line=>line.trimStart().startsWith('renderer=await '));let release,disposed=0;
 const context={adoptStartupRenderer,createPlayerRenderer:()=>new Promise(r=>release=r),canvas:{},presentation:{},createThreeRenderer(){},
  startupAbort:new AbortController(),disposeRenderer:()=>disposed++,profiler:null};vm.createContext(context);
 vm.runInContext('async function construct(){'+assignment+'}',context);const promise=context.construct();
 context.startupAbort.abort();release({});await assert.rejects(promise,{name:'AbortError'});assert.equal(disposed,1);assert.equal(context.renderer,undefined);
});
test('actual READY commit resamples/cancels after metrics callbacks, without a later await gap',async()=>{
 const h=fixture();await flush();const original=h.context.renderer.metrics;let committing=0;
 h.context.renderer.metrics=()=>{if(h.metrics.startup_presentation?.phase==='committing'&&++committing===2)h.abort.abort();return original();};
 await h.frame();await h.promise;assert.equal(h.result.error?.name,'AbortError');assert.equal(h.counts().made,0);assert.equal(h.logs.length,0);
});
test('actual ordinary and checked startup wait for delayed Canvas-only images without polling RAF or starting simulation',async()=>{
 for(const checked of [false,true]){
  let resolve;const pending=new Promise(yes=>resolve=yes),paint=[];
  const context={setTransform(){},clearRect(){},save(){},restore(){},beginPath(){},rect(){},clip(){},drawImage(){paint.push('image');}};
  const ui=createCanvasUi({width:100,height:100,getContext:()=>context},{resolveAsset:()=>pending});
  const h=fixture({checked,uiRenderer:ui,uiSnapshot:{children:[{kind:'image',id:'only',asset:'texture://only',rect:{x:0,y:0,width:100,height:100}}]}});
  await flush();assert.equal(h.result.settled,false);assert.equal(h.counts().draws,1);assert.equal(h.frames.size,0,'asset wait schedules no polling RAF');
  assert.equal(h.context.playerCompletion.snapshot().completed_draws,0);assert.equal(h.logs.length,0);assert.equal(h.counts().made,0,'no scheduler or simulation before READY');
  resolve({width:16,height:16});await flush();assert.equal(h.counts().draws,2);assert.equal(paint.length,1);assert.equal(h.logs.length,0);
  await h.frame();await h.promise;assert.equal(h.result.error,null);assert.equal(h.logs.filter(x=>x.startsWith('UNONE_PLAYER_READY')).length,1);assert.equal(h.counts().starts,1);assert.equal(h.context.playerCompletion.snapshot().completed_draws,2);ui.dispose();
 }
});
test('startup never treats an unknown renderer outcome as a completed presentation',async()=>{
 const h=fixture({checked:false,worldOutcome:{status:'unknown'}});await flush();await h.promise;
 assert.match(h.result.error?.message??'',/PLAYER_COMPLETION_CONTRACT_MISSING/);assert.equal(h.logs.length,0);assert.equal(h.counts().made,0);assert.equal(h.frames.size,0);
});
test('pointer entry at the final RAF barrier cannot READY a newly required pending cursor',async()=>{
 let visible=false,loaded=false,resolve;const pending=new Promise(yes=>resolve=yes);
 const h=fixture({checked:false,cursorOutcome:()=>visible&&!loaded?DRAW_SKIPPED.cursor_assets_pending:DRAW_COMPLETED,cursorReady:()=>visible&&!loaded?pending:Promise.resolve()});
 await flush();assert.equal(h.context.playerCompletion.snapshot().completed_draws,2);
 await h.frame(()=>visible=true);assert.equal(h.logs.length,0);assert.equal(h.counts().made,0);assert.equal(h.context.playerCompletion.outcome(),DRAW_SKIPPED.cursor_assets_pending);
 await h.frame();assert.equal(h.frames.size,0,'newly required assets wait without polling');assert.equal(h.result.settled,false);
 loaded=true;resolve();await flush();for(let i=0;i<4&&!h.result.settled;i++)await h.frame();await h.promise;
 assert.equal(h.result.error,null);assert.equal(h.logs.filter(x=>x.startsWith('UNONE_PLAYER_READY')).length,1);assert.equal(h.counts().starts,1);
});

test('Game.start save changes are persisted exactly once before READY, including private encoded publications',async()=>{
 for(const checked of [false,true]){
  const entry=createSavePublication('{"large":"'+'x'.repeat(112*1024)+'","coins":2}');
  const h=fixture({checked,restoredSave:'{"coins":1}',savePayload:entry.value});attachSavePublication(h.context.snapshot,entry);
  await flush();assert.equal(h.writes.length,0);assert.equal(h.logs.length,0);
  await h.frame();await h.promise;assert.equal(h.result.error,null);
  assert.deepEqual(h.writes,[{key:'startup-save',text:entry.text,ready:false}]);assert.equal(h.context.saved,entry.text);assert.equal(h.counts().starts,1);
  const stringify=JSON.stringify;let saveEncodes=0;
  try{JSON.stringify=(value,...args)=>{if(value===entry.value)saveEncodes++;return stringify(value,...args);};for(let i=0;i<120;i++)h.context.persistSave();}
  finally{JSON.stringify=stringify;}
  assert.equal(saveEncodes,0,'unchanged granted publications never stringify their payload');assert.equal(h.writes.length,1,'unchanged granted publications never rewrite storage');
  for(const text of ['{"coins":9}','null']){
   const next=createSavePublication(text);h.context.snapshot=attachSavePublication({...h.context.snapshot,save_payload:next.value},next);h.context.persistSave();h.context.persistSave();
   assert.equal(h.writes.at(-1).text,text);assert.equal(h.context.saved,text);
  }
  assert.equal(h.writes.length,3,'changed and cleared payloads each write exactly once');
 }
});

test('a startup storage failure preserves the persisted marker and prevents READY/scheduler creation',async()=>{
 for(const checked of [false,true]){
  const error=Error('storage quota denied'),h=fixture({checked,restoredSave:'{"coins":1}',savePayload:{coins:2},storageError:error});
  await flush();await h.frame();await h.promise;
  assert.equal(h.result.error,error);assert.equal(h.context.saved,'{"coins":1}');assert.equal(h.writes.length,0);
  assert.equal(h.logs.length,0);assert.equal(h.counts().made,0);assert.equal(h.counts().starts,0);assert.equal(h.context.status.textContent,'loading');
 }
});

test('restarting while paused persists new Game.start contents without waiting for a tick',async()=>{
 const source=fs.readFileSync(new URL('../player/main.js',import.meta.url),'utf8'),writes=[];
 const context={serializedSavePayload,saved:'{"coins":1}',key:'restart-save',frozen:true,snapshot:{world:{frame:0},save_payload:{coins:1}},
  localStorage:{setItem:(key,text)=>writes.push({key,text})},canvas:{clientWidth:100,clientHeight:100},physicalViewport:()=>[100,100],json:async()=>({config:{}}),
  setPaused:async value=>{context.frozen=value;},backend:{request:async command=>{assert.equal(command.kind,'load');assert.equal(command.payload.restored_save.coins,1);return{world:{frame:0},save_payload:{coins:2}};}},
  acceptSnapshot:value=>context.snapshot=value,configurePhysical(){},orderedRouter:null,audio:null,scheduler:{resetClock(){}},draw(){}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function persistSave('),source.indexOf('function draw(){'))+source.slice(source.indexOf('async function restart(){'),source.indexOf('async function finishStartup(')),context);
 await context.restart();assert.deepEqual(writes,[{key:'restart-save',text:'{"coins":2}'}]);assert.equal(context.saved,'{"coins":2}');assert.equal(context.frozen,true);
});
