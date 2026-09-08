import test from 'node:test';
import assert from 'node:assert/strict';
import {createAsyncScheduler} from './async-scheduler.mjs';
test('async ticks never overlap; rendering continues; pause and hidden time do not catch up',async()=>{
 let time=0,pump,draw,resolve,ticks=0,renders=0,visible;
 const target={hidden:false,addEventListener(_,fn){visible=fn;},removeEventListener(){}};
 const scheduler=createAsyncScheduler({now:()=>time,timer:fn=>{pump=fn;return 1;},clearTimer(){},raf:fn=>{draw=fn;return 1;},cancelRaf(){},visibilityTarget:target,tick:()=>{ticks++;return new Promise(r=>resolve=r);},render:()=>renders++,stepMs:10});
 scheduler.start();time=10;pump();await Promise.resolve();assert.equal(ticks,1);
 time=20;pump();draw();assert.equal(ticks,1);assert.equal(renders,1);
 scheduler.pause();resolve();await new Promise(r=>setImmediate(r));time=1000;pump();assert.equal(ticks,1);
 scheduler.resume();target.hidden=true;visible();time=2000;pump();target.hidden=false;visible();pump();assert.equal(ticks,1);
 time=2010;pump();await Promise.resolve();assert.equal(ticks,2);resolve();scheduler.stop();
});
