import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {adoptStartupRenderer,completeStartupPresentation,startupCancelled} from './startup-presentation.mjs';
import {assertRasterReady} from './raster-diagnostics.mjs';
import {createStartupPresentationState} from '../renderer/startup-presentation-state.js';
import {createRasterCapability} from '../renderer/projected-raster-capability.js';
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(){
 let lost=false,id=0,draws=0,validations=0,starts=0,made=0,disposed=0;
 const frames=new Map(),logs=[],metrics={},abort=new AbortController(),view={width:1280,height:720,dpr:1};
 let state;const cap=createRasterCapability({policy:{requested:'upper_left_checked'},profile:{version:'test',hash:'aa'},
  validate:()=>{validations++;return {samples:919,passed:919};},onState:()=>state?.changed()});cap.ensure(view);
 const available=()=>{if(lost){cap.lost();return false;}return cap.metrics().status!=='lost';};
 state=createStartupPresentationState({available,metrics:cap.metrics,view:()=>view});
 const raster=()=>({projected:{...cap.metrics(),completed_game_draw:state.metrics()}});
 const renderer={startupPresentation:state,metrics:()=>({raster:raster()}),ready:async()=>{},dispose:()=>disposed++};
 const raf=f=>{frames.set(++id,f);return id;};
 const context={renderer,metrics,startupAbort:abort,startupCancelled,assertRasterReady,renderCount:0,orderedRouter:null,publishPhysical(){},
  draw(){draws++;context.renderCount++;if(available()){cap.ensure(view);state.drawn();}},
  requestAnimationFrame:raf,completeStartupPresentation:opts=>completeStartupPresentation({...opts,nextFrame:raf,cancelFrame:n=>frames.delete(n)}),
  performance:{now:()=>0,getEntriesByType:()=>[]},window:{playerBoot:0,addEventListener(){}},URL,
  document:{body:{dataset:{}}},console:{info:s=>logs.push(s)},status:{textContent:'loading'},snapshot:{save_payload:{}},
  createAsyncScheduler(){made++;return {start:()=>starts++};},frozen:false,tickOnce:async()=>{},fail(){},
  uiScroll:{cancel(){}},uiRenderer:{releaseAll(){}},input:{releaseAll(){}},audio:null,physicalViewport:()=>[1280,720],backend:{request:async()=>{}}};
 let source=fs.readFileSync(process.env.UNONE_STARTUP_MAIN_SOURCE??new URL('../player/main.js',import.meta.url),'utf8');
 const begin=source.indexOf('async function finishStartup(');
 if(begin>=0)source=source.slice(begin,source.indexOf('async function start(){',begin));
 else source='async function finishStartup(presentation,kind){'+source.slice(source.indexOf(' draw();await renderer.ready();'),source.indexOf('\n}\nfunction pointer'))+'\n}';
 vm.createContext(context);vm.runInContext(source,context);
 const result={settled:false,error:null};const promise=context.finishStartup({projected_raster:'upper_left_checked'},'main').then(()=>result.settled=true,e=>{result.settled=true;result.error=e;});
 return {context,frames,logs,metrics,promise,result,abort,cap,counts:()=>({draws,validations,starts,made,disposed}),
  lose(){lost=true;},restore(){lost=false;cap.restored();},async frame(before=()=>{}){const fs=[...frames.values()];frames.clear();before();for(const f of fs)f();await flush();}};
}
test('actual production startup entry waits raw-loss event gap, redraws, then publishes exactly one READY and starts scheduler once',async()=>{
 const h=fixture();await flush();assert.equal(h.counts().draws,2);await h.frame(()=>h.lose());
 assert.equal(h.logs.filter(x=>x.startsWith('UNONE_PLAYER_READY')).length,0);assert.equal(h.counts().made,0);assert.equal(h.result.settled,false);
 h.restore();await flush();await h.frame();await h.frame();await h.promise;assert.equal(h.result.error,null);
 assert.deepEqual(h.counts(),{draws:3,validations:2,starts:1,made:1,disposed:0});
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
