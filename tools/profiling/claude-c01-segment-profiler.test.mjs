import test from 'node:test';
import assert from 'node:assert/strict';
import {createSegmentProfiler,distribution,percentile} from './claude-c01-segment-profiler.mjs';
// Deterministic host wall clock for testing; production uses performance.now().
function clock(){let t=0;return {now:()=>t,advance:n=>{t+=n;}};}
test('disabled profiler is a pass-through and records nothing',()=>{
 let reads=0;const p=createSegmentProfiler({now:()=>{reads++;return 0;}});
 assert.equal(p.update('u',()=>p.segment('a',()=>7)),7);assert.equal(reads,0);assert.equal(p.records().length,0);
 assert.throws(()=>createSegmentProfiler({enabled:1}),/ENABLED_BOOLEAN/);
});
test('nested segments report inclusive and exclusive time without double counting',()=>{
 const c=clock(),p=createSegmentProfiler({enabled:true,now:c.now});
 p.update('u1',()=>{
  p.segment('decode',()=>{c.advance(2);p.segment('validate',()=>c.advance(3));c.advance(1);});
  p.segment('render',()=>c.advance(4));c.advance(5);
 });
 const [r]=p.records();
 assert.deepEqual(r.segments.decode,{inclusive_ms:6,exclusive_ms:3,calls:1});
 assert.deepEqual(r.segments.validate,{inclusive_ms:3,exclusive_ms:3,calls:1});
 assert.equal(r.wall_ms,15);assert.equal(r.unattributed_ms,5);
 const exclusive=Object.values(r.segments).reduce((n,s)=>n+s.exclusive_ms,0);
 assert.equal(exclusive+r.unattributed_ms,r.wall_ms,'exclusive partition sums to measured wall time');
});
test('overlapping, unclosed or nested updates fail explicitly',async()=>{
 const c=clock(),p=createSegmentProfiler({enabled:true,now:c.now});
 assert.throws(()=>p.segment('a',()=>0),/OUTSIDE_UPDATE/);
 assert.throws(()=>p.update('u',()=>p.update('v',()=>0)),/UPDATE_NESTED/);
 // b opens inside a (legal), but a finishes first while b is still open: true overlap.
 let ra;const pa=new Promise(r=>ra=r),pb=new Promise(()=>{});
 await assert.rejects(p.update('u2',async()=>{const a=p.segment('a',()=>pa);p.segment('b',()=>pb);ra();await a;}),/OVERLAP: a closed while b/);
 assert.equal(p.records().length,0,'failed update is not recorded');
 await assert.rejects(p.update('u3',async()=>{p.segment('dangling',()=>pb);}),/UNCLOSED: dangling/);
 assert.equal(p.update('u4',()=>p.segment('ok',()=>1)),1,'profiler usable after failures');
});
test('counter deltas snapshot numeric values at admission, even from one shared live stats object',()=>{
 // Root review1: a provider may return the same mutable object before and after the update.
 const c=clock(),shared={geometry_builds:0,label:'live'},p=createSegmentProfiler({enabled:true,now:c.now,counters:()=>shared});
 p.update('real-update',()=>{shared.geometry_builds+=3;});
 const [r]=p.records();assert.equal(r.counter_delta.geometry_builds,3);assert.equal(r.counters_after.geometry_builds,3);
 shared.geometry_builds=100;assert.equal(p.records()[0].counters_after.geometry_builds,3,'recorded values are not live views');
 assert.deepEqual(Object.keys(r.counters_after),['geometry_builds'],'only numeric counters are recorded');
});
test('async segments use host wall clock and percentiles are per independent update',async()=>{
 const c=clock(),p=createSegmentProfiler({enabled:true,now:c.now,counters:(()=>{let n=0;return ()=>({builds:n++});})()});
 for(let i=1;i<=100;i++)await p.update('u'+i,async()=>{await p.segment('transfer',async()=>{c.advance(i);});});
 const s=p.summary();assert.equal(s.updates,100);
 assert.deepEqual(s.segments.transfer.exclusive_ms,{count:100,p50:50,p95:95,p99:99,max:100});
 assert.equal(p.records()[0].counter_delta.builds,1);
 assert.equal(percentile([],50),null);assert.deepEqual(distribution([3,1,2]),{count:3,p50:2,p95:3,p99:3,max:3});
});
