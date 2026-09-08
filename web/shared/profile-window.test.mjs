import test from 'node:test';
import assert from 'node:assert/strict';
import {createProfileWindow} from './profile-window.js';
test('AI timeline correlates frame spans, bounds traces, freezes and resets',()=>{
 let clock=0;const p=createProfileWindow(2048,()=>clock);p.start();
 for(let frame=1;frame<=400;frame++){
  clock=frame*10;
  p.tick({frame,start_ms:clock,end_ms:clock+3,input_ms:0.5,wasm_tick_publish_ms:1,decode_ms:0.5,post_tick_ms:1});
  clock+=5;p.frame(2,{frame,start_ms:clock-2,paused:false});
  p.wake({source:'raf',scheduled_ms:clock-10,start_ms:clock-5,end_ms:clock,result:{steps:1},error:null});
 }
 p.stop();const r=p.read();assert.equal(r.timeline.wake_count,400);
 assert.equal(r.timeline.wakes.length,120);assert.equal(r.timeline.ticks.length,360);assert.equal(r.timeline.renders.length,120);
 assert.equal(r.timeline.ticks.at(-1).frame,400);assert.equal(r.cpu.post_tick_ms.mean_ms,1);
 assert.equal(r.timeline.renders.at(-1).end_ms,r.timeline.wakes.at(-1).end_ms);
 p.wake({});p.frame(99);p.tick({});assert.deepEqual(p.read(),r);
 p.start();assert.deepEqual(p.read().timeline.ticks,[]);assert.equal(p.read().timeline.wake_count,0);
});
test('windows reset, freeze and bound samples independently of total counts',()=>{
 const p=createProfileWindow(2);p.start();
 for(const n of [1,2,3])p.tick({input_ms:n,wasm_tick_publish_ms:n*10,decode_ms:n*2});
 p.stop();const r=p.read();assert.equal(r.tick_count,3);assert.equal(r.cpu.input_ms.samples,2);assert.equal(r.cpu.input_ms.mean_ms,2.5);
 p.tick({});assert.deepEqual(p.read(),r);p.start();assert.equal(p.read().tick_count,0);assert.equal(p.read().id,2);
});

test('render cadence measures scheduling gaps, freezes, resets and retains bounds',()=>{
 let clock=0;const p=createProfileWindow(2,()=>clock);p.start();
 for(const at of [0,10,40,50]){clock=at;p.frame(1);}
 const c=p.read().render_cadence;
 assert.equal(c.interval_count,3);assert.equal(c.intervals_over_60hz,1);
 assert.equal(c.interval_ms.samples,2);assert.equal(c.interval_ms.mean_ms,20);
 p.stop();clock=100;assert.deepEqual(p.read().render_cadence,c);
 p.start();p.frame(1);assert.equal(p.read().render_cadence.interval_count,0);
});

test('drop counters are window deltas and freeze; reset or unavailable counters are null',()=>{
 const p=createProfileWindow();p.start({dropped_steps:100});
 assert.equal(p.read({dropped_steps:103}).dropped_steps_delta,3);
 p.stop({dropped_steps:104});assert.equal(p.read({dropped_steps:999}).dropped_steps_delta,4);
 p.start({dropped_steps:100});assert.equal(p.read({dropped_steps:0}).dropped_steps_delta,null);
 p.start();assert.equal(p.read({dropped_steps:100}).dropped_steps_delta,null);
});
