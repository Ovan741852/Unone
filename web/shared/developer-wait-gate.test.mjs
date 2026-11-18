import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {createDeveloperAPI} from '../developer/api.js';

test('developer step, invoke and queued input cannot advance a covered game, then recover normally',async()=>{
 const source=fs.readFileSync(new URL('../player/main.js',import.meta.url),'utf8');
 const line=name=>{const match=source.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]+$`,'m'));assert(match,`missing ${name}`);return match[0];};
 const calls=[],snapshot={world:{frame:7,entities:{},observations:{}}};let waiting=true;
 const context={atomicWait:{isActive:()=>waiting},profiler:null,tickFlight:null,manualInput:null,
  advance:async()=>{calls.push('tick');},backend:{request:async request=>{calls.push(request.kind==='developer'?request.request.method:request.kind);return {observation:snapshot};}},acceptSnapshot(){}};
 vm.createContext(context);vm.runInContext(['assertPresentationReady','tickOnce','coreRequest','queueDeveloperInput','setTransport','restart'].map(line).join('\n'),context);
 const host={getSnapshot:()=>snapshot,getPaused:()=>true,tick:context.tickOnce,coreRequest:context.coreRequest,queueInput:context.queueDeveloperInput,acceptSnapshot(){},draw(){}};
 const api=createDeveloperAPI(host,{console:()=>[],network:()=>[],heap:()=>null});
 for(const request of [{method:'step'},{method:'tools.invoke',id:'probe',revision:1},{method:'input',frame:{actions:{W:true}}}]){
  const result=await api.request(request);assert.equal(result.ok,false);assert.equal(result.diagnostics[0].code,'PRESENTATION_WAIT_ACTIVE');
 }
 assert(!calls.includes('tick'));assert(!calls.includes('invoke'));assert.equal(context.manualInput,null);
 await assert.rejects(context.setTransport('memory'),error=>error.code==='PRESENTATION_WAIT_ACTIVE');
 await assert.rejects(context.restart(),error=>error.code==='PRESENTATION_WAIT_ACTIVE');assert(!calls.includes('transport'));
 waiting=false;assert.equal((await api.request({method:'step'})).ok,true);assert.equal((await api.request({method:'tools.invoke',id:'probe',revision:1})).ok,true);
 assert.equal((await api.request({method:'input',frame:{actions:{W:true}}})).ok,true);assert(calls.includes('tick'));assert(calls.includes('invoke'));assert.equal(context.manualInput.actions.W,true);
});
