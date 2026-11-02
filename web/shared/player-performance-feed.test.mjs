import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayerPerformanceFeed,PLAYER_PERFORMANCE_FEED_MAX_BYTES} from './player-performance-feed.mjs';
import {createPlayerCompletionMetrics,DRAW_COMPLETED as done,DRAW_SKIPPED} from './player-completion.mjs';

function fixture({search='?unone_performance_feed=1',read,now,target}={}){
 let time=0,reads=0,clocks=0;
 const metrics=createPlayerCompletionMetrics({now:()=>time,timeOrigin:12345}),body=target??{dataset:{}};
 const feed=createPlayerPerformanceFeed({search,target:body,read:read??(()=>{reads++;return metrics.snapshot({windowMs:1500,includeRafSamples:true,backend:'worker'});}),now:now??(()=>{clocks++;return time;})});
 return {feed,metrics,body,setTime:value=>{time=value;},reads:()=>reads,clocks:()=>clocks,report:()=>JSON.parse(body.dataset.playerCompletion)};
}

test('only an unambiguous exact opt-in enables the feed; off touches no target, read or clock',()=>{
 for(const search of ['', '?x=1','?unone_performance_feed=0','?unone_performance_feed=true','?unone_performance_feed=01','?unone_performance_feed=1x','?unone_performance_feed=1+','?unone_performance_feed=1&unone_performance_feed=1','?unone_performance_feed=0&unone_performance_feed=1',null]){
  const options={search};for(const key of ['target','read','now'])Object.defineProperty(options,key,{get(){throw Error('off accessed '+key);}});
  assert.equal(createPlayerPerformanceFeed(options),null);
 }
 const f=fixture({search:'?other=1&unone_performance_feed=%31'});assert(f.feed);assert.equal(f.reads(),0);assert.equal(f.clocks(),0);assert.deepEqual(f.body.dataset,{});assert(Object.isFrozen(f.feed));assert.deepEqual(Object.keys(f.feed),['publish','dispose']);
});

test('caller-driven publication throttles at exactly500ms with one snapshot read and one serialization',()=>{
 const f=fixture(),stringify=JSON.stringify;let encodes=0;
 JSON.stringify=(...args)=>{encodes++;return stringify(...args);};
 try{
  assert.equal(f.feed.publish(),true);assert.equal(f.reads(),1);assert.equal(encodes,1);assert.equal(f.report().sequence,1);
  for(const time of [0,1,200,499]){f.setTime(time);assert.equal(f.feed.publish(),false);}assert.equal(f.reads(),1);assert.equal(encodes,1);
  f.setTime(500);assert.equal(f.feed.publish(),true);assert.equal(f.reads(),2);assert.equal(encodes,2);assert.equal(f.report().sequence,2);
  f.setTime(999);assert.equal(f.feed.publish(),false);f.setTime(1000);assert.equal(f.feed.publish(),true);assert.equal(f.reads(),3);assert.equal(encodes,3);
 }finally{JSON.stringify=stringify;f.feed.dispose();}
});

test('actual completion rows preserve exact RAF/submission/callback joins and all outcomes without changing counters',()=>{
 const f=fixture(),m=f.metrics;m.accept({world:{frame:0,time_seconds:0}},true);
 for(let i=1;i<=4;i++){const at=i*16;f.setTime(at+3);m.accept({world:{frame:i,time_seconds:i/60}});m.finish(done,done,done,i,at+2,'scheduler_raf',at,at+1,false);m.rafEnd(at,at+1,at+3,false);}
 m.finish(done,DRAW_SKIPPED.ui_assets_pending,done,4,82,'scheduler_raf',80,81);m.rafEnd(80,81,83);
 m.error('scheduler_raf',96,97,false,98,4);m.rafEnd(96,97,99);m.rafEnd(112,113,115);
 f.setTime(116);const before=m.snapshot({windowMs:1500,includeRafSamples:true});assert.equal(f.feed.publish(),true);
 const report=f.report(),after=m.snapshot({windowMs:1500,includeRafSamples:true});assert.equal(report.version,1);assert.equal(report.interval_ms,500);assert.equal(report.window_ms,1500);assert.equal(report.completion.backend,'worker');
 assert.deepEqual(report.completion.raf_diagnostics.samples,before.raf_diagnostics.samples);assert.deepEqual(after,before);
 assert.deepEqual(report.completion.raf_diagnostics.samples.map(row=>row.outcome),['completed','completed','completed','completed','skipped','error','no_submission']);
 assert.deepEqual(report.completion.raf_diagnostics.samples[0],{source:'scheduler_raf',raf_time_ms:16,start_ms:17,end_ms:18,callback_end_ms:19,snapshot_frame:1,outcome:'completed',new_snapshot:true,regression:false,in_flight:false});
 assert.equal(report.completion.raf_diagnostics.samples.at(-1).end_ms,null);assert.equal(report.completion.raf_diagnostics.samples.at(-1).callback_end_ms,115);f.feed.dispose();
});

test('the real512-row primitive ring is retained within the feed byte bound without truncation',()=>{
 const f=fixture(),m=f.metrics;m.accept({world:{frame:0}},true);
 for(let i=1;i<=700;i++){const at=i*2;f.setTime(at+1);m.finish(done,done,done,i,at+0.5,'scheduler_raf',at,at+0.25);m.rafEnd(at,at+0.25,at+1);}
 assert.equal(f.feed.publish(),true);const report=f.report(),rows=report.completion.raf_diagnostics.samples;
 assert.equal(rows.length,512);assert.equal(report.completion.raf_diagnostics.recorded_total,700);assert.equal(rows[0].snapshot_frame,189);assert.equal(rows.at(-1).snapshot_frame,700);assert(Buffer.byteLength(f.body.dataset.playerCompletion,'utf8')<=PLAYER_PERFORMANCE_FEED_MAX_BYTES);f.feed.dispose();
});

test('publication cost is complete only in the NEXT envelope and never requires a second serialization',()=>{
 let time=0,readCost=2,value='',encodes=0;
 const m=createPlayerCompletionMetrics({now:()=>0}),target={dataset:{}};Object.defineProperty(target.dataset,'playerCompletion',{configurable:true,get:()=>value,set(text){time+=5;value=text;}});
 const stringify=JSON.stringify;JSON.stringify=(...args)=>{time+=3;encodes++;return stringify(...args);};
 const feed=createPlayerPerformanceFeed({search:'?unone_performance_feed=1',target,now:()=>time,read:()=>{time+=readCost;return m.snapshot({windowMs:1500,includeRafSamples:true});}});
 try{
  feed.publish();const first=JSON.parse(value);assert.equal(first.queried_at_ms,0);assert.equal(first.published_at_ms,2);assert.equal(first.previous_completed_publication_ms,null);assert.equal(first.max_completed_publication_ms,null);assert.equal(encodes,1);
  time=500;readCost=9;feed.publish();const second=JSON.parse(value);assert.equal(second.previous_completed_publication_ms,10);assert.equal(second.max_completed_publication_ms,10);assert.equal(encodes,2);
  time=1000;readCost=1;feed.publish();const third=JSON.parse(value);assert.equal(third.previous_completed_publication_ms,17);assert.equal(third.max_completed_publication_ms,17);assert.equal(encodes,3);
 }finally{JSON.stringify=stringify;feed.dispose();}
});

test('UTF8 accounting admits the exact byte boundary and rejects multibyte overflow without an encoder buffer',()=>{
 const m=createPlayerCompletionMetrics({now:()=>0}),base=m.snapshot({windowMs:1500,includeRafSamples:true}),make=padding=>fixture({read:()=>({...base,padding})});
 const small=make('');small.feed.publish();const overhead=Buffer.byteLength(small.body.dataset.playerCompletion,'utf8');small.feed.dispose();
 const encoder=globalThis.TextEncoder;globalThis.TextEncoder=class{constructor(){throw Error('must not allocate encoder');}};
 try{
  const exact=make('x'.repeat(PLAYER_PERFORMANCE_FEED_MAX_BYTES-overhead));assert.equal(exact.feed.publish(),true);assert.equal(Buffer.byteLength(exact.body.dataset.playerCompletion,'utf8'),PLAYER_PERFORMANCE_FEED_MAX_BYTES);exact.feed.dispose();
  const over=make('x'.repeat(PLAYER_PERFORMANCE_FEED_MAX_BYTES-overhead+1));assert.throws(()=>over.feed.publish(),/PLAYER_PERFORMANCE_FEED_LIMIT/);assert.equal(over.body.dataset.playerCompletion,undefined);assert.equal(over.feed.publish(),false);
  const emoji=make('💧'.repeat(40000));assert.equal(emoji.feed.publish(),true);emoji.feed.dispose();
  const cjk=make('漢'.repeat(90000));assert.throws(()=>cjk.feed.publish(),/PLAYER_PERFORMANCE_FEED_LIMIT/);assert.equal(cjk.body.dataset.playerCompletion,undefined);
  const surrogate=make('\ud800');assert.equal(surrogate.feed.publish(),true);assert.match(surrogate.body.dataset.playerCompletion,/\\ud800/);surrogate.feed.dispose();
 }finally{globalThis.TextEncoder=encoder;}
});

test('wrong-window, missing-samples, oversized-rings and cyclic reports fail closed instead of looking complete',()=>{
 const m=createPlayerCompletionMetrics({now:()=>0}),valid=m.snapshot({windowMs:1500,includeRafSamples:true});
 for(const value of [null,{},m.snapshot(),m.snapshot({includeRafSamples:true}),{...valid,raf_diagnostics:{...valid.raf_diagnostics,samples:Array(513).fill({})}}]){
  const f=fixture({read:()=>value});assert.throws(()=>f.feed.publish(),/PLAYER_PERFORMANCE_FEED_COMPLETION_INVALID/);assert.equal(f.body.dataset.playerCompletion,undefined);assert.equal(f.feed.publish(),false);
 }
 const cycle={...valid};cycle.self=cycle;const f=fixture({read:()=>cycle});assert.throws(()=>f.feed.publish(),/circular/i);assert.equal(f.feed.publish(),false);assert.equal(f.body.dataset.playerCompletion,undefined);
});

test('dispose removes only its exact last value and late calls perform no reads or clocks',()=>{
 const f=fixture();f.body.dataset.unrelated='keep';f.feed.publish();const reads=f.reads(),clocks=f.clocks();assert.equal(f.feed.dispose(),true);assert.equal(f.body.dataset.playerCompletion,undefined);assert.equal(f.body.dataset.unrelated,'keep');assert.equal(f.feed.publish(),false);assert.equal(f.feed.dispose(),false);assert.equal(f.reads(),reads);assert.equal(f.clocks(),clocks);
 const other=fixture();other.feed.publish();other.body.dataset.playerCompletion='external replacement';other.feed.dispose();assert.equal(other.body.dataset.playerCompletion,'external replacement');
});

test('read failures retire owned data, preserve another writer, and permanently stop observation',()=>{
 for(const replace of [false,true]){
  let fail=false,reads=0,clock=0;const m=createPlayerCompletionMetrics({now:()=>clock}),target={dataset:{}};
  const feed=createPlayerPerformanceFeed({search:'?unone_performance_feed=1',target,now:()=>clock,read:()=>{reads++;if(fail)throw Error('snapshot failed');return m.snapshot({windowMs:1500,includeRafSamples:true});}});
  feed.publish();if(replace)target.dataset.playerCompletion='other';clock=500;fail=true;assert.throws(()=>feed.publish(),/snapshot failed/);assert.equal(target.dataset.playerCompletion,replace?'other':undefined);assert.equal(feed.publish(),false);assert.equal(reads,2);
 }
});

test('reentrant publish is ignored and disposal during read/serialization/write cannot republish',()=>{
 const m=createPlayerCompletionMetrics({now:()=>0}),base=m.snapshot({windowMs:1500,includeRafSamples:true});
 let feed,reads=0,nested;const target={dataset:{}};feed=createPlayerPerformanceFeed({search:'?unone_performance_feed=1',target,now:()=>0,read:()=>{reads++;nested=feed.publish();return base;}});assert.equal(feed.publish(),true);assert.equal(nested,false);assert.equal(reads,1);feed.dispose();
 for(const phase of ['read','serialization','write']){
  let active;const data={},body={dataset:data};let writes=0,value;
  if(phase==='write')Object.defineProperty(data,'playerCompletion',{configurable:true,get:()=>value,set(text){writes++;active.dispose();value=text;}});
  active=createPlayerPerformanceFeed({search:'?unone_performance_feed=1',target:body,now:()=>0,read:()=>{if(phase==='read')active.dispose();return phase==='serialization'?{...base,toJSON(){active.dispose();return base;}}:base;}});
  assert.equal(active.publish(),false);assert.equal(data.playerCompletion,undefined);assert.equal(active.publish(),false);assert.equal(writes,phase==='write'?1:0);
 }
});

test('failed attribute deletion is explicit but disposal stays terminal',()=>{
 const f=fixture();f.feed.publish();Object.defineProperty(f.body.dataset,'playerCompletion',{configurable:false});const clocks=f.clocks(),reads=f.reads();assert.throws(()=>f.feed.dispose(),TypeError);assert.equal(f.feed.publish(),false);assert.equal(f.feed.dispose(),false);assert.equal(f.clocks(),clocks);assert.equal(f.reads(),reads);
});

test('invalid/regressing clocks fail closed and no timer, listener or control API is installed',()=>{
 for(const bad of [NaN,Infinity,-1,'0']){const f=fixture({now:()=>bad});assert.throws(()=>f.feed.publish(),/PLAYER_PERFORMANCE_FEED_CLOCK_INVALID/);assert.equal(f.feed.publish(),false);assert.equal(f.reads(),0);}
 const f=fixture();f.feed.publish();f.setTime(-1);assert.throws(()=>f.feed.publish(),/PLAYER_PERFORMANCE_FEED_CLOCK_INVALID/);assert.equal(f.feed.publish(),false);
 const names=['setTimeout','setInterval','requestAnimationFrame','addEventListener'],before=new Map(names.map(key=>[key,globalThis[key]]));
 try{for(const key of names)globalThis[key]=()=>{throw Error('unexpected '+key);};const quiet=fixture();assert.equal(quiet.feed.publish(),true);assert.deepEqual(Object.keys(quiet.feed),['publish','dispose']);assert.equal(Object.hasOwn(globalThis,'unonePerformanceFeed'),false);quiet.feed.dispose();}
 finally{for(const [key,value]of before)if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});
