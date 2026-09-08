import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeveloperAPI} from './api.js';
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
