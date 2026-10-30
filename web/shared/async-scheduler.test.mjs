import test from 'node:test';
import assert from 'node:assert/strict';
import {createAsyncScheduler} from './async-scheduler.mjs';
import {createPlayerCompletionMetrics,DRAW_COMPLETED} from './player-completion.mjs';
import {createPresentationInterpolator} from './presentation-interpolation.mjs';
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
  render(at,start,flight,source,budget){draws++;seen.push(frameNumber);metrics.attempt();options.render?.();metrics.finish(DRAW_COMPLETED,DRAW_COMPLETED,DRAW_COMPLETED,frameNumber,time,source,at,start,flight,budget);},
  onRafEnd:(...args)=>metrics.rafEnd(...args),onPreparationStart:()=>metrics.epoch(),onPreparationEnd:(...args)=>metrics.preparationEnd(...args),
  onError:e=>errors.push(e),onWake:w=>wakes.push(w),...options.scheduler,
 });
 return {scheduler,frames,seen,errors,wakes,target,metrics,
  counts:()=>({ticks,draws,timers}),setTime:t=>time=t,getTime:()=>time,
  async frame(t){time=t;const due=[...frames.values()];frames.clear();for(const fn of due)fn(t);await flush();},
  async visibility(hidden,t){time=t;target.hidden=hidden;listener?.();await flush();},
 };
}

test('coherent update/accept/draw keeps original RAF metadata while actual variable completion times remain honest',async()=>{
 const h=fixture({tick:()=>{h.setTime(h.counts().ticks*10+(h.counts().ticks%2?4:9));},render:()=>h.setTime(h.getTime()+1)});h.scheduler.start();
 assert.equal(h.frames.size,1);assert.equal(h.counts().ticks,0);
 await h.frame(10);assert.deepEqual(h.seen,[1]);assert.equal(h.frames.size,1);
 await h.frame(20);assert.deepEqual(h.seen,[1,2]);
 await flush();assert.equal(h.counts().ticks,2,'completion schedules only a RAF, never a timer update');
 await h.frame(30);assert.deepEqual(h.seen,[1,2,3]);
 const r=h.metrics.snapshot({includeRafSamples:true});assert.equal(r.completed_draws,3);assert.equal(r.presented_frame_changes,3);assert.equal(r.simulation_frame,3);assert.equal(r.last_presented_snapshot_frame,3);assert.equal(r.completed_intervals.p99_ms,15,'actual completion jitter is preserved');
 assert.equal(r.successful_submission_raf_intervals.p99_ms,10);assert.equal(r.submit_sync_wall.max_ms,1);assert.equal(r.callback_sync_wall.max_ms,1);assert.equal(r.preparation_wall.max_ms,9);
 assert.deepEqual(r.raf_diagnostics.samples.map(row=>[row.raf_time_ms,row.start_ms,row.end_ms,row.callback_end_ms]),[[10,14,15,15],[20,29,30,30],[30,34,35,35]]);
 assert.equal(h.counts().timers,0);h.scheduler.stop();
});

test('a delayed worker has one originating RAF continuation and cannot overlap or draw a stale snapshot',async()=>{
 let resolve;const h=fixture({tick:()=>new Promise(r=>resolve=r)});h.scheduler.start();
 await h.frame(10);assert.deepEqual(h.counts(),{ticks:1,draws:0,timers:0});assert.equal(h.frames.size,0);assert.equal(h.scheduler.busy,true);
 await h.frame(20);await h.frame(30);assert.equal(h.counts().ticks,1);assert.equal(h.metrics.snapshot().completed_draws,0);
 resolve();await flush();assert.deepEqual(h.seen,[1]);assert.equal(h.frames.size,1);assert.equal(h.scheduler.busy,false);
 const pair=h.metrics.snapshot({includeRafSamples:true}).raf_diagnostics.samples[0];assert.equal(pair.raf_time_ms,10);assert.equal(pair.start_ms,30);assert.equal(pair.end_ms,30);assert.equal(pair.callback_end_ms,30);assert.equal(h.metrics.snapshot().preparation_wall.max_ms,20);assert.equal(h.metrics.snapshot().callback_sync_wall.max_ms,0);
 await h.frame(40);assert.equal(h.counts().ticks,2);assert.deepEqual(h.seen,[1]);
 resolve();await flush();assert.equal(h.counts().ticks,3,'catch-up remains sequential');assert.deepEqual(h.seen,[1]);
 resolve();await flush();resolve();await flush();assert.deepEqual(h.seen,[1,4]);assert.equal(h.metrics.snapshot().presented_frame_changes,2,'three catch-up ticks are one presentation');h.scheduler.stop();
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
 await h.frame(1110);assert.equal(h.counts().ticks,16,'fractional stall remainder is retained');assert.equal(h.seen.at(-1),16);h.scheduler.stop();
 const slow=fixture();slow.scheduler.start();
 for(let i=1;i<=30;i++)await slow.frame(i*20);
 assert.equal(slow.counts().ticks,60);assert.equal(slow.counts().draws,30);assert.equal(slow.metrics.snapshot().presented_frame_changes,30,'60 simulation steps at a slower refresh are only 30 changed presentations');slow.scheduler.stop();
});

test('pause and hidden intervals reset simulation time; an in-flight old generation cannot draw on return',async()=>{
 let resolve;const h=fixture({tick:()=>new Promise(r=>resolve=r)});h.scheduler.start();await h.frame(10);
 h.scheduler.pause();h.setTime(1000);resolve();await flush();assert.deepEqual(h.seen,[]);assert.equal(h.metrics.snapshot().raf_diagnostics.preparation_cancelled,1);assert.equal(h.metrics.snapshot().preparation_wall.retained,0);assert.equal(h.metrics.snapshot().successful_submission_raf_intervals.retained,0);
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

test('failed updates never claim a completed draw and actual draw errors stop scheduling once',async()=>{
 for(const phase of ['tick','render']){
  const failure=Error(phase),h=fixture({[phase](){throw failure;}});h.scheduler.start();await h.frame(10);
  assert.deepEqual(h.errors,[failure]);assert.equal(h.frames.size,0);assert.equal(h.scheduler.busy,false);assert.equal(h.wakes.length,1);assert.equal(h.wakes[0].source,'raf');
  assert.equal(h.metrics.snapshot().completed_draws,0);if(phase==='tick')assert.equal(h.counts().draws,0);
 }
});

test('stopping before a pending worker rejects ignores cancellation and never reports a completed draw',async()=>{
 let reject;const failure=Error('RUNTIME_CLOSED'),h=fixture({tick:()=>new Promise((_,r)=>reject=r)});
 h.scheduler.start();await h.frame(10);assert.equal(h.scheduler.busy,true);
 h.scheduler.stop();reject(failure);await flush();
 assert.deepEqual(h.errors,[]);assert.deepEqual(h.seen,[]);assert.equal(h.frames.size,0);assert.equal(h.scheduler.busy,false);
 assert.equal(h.metrics.snapshot().completed_draws,0);assert.equal(h.metrics.snapshot().raf_diagnostics.preparation_cancelled,1);
 assert.equal(h.wakes.length,1);assert.equal(h.wakes[0].error,null);assert.equal(h.wakes[0].steps,0);
});

test('an old rejection cannot stop a restarted generation, while the same current failure still reports once',async()=>{
 const pending=[],failure=Error('RUNTIME_CLOSED'),h=fixture({tick:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))});
 h.scheduler.start();await h.frame(10);h.scheduler.stop();h.setTime(1000);h.scheduler.start();
 await h.frame(1010);assert.equal(pending.length,1,'restart cannot overlap the old request');
 pending[0].reject(failure);await flush();assert.deepEqual(h.errors,[]);assert.deepEqual(h.seen,[]);assert.equal(h.scheduler.busy,false);assert.equal(h.frames.size,1);
 await h.frame(1020);assert.equal(pending.length,2);assert.equal(h.scheduler.busy,true);assert.equal(h.frames.size,0);
 pending[1].reject(failure);await flush();assert.deepEqual(h.errors,[failure]);assert.equal(h.frames.size,0);assert.equal(h.scheduler.busy,false);
 assert.deepEqual(h.seen,[]);assert.equal(h.metrics.snapshot().completed_draws,0);assert.equal(h.wakes[0].error,null);assert.equal(h.wakes[1].error,'RUNTIME_CLOSED');
});

for(const transition of ['pause','reset','hide-restore'])test(`a rejection from before ${transition} cannot stop the new clock or contaminate its RAF metadata`,async()=>{
 let reject;const h=fixture({tick:()=>new Promise((_,r)=>reject=r)});h.scheduler.start();await h.frame(10);
 if(transition==='pause'){h.scheduler.pause();h.setTime(1000);}
 else if(transition==='reset'){h.setTime(1000);h.scheduler.resetClock();}
 else{await h.visibility(true,20);await h.visibility(false,1000);}
 reject(Error('cancelled-old-transaction'));await flush();assert.deepEqual(h.errors,[]);assert.equal(h.frames.size,1);assert.equal(h.scheduler.busy,false);assert.deepEqual(h.seen,[]);
 assert.equal(h.metrics.snapshot().raf_diagnostics.preparation_cancelled,1);assert.equal(h.metrics.snapshot().preparation_wall.retained,0);
 await h.frame(1005);assert.deepEqual(h.seen,[0]);assert.equal(h.counts().ticks,1);
 const rows=h.metrics.snapshot({includeRafSamples:true}).raf_diagnostics.samples;assert.equal(rows.length,1);assert.equal(rows[0].raf_time_ms,1005);
 assert.equal(h.scheduler.totalDroppedSteps,0);h.scheduler.stop();
});

test('reset during a tick suppresses its catch-up tail and resumes only at a new RAF boundary',async()=>{
 let resolve;const h=fixture({tick:()=>new Promise(r=>resolve=r)});h.scheduler.start();await h.frame(30);h.scheduler.resetClock();
 resolve();await flush();assert.equal(h.counts().ticks,1);assert.deepEqual(h.seen,[]);assert.equal(h.frames.size,1);
 await h.frame(40);assert.equal(h.counts().ticks,2);resolve();await flush();assert.deepEqual(h.seen,[2]);h.scheduler.stop();
});

test('a worker response spanning hide and restore cannot draw in the old generation or catch up hidden time',async()=>{
 let resolve;const h=fixture({tick:()=>new Promise(r=>resolve=r)});h.scheduler.start();await h.frame(10);
 await h.visibility(true,20);await h.visibility(false,2000);assert.equal(h.frames.size,0,'a restored clock waits for the existing transaction');
 resolve();await flush();assert.deepEqual(h.seen,[]);assert.equal(h.frames.size,1);
 await h.frame(2010);assert.equal(h.counts().ticks,2);assert.equal(h.scheduler.totalDroppedSteps,0);resolve();await flush();assert.deepEqual(h.seen,[2]);h.scheduler.stop();
});

test('drawing consumes the newly accepted packed lease and interpolation remains presentation-only',async()=>{
 let frame=0,clock=0,live,current;const order=[],displayed=[];
 const interpolation=createPresentationInterpolator({enabled:true,instanceBatches:['rows'],now:()=>clock});
 const v=(x,y,z)=>({x,y,z});
 function accept(){
  live=new Float32Array([frame,0,0,0,0,0,1,1,1,1]);
  current={world:{frame,entities:{e:{transform3d:{position:v(frame,0,0),rotation:v(0,0,0),scale:v(1,1,1)}}},instances3d:{rows:{asset:'mesh://primitive/box',count:1,memory:{offset:0,byte_length:40,revision:String(frame+1)}}}}};
  interpolation.accept(current,()=>live.buffer);
 }
 accept();
 const h=fixture({render(){const canonical=JSON.stringify(current),sample=interpolation.sample(),values=new Float32Array(sample.memory(sample.snapshot.world.instances3d.rows));
   assert(Number.isFinite(values[0]));assert(values[0]>=0&&values[0]<=frame);assert.equal(JSON.stringify(current),canonical);displayed.push(sample.snapshot.world.frame);order.push('draw'+frame);},
  tick(){order.push('retire'+frame);live.fill(NaN);frame++;accept();}});
 h.scheduler.start();for(const at of [10,20,30]){clock=at;await h.frame(at);}
 assert.deepEqual(displayed,[1,2,3]);assert.deepEqual(order,['retire0','draw1','retire1','draw2','retire2','draw3']);assert.equal(current.world.frame,3);h.scheduler.stop();
});

test('stop/start during one in-flight tick waits for retirement without a second update chain or stale draw',async()=>{
 let resolve;const h=fixture({tick:()=>new Promise(r=>resolve=r)});h.scheduler.start();await h.frame(10);
 h.scheduler.stop();h.setTime(1000);h.scheduler.start();await h.frame(1010);assert.equal(h.counts().ticks,1);assert.deepEqual(h.seen,[]);
 resolve();await flush();assert.deepEqual(h.seen,[]);await h.frame(1020);assert.equal(h.counts().ticks,2);assert.deepEqual(h.seen,[]);
 resolve();await flush();resolve();await flush();assert.equal(h.counts().ticks,3);assert.deepEqual(h.seen,[3]);h.scheduler.stop();
});

test('ordinary fixed ticks consume clicks against the private projector of the previous visible view',async()=>{
 let privateCamera=0,visibleCamera=0,pending=null;const picks=[];
 const h=fixture({tick(){if(pending){const picked=pending.screenX+privateCamera;assert.equal(picked,pending.worldAtArrival,'input must precede the next private View-cache publication');picks.push(picked);pending=null;}privateCamera+=100;},render(){visibleCamera=privateCamera;}});
 h.scheduler.start();await h.frame(10);
 for(const at of [20,30,40]){pending={screenX:99.5,worldAtArrival:99.5+visibleCamera};await h.frame(at);}
 assert.deepEqual(picks,[199.5,299.5,399.5]);assert.equal(visibleCamera,privateCamera);h.scheduler.stop();
});
