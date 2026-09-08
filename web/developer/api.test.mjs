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
