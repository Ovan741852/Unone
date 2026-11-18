import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {createDeveloperAPI} from '../developer/api.js';
import {createRuntimeBackend} from './runtime-backend.mjs';
import {createPlayerProfiler} from './raster-diagnostics.mjs';

test('developer mutation is fenced during wait; opt-in step and manual input remain explicitly unavailable',async()=>{
 const source=fs.readFileSync(new URL('../player/main.js',import.meta.url),'utf8');
 const line=name=>{const match=source.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]+$`,'m'));assert(match,`missing ${name}`);return match[0];};
 const calls=[],snapshot={world:{frame:7,entities:{},observations:{}}};let waiting=true;
 const context={atomicWait:{isActive:()=>waiting},atomicFrame:{},profiler:null,tickFlight:null,manualInput:null,
  advance:async()=>{calls.push('tick');},backend:{request:async request=>{calls.push(request.kind==='developer'?request.request.method:request.kind);return {observation:snapshot,tools:[{id:'inspect'}]};}},acceptSnapshot(){}};
 vm.createContext(context);vm.runInContext(['assertPresentationReady','developerStep','tickOnce','coreRequest','queueDeveloperInput','setTransport','restart'].map(line).join('\n'),context);
 const host={getSnapshot:()=>snapshot,getPaused:()=>true,tick:context.developerStep,coreRequest:context.coreRequest,queueInput:context.queueDeveloperInput,acceptSnapshot(){},draw(){}};
 const api=createDeveloperAPI(host,{console:()=>[],network:()=>[],heap:()=>null});
 for(const request of [{method:'step'},{method:'tools.invoke',id:'probe',revision:1},{method:'input',frame:{actions:{W:true}}}]){
  const result=await api.request(request);assert.equal(result.ok,false);assert.equal(result.diagnostics[0].code,'PRESENTATION_WAIT_ACTIVE');
 }
 const inspectDuringWait=await api.request({method:'tools.list'});assert.equal(inspectDuringWait.ok,true);assert.equal(inspectDuringWait.value[0].id,'inspect');
 assert(!calls.includes('tick'));assert(!calls.includes('invoke'));assert.equal(context.manualInput,null);
 await assert.rejects(context.setTransport('memory'),error=>error.code==='PRESENTATION_WAIT_ACTIVE');
 await assert.rejects(context.restart(),error=>error.code==='PRESENTATION_WAIT_ACTIVE');assert(!calls.includes('transport'));
 waiting=false;const noStep=await api.request({method:'step'});assert.equal(noStep.ok,false);assert.equal(noStep.diagnostics[0].code,'PRESENTATION_STEP_UNSUPPORTED');assert(!calls.includes('tick'));
 const noInvoke=await api.request({method:'tools.invoke',id:'probe',revision:1});assert.equal(noInvoke.ok,false);assert.equal(noInvoke.diagnostics[0].code,'PRESENTATION_INVOKE_UNSUPPORTED');assert(!calls.includes('invoke'));
 const listed=await api.request({method:'tools.list'});assert.equal(listed.ok,true);assert.equal(listed.value[0].id,'inspect');
 const noInput=await api.request({method:'input',frame:{actions:{W:true}}});assert.equal(noInput.diagnostics[0].code,'PRESENTATION_INPUT_UNSUPPORTED');assert.equal(context.manualInput,null);
 context.atomicFrame=null;assert.equal((await api.request({method:'tools.invoke',id:'probe',revision:1})).ok,true);assert.equal((await api.request({method:'step'})).ok,true);
 assert.equal((await api.request({method:'input',frame:{actions:{W:true}}})).ok,true);assert(calls.includes('tick'));assert(calls.includes('invoke'));assert.equal(context.manualInput.actions.W,true);
});
test('queued worker invoke rechecks admission at actual dispatch, including profiling',async()=>{
 for(const profiled of [false,true]){
  let waiting=false,release;const sent=[];
  class Worker{postMessage({id,command}){sent.push(command.kind==='developer'?command.request.method:command.kind);
   const respond=()=>this.onmessage({data:{id,ok:true,packet:{value:{world:{frame:id}},updates:[],removed:[]}}});
   if(command.kind==='init')queueMicrotask(()=>this.onmessage({data:{id,ok:true,packet:{value:null,updates:[],removed:[]}}}));
   else if(command.kind==='viewport')release=respond;else queueMicrotask(respond);
  }terminate(){}}
  const backend=await createRuntimeBackend({kind:'worker',url:'http://unone.test/runtime.js',WorkerClass:Worker,...(profiled?{profiler:createPlayerProfiler({limit:64})}:{})});
  const viewport=backend.request({kind:'viewport',width:100,height:100});await Promise.resolve();
  const guard=()=>{if(waiting){const e=Error('waiting');e.code='PRESENTATION_WAIT_ACTIVE';throw e;}};
  const blocked=backend.request({kind:'developer',request:{method:'invoke'}},undefined,guard);waiting=true;release();await viewport;
  await assert.rejects(blocked,error=>error.code==='PRESENTATION_WAIT_ACTIVE');assert.deepEqual(sent,['init','viewport']);
  waiting=false;await backend.request({kind:'developer',request:{method:'invoke'}},undefined,guard);assert.deepEqual(sent,['init','viewport','invoke']);backend.close();
 }
});

test('restart restores its prior pause state without hiding a wait that begins during an in-flight tick',async()=>{
 const source=fs.readFileSync(new URL('../player/main.js',import.meta.url),'utf8');
 const lines=['assertPresentationReady','restart'].map(name=>{const m=source.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]+$`,'m'));assert(m);return m[0];}).join('\n');
 for(const wasPaused of [false,true]){
  let waiting=false,release,hidden=0,load=0;const pauses=[];
  const gate=new Promise(resolve=>release=resolve);
  const ctx={atomicWait:{isActive:()=>waiting,hide:()=>hidden++},frozen:wasPaused,errors:{reset(){}},
   setPaused:async value=>{pauses.push(value);if(pauses.length===1)await gate;},backend:{request:async()=>{load++;}}};
  vm.createContext(ctx);vm.runInContext(lines,ctx);const restarting=ctx.restart();await Promise.resolve();waiting=true;release();
  await assert.rejects(restarting,error=>error.code==='PRESENTATION_WAIT_ACTIVE');
  assert.deepEqual(pauses,[true,wasPaused]);assert.equal(hidden,0);assert.equal(load,0);assert.equal(waiting,true);
 }
});

test('restart without atomic wait preserves existing reload and prior pause behavior',async()=>{
 const source=fs.readFileSync(new URL('../player/main.js',import.meta.url),'utf8');
 const lines=['assertPresentationReady','restart'].map(name=>{const m=source.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]+$`,'m'));assert(m);return m[0];}).join('\n');
 for(const wasPaused of [false,true]){
  const calls=[];const snapshot={world:{}};const ctx={atomicWait:null,atomicClock:null,frozen:wasPaused,errors:{reset(){calls.push('reset')}},
   setPaused:async value=>{calls.push('pause:'+value)},withCatalog:x=>x,json:async()=>({config:{},scene:{}}),uiAssetManifest:{},fitStage(){},
   canvas:{clientWidth:1,clientHeight:1},physicalViewport:()=>({width:1,height:1}),saved:'null',errorPolicy:null,imageGroupHost:null,
   imageAssets:{prepareScene:async()=>({})},startupAbort:{signal:{aborted:false}},assertRequiredImagePreparation(){},imagePreloadPlan:{},
   backend:{request:async request=>{calls.push(request.kind);return snapshot}},sessionSeed:()=>1,dataAssets:async()=>({}),acceptSnapshot(){},resizeStageViewport:async()=>{},configurePhysical(){},
   orderedRouter:null,audio:null,scheduler:{resetClock(){}},draw(){calls.push('draw')},persistSave(){calls.push('save')}};
  vm.createContext(ctx);vm.runInContext(lines,ctx);await ctx.restart();assert.deepEqual(calls,['reset','pause:true','load','draw','save','pause:'+wasPaused]);
 }
});
