import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeveloperAPI} from './api.js';
test('profile reads and controls use the lightweight ABI and validate sampling',()=>{
 const commands=[];let bytes=new Uint8Array(8192),length=0;
 const module={HEAPU8:bytes,_unone_web_alloc:()=>0,_unone_web_observation_ptr:()=>4096,_unone_web_observation_len:()=>length,
  _unone_web_developer_request(p,n){const command=JSON.parse(new TextDecoder().decode(bytes.slice(p,p+n)));commands.push(command);const data=new TextEncoder().encode(JSON.stringify({ok:true,value:{performance:{frames:1},window:{active:command.method==='profile_start'},publication:{publications:3,hash_work:{reused_bytes:16384}}}}));bytes.set(data,4096);length=data.length;return 0;}};
 const calls=[];const api=createDeveloperAPI({module,getSnapshot:()=>({world:{frame:1}}),getStats:()=>null,getPaused:()=>true,profileWindow:{start:()=>calls.push('start'),stop:()=>calls.push('stop'),read:()=>({})}},{});
 assert.equal(api.request({method:'profile.start',sampling:'yes'}).ok,false);assert.equal(commands.length,0);
 assert.equal(api.request({method:'profile.start',sampling:true}).ok,true);
 assert.equal(api.request({method:'profile'}).value.publication.hash_work.reused_bytes,16384);assert.equal(api.request({method:'profile.stop'}).ok,true);
 assert.deepEqual(commands,[{method:'profile_start',sampling:true},{method:'profile'},{method:'profile_stop'}]);assert.deepEqual(calls,['start','stop']);
});
test('observations reads cached game state without a WASM call or packed scene snapshot',()=>{
 const api=createDeveloperAPI({module:{},getSnapshot:()=>({world:{frame:9,observations:{alive:10000},entities:['excluded']}}),getStats:()=>({draw_calls:15}),getPaused:()=>true},{});
 const result=api.request({method:'observations'});
 assert.equal(result.ok,true);assert.deepEqual(result.value,{frame:9,observations:{alive:10000},renderer:{draw_calls:15},paused:true});
 assert.equal(api.request({method:'observations',typo:true}).ok,false);
});
function setup(){let paused=false,ticks=0,queued=null;const host={module:{},getSnapshot:()=>({world:{frame:ticks}}),getPaused:()=>paused,setPaused:value=>{paused=value;},releaseInput(){},tick(){ticks++;},draw(){},queueInput:value=>{queued=value;}};return {api:createDeveloperAPI(host,{}),ticks:()=>ticks,queued:()=>queued};}
test('step requires pause, validates bounds, and executes the exact requested count',()=>{
 const {api,ticks}=setup();assert.equal(api.request({method:'step'}).ok,false);assert.equal(ticks(),0);
 assert.equal(api.request({method:'pause',paused:true}).ok,true);
 assert.equal(api.request({method:'step',count:121}).ok,false);assert.equal(ticks(),0);
 assert.equal(api.request({method:'step',count:3}).ok,true);assert.equal(ticks(),3);
});
test('unknown method/typo fails and injected input does not silently tick',()=>{
 const {api,ticks,queued}=setup();assert.equal(api.request({method:'pause',paused:true,typo:1}).ok,false);
 assert.equal(api.request({method:'eval',source:'anything'}).ok,false);
 assert.equal(api.request({method:'input',frame:{actions:{Fire:true}}}).ok,true);assert.equal(ticks(),0);assert.equal(queued().actions.Fire,true);
 assert.equal(api.request({method:'journal'}).value.events.length,3);
});
test('screenshot validates dimensions before readback and never ticks',()=>{
 let captures=0,ticks=0;
 const api=createDeveloperAPI({getSnapshot:()=>({world:{frame:7}}),capture:options=>{captures++;return {frame:7,...options};},tick:()=>ticks++},{});
 assert.equal(api.request({method:'screenshot',max_width:9000}).ok,false);
 assert.equal(api.request({method:'screenshot',width:640}).ok,false);
 assert.equal(captures,0);
 const result=api.request({method:'screenshot',max_width:640});
 assert.equal(result.ok,true);assert.equal(result.value.max_height,720);
 assert.equal(result.value.frame,7);assert.equal(captures,1);assert.equal(ticks,0);assert.deepEqual(result.effects,[]);
});
