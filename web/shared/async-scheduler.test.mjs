import test from 'node:test';
import assert from 'node:assert/strict';
import {createAsyncScheduler} from './async-scheduler.mjs';
import {createPlayerCompletionMetrics,DRAW_COMPLETED} from './player-completion.mjs';
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
function fixture(options={}){
 let time=0,id=0,listener,frameNumber=0,ticks=0,draws=0,timers=0;
 const frames=new Map(),seen=[],errors=[],wakes=[];
 const target={hidden:false,addEventListener(_,fn){listener=fn;},removeEventListener(){listener=null;}};
 const metrics=createPlayerCompletionMetrics({now:()=>time});
 metrics.accept({world:{frame:0,time_seconds:0}},true);
 const scheduler=createAsyncScheduler({
  stepMs:10,now:()=>time,raf:fn=>{frames.set(++id,fn);return id;},cancelRaf:n=>frames.delete(n),
  timer(){timers++;throw Error('independent simulation timer must not run');},visibilityTarget:target,
  tick:async()=>{ticks++;await options.tick?.(ticks);frameNumber++;metrics.accept({world:{frame:frameNumber,time_seconds:frameNumber/100}});},
  render(){draws++;seen.push(frameNumber);metrics.attempt();metrics.finish(DRAW_COMPLETED,DRAW_COMPLETED,DRAW_COMPLETED,frameNumber);options.render?.();},
  onError:e=>errors.push(e),onWake:w=>wakes.push(w),...options.scheduler,
 });
 return {scheduler,frames,seen,errors,wakes,target,metrics,
  counts:()=>({ticks,draws,timers}),setTime:t=>time=t,
  async frame(t){time=t;const due=[...frames.values()];frames.clear();for(const fn of due)fn(t);await flush();},
  async visibility(hidden,t){time=t;target.hidden=hidden;listener?.();await flush();},
 };
}

test('one RAF advances, accepts and draws in order; a finishing tick cannot publish twice between RAFs',async()=>{
 const h=fixture({tick:()=>{h.setTime(h.counts().ticks%2?14:29);}});h.scheduler.start();
 assert.equal(h.frames.size,1);assert.equal(h.counts().ticks,0);
 await h.frame(10);assert.deepEqual(h.seen,[1]);assert.equal(h.frames.size,1);
 await h.frame(20);assert.deepEqual(h.seen,[1,2]);
 await flush();assert.equal(h.counts().ticks,2,'completion schedules only a RAF, never a timer update');
 await h.frame(30);assert.deepEqual(h.seen,[1,2,3]);
 const r=h.metrics.snapshot();assert.equal(r.completed_draws,3);assert.equal(r.presented_frame_changes,3);assert.equal(r.simulation_frame,3);assert.equal(r.last_presented_snapshot_frame,3);
 assert.equal(h.counts().timers,0);h.scheduler.stop();
});

test('delayed worker ticks apply backpressure without overlap or claiming a stale snapshot as a new frame',async()=>{
 let resolve;const h=fixture({tick:()=>new Promise(r=>resolve=r)});h.scheduler.start();
 await h.frame(10);assert.deepEqual(h.counts(),{ticks:1,draws:0,timers:0});assert.equal(h.frames.size,0);assert.equal(h.scheduler.busy,true);
 await h.frame(20);await h.frame(30);assert.equal(h.counts().ticks,1);assert.equal(h.metrics.snapshot().completed_draws,0);
 resolve();await flush();assert.deepEqual(h.seen,[1]);assert.equal(h.frames.size,1);assert.equal(h.scheduler.busy,false);
 await h.frame(40);assert.equal(h.counts().ticks,2);assert.deepEqual(h.seen,[1]);
 resolve();await flush();assert.equal(h.counts().ticks,3,'catch-up remains sequential');assert.deepEqual(h.seen,[1]);
 resolve();await flush();resolve();await flush();assert.deepEqual(h.seen,[1,4]);
 assert.equal(h.metrics.snapshot().presented_frame_changes,2,'three catch-up ticks are one presentation');h.scheduler.stop();
});

test('RAF timestamp rounding does not alternate duplicate and skipped frames; early debt is retained',async()=>{
 const step=1000/60,h=fixture({scheduler:{stepMs:step}});h.scheduler.start();
 for(let i=1;i<=600;i++)await h.frame(Math.round(i*step*10)/10);
 assert.equal(h.counts().ticks,600);assert.equal(h.counts().draws,600);assert.equal(h.metrics.snapshot().presented_frame_changes,600);
 assert.deepEqual(h.seen,Array.from({length:600},(_,i)=>i+1));assert.equal(h.scheduler.totalDroppedSteps,0);h.scheduler.stop();
 const fast=fixture();fast.scheduler.start();
 for(let i=1;i<=100;i++)await fast.frame(i*9.99);
 assert.equal(fast.counts().ticks,99,'sub-step debt is not reset after an early tick');fast.scheduler.stop();
});

test('high-refresh RAFs redraw honestly while simulation stays fixed-step; long stalls have bounded catch-up',async()=>{
 const h=fixture();h.scheduler.start();
 for(let t=5;t<=100;t+=5)await h.frame(t);
 assert.equal(h.counts().ticks,10);assert.equal(h.counts().draws,20);assert.equal(h.metrics.snapshot().presented_frame_changes,11,'initial frame plus ten advanced frames');
 await h.frame(1103);assert.equal(h.counts().ticks,15);assert.equal(h.scheduler.totalDroppedSteps,95);assert.equal(h.seen.at(-1),15);
 await h.frame(1110);assert.equal(h.counts().ticks,16,'fractional stall remainder is retained');h.scheduler.stop();
 const slow=fixture();slow.scheduler.start();
 for(let i=1;i<=30;i++)await slow.frame(i*20);
 assert.equal(slow.counts().ticks,60);assert.equal(slow.counts().draws,30);assert.equal(slow.metrics.snapshot().presented_frame_changes,30,'60 simulation steps at a slower refresh are only 30 changed presentations');slow.scheduler.stop();
});

test('pause and hidden intervals reset simulation time; an in-flight old generation cannot draw on return',async()=>{
 let resolve;const h=fixture({tick:()=>new Promise(r=>resolve=r)});h.scheduler.start();await h.frame(10);
 h.scheduler.pause();h.setTime(1000);resolve();await flush();assert.deepEqual(h.seen,[]);
 await h.frame(1000);assert.deepEqual(h.seen,[1],'paused UI can redraw the accepted snapshot');assert.equal(h.counts().ticks,1);
 h.scheduler.resume();await h.visibility(true,1010);assert.equal(h.frames.size,0);await h.frame(2000);assert.equal(h.counts().ticks,1);
 await h.visibility(false,2000);await h.frame(2005);assert.equal(h.counts().ticks,1);
 await h.frame(2010);assert.equal(h.counts().ticks,2);assert.equal(h.scheduler.totalDroppedSteps,0);resolve();await flush();h.scheduler.stop();
});

test('stop cancels the next RAF and suppresses late work; restart attaches a fresh clock/listener',async()=>{
 let resolve;const h=fixture({tick:()=>new Promise(r=>resolve=r)});h.scheduler.start();await h.frame(10);
 h.scheduler.stop();resolve();await flush();assert.equal(h.frames.size,0);assert.deepEqual(h.seen,[]);
 h.setTime(1000);h.scheduler.start();await h.frame(1010);resolve();await flush();assert.deepEqual(h.seen,[2]);assert.equal(h.scheduler.totalDroppedSteps,0);
 h.scheduler.stop();assert.equal(h.frames.size,0);await h.visibility(false,3000);assert.equal(h.frames.size,0);
});

test('failed ticks do not draw, failed draws stop scheduling, and errors are reported once',async()=>{
 for(const phase of ['tick','render']){
  const failure=Error(phase),h=fixture({[phase](){throw failure;}});h.scheduler.start();await h.frame(10);
  assert.deepEqual(h.errors,[failure]);assert.equal(h.frames.size,0);assert.equal(h.scheduler.busy,false);assert.equal(h.wakes.length,1);assert.equal(h.wakes[0].source,'raf');
  if(phase==='tick')assert.equal(h.counts().draws,0);
 }
});

test('reset during a tick suppresses its catch-up tail and resumes only at a new RAF boundary',async()=>{
 let resolve;const h=fixture({tick:()=>new Promise(r=>resolve=r)});h.scheduler.start();await h.frame(30);h.scheduler.resetClock();
 resolve();await flush();assert.equal(h.counts().ticks,1);assert.deepEqual(h.seen,[]);assert.equal(h.frames.size,1);
 await h.frame(40);assert.equal(h.counts().ticks,2);resolve();await flush();assert.deepEqual(h.seen,[2]);h.scheduler.stop();
});

test('a worker response spanning hide and restore cannot draw in the old generation or catch up hidden time',async()=>{
 let resolve;const h=fixture({tick:()=>new Promise(r=>resolve=r)});h.scheduler.start();await h.frame(10);
 await h.visibility(true,20);await h.visibility(false,2000);assert.equal(h.frames.size,0,'new RAF waits for the existing worker transaction');
 resolve();await flush();assert.deepEqual(h.seen,[]);assert.equal(h.frames.size,1);
 await h.frame(2010);assert.equal(h.counts().ticks,2);assert.equal(h.scheduler.totalDroppedSteps,0);resolve();await flush();assert.deepEqual(h.seen,[2]);h.scheduler.stop();
});
