import test from 'node:test';
import assert from 'node:assert/strict';
import {createPresentationWaitClock,createPresentationWaitHeartbeat} from './presentation-wait-clock.mjs';

test('only visible segments of an actual wait are counted, including hidden and host-pause transitions',()=>{
 let t=100;const c=createPresentationWaitClock({now:()=>t});
 const first=c.lease();assert.deepEqual(first.receipt,{epoch:1,visible_ms:0,uncertain_ms:0});c.commit(first.token);
 c.begin();t=300;c.setEligible(false);t=10300;c.setEligible(true);t=10650;c.end();
 const lease=c.lease();assert.deepEqual(lease.receipt,{epoch:1,visible_ms:550,uncertain_ms:0});c.commit(lease.token);assert.equal(c.lease(),null);
});
test('failed tick retries exactly the same receipt and newer waits are not acknowledged accidentally',()=>{
 let t=0;const c=createPresentationWaitClock({now:()=>t});let l=c.lease();c.commit(l.token);
 c.begin();t=10;c.end();l=c.lease();c.retry(l.token);assert.deepEqual(c.lease().receipt,{epoch:1,visible_ms:10,uncertain_ms:0});
 c.begin();t=30;c.end();c.commit(l.token);const next=c.lease();assert.deepEqual(next.receipt,{epoch:1,visible_ms:30,uncertain_ms:0});
 assert.throws(()=>c.commit(l.token),/STALE_COMMIT/);c.commit(next.token);
});
test('epoch reset rejects active/inflight, cannot regress, and yields a fresh zero receipt',()=>{
 let t=0;const c=createPresentationWaitClock({now:()=>t});const l=c.lease();assert.throws(()=>c.reset(2),/RESET_BUSY/);c.commit(l.token);
 c.begin();assert.throws(()=>c.reset(2),/RESET_BUSY/);t=10;c.end();assert.throws(()=>c.reset(1),/EPOCH_INVALID/);
 c.reset(2);assert.deepEqual(c.lease().receipt,{epoch:2,visible_ms:0,uncertain_ms:0});
});
test('unobserved sleep or freeze is uncertain, never deducted as proven visible wait',()=>{
 let t=0,w=1000;const c=createPresentationWaitClock({now:()=>t,wallNow:()=>w});const first=c.lease();c.commit(first.token);
 c.begin();t+=250;w+=250;c.checkpoint();t+=120000;w+=120000;c.checkpoint();t+=250;w+=250;c.end();
 assert.deepEqual(c.lease().receipt,{epoch:1,visible_ms:500,uncertain_ms:120000});
});
test('wall-clock sleep while the performance clock stops remains uncertain',()=>{
 let t=0,w=1000;const c=createPresentationWaitClock({now:()=>t,wallNow:()=>w});c.begin();w+=60000;c.end();
 assert.deepEqual(c.lease().receipt,{epoch:1,visible_ms:0,uncertain_ms:60000});
});
test('heartbeat runs during a paused scheduler or startup wait and stops cleanly',()=>{
 let t=0,id=0;const queue=new Map(),c=createPresentationWaitClock({now:()=>t});
 const h=createPresentationWaitHeartbeat({clock:c,schedule:(fn,ms)=>{assert.equal(ms,250);queue.set(++id,fn);return id;},cancel:key=>queue.delete(key)});
 c.begin();h.start();h.start();assert.equal(queue.size,1);
 for(let i=0;i<8;i++){const [key,fn]=queue.entries().next().value;queue.delete(key);t+=250;fn();assert.equal(queue.size,1);}
 h.stop();c.end();assert.equal(queue.size,0);assert.deepEqual(c.lease().receipt,{epoch:1,visible_ms:2000,uncertain_ms:0});
});
test('backward, non-finite and overflow clocks fail closed',()=>{
 let t=2;const c=createPresentationWaitClock({now:()=>t});c.begin();t=1;assert.throws(()=>c.end(),/CLOCK_INVALID/);
 let n=0;const o=createPresentationWaitClock({now:()=>n});o.begin();n=Number.MAX_SAFE_INTEGER;o.end();o.begin();n=Number.MAX_SAFE_INTEGER+2048;assert.throws(()=>o.end(),/OVERFLOW/);
 assert.throws(()=>createPresentationWaitClock({epoch:0}),/EPOCH_INVALID/);
});
