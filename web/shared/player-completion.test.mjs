import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayerCompletionMetrics,installPlayerPerformanceAccessor} from './player-completion.mjs';
const done=Object.freeze({status:'completed'});
test('completion requires explicit world, UI and cursor readiness and keeps simulation distinct',()=>{
 let clock=10;const m=createPlayerCompletionMetrics({now:()=>clock,timeOrigin:1234});
 m.accept({world:{frame:12,time_seconds:.2}},true);
 const draw=(world,ui=done,cursor=done)=>{m.attempt();m.finish(world,ui,cursor,12,++clock);};
 draw({status:'skipped',reason:'frame_resources_pending'});draw(done,{status:'skipped',reason:'ui_assets_pending'});
 draw(done,done,{status:'skipped',reason:'cursor_assets_pending'});draw(undefined);m.attempt();m.error();
 let r=m.snapshot();assert.equal(r.simulation_frame,12);assert.equal(r.simulation_time_seconds,.2);assert.equal(r.publication_at_ms,10);
 assert.equal(r.completed_draws,0);assert.equal(r.last_presented_snapshot_frame,null);assert.equal(r.skipped_draws,3);assert.equal(r.unknown_draws,1);assert.equal(r.error_draws,1);
 draw(done);draw(done);r=m.snapshot({droppedSteps:7,backend:'worker'});
 assert.equal(r.draw_attempts,7);assert.equal(r.completed_draws,2);assert.equal(r.presented_frame_changes,1);assert.equal(r.last_presented_snapshot_frame,12);
 assert.equal(r.dropped_steps_total,7);assert.equal(r.backend,'worker');assert.equal(r.completed_intervals.p99_ms,1);
 assert.equal(r.skip_counts.ui_assets_pending,1);assert.equal(r.completion_contract,'available');
 assert.throws(()=>{r.skip_counts.ui_assets_pending=99;},TypeError);assert.equal(m.snapshot().skip_counts.ui_assets_pending,1);
 m.accept({world:{frame:13,time_seconds:13/60}});assert.equal(m.snapshot().last_presented_snapshot_frame,12);
 m.accept({world:{frame:0,time_seconds:0}},true,7);r=m.snapshot({droppedSteps:8});assert.equal(r.session,2);assert.equal(r.draw_attempts,0);assert.equal(r.last_presented_snapshot_frame,null);assert.equal(r.dropped_steps_total,1);
});
test('interval storage is bounded, stale windows are empty and reads never advance counters',()=>{
 let clock=0;const m=createPlayerCompletionMetrics({now:()=>clock});m.accept({world:{frame:0,time_seconds:0}},true);
 for(let i=0;i<700;i++){clock+=16;m.attempt();m.finish(done,done,done,i,clock);}
 const before=m.snapshot({windowMs:60000});assert.equal(before.completed_intervals.retained,512);assert.equal(before.completed_intervals.p95_ms,16);
 const short=m.snapshot({windowMs:100});assert.equal(short.completed_intervals.retained,7);assert.equal(short.completed_draws,700);
 clock+=5001;const stale=m.snapshot();assert.equal(stale.completed_intervals.retained,0);assert.equal(stale.completed_intervals.p99_ms,null);assert.equal(stale.completed_draws,700);
 assert.throws(()=>m.snapshot({windowMs:Infinity}),/PLAYER_PERFORMANCE_WINDOW_INVALID/);
});
test('owned read-only accessor preserves existing names and permits safe teardown and reattachment',()=>{
 const target={},m=createPlayerCompletionMetrics({now:()=>1}),remove=installPlayerPerformanceAccessor(target,()=>m.snapshot());
 assert(Object.isFrozen(target.unonePlayerPerformance));assert(Object.isFrozen(target.unonePlayerPerformance.snapshot()));
 const existing=target.unonePlayerPerformance,ignored=installPlayerPerformanceAccessor(target,()=>{throw Error('replaced');});ignored();assert.equal(target.unonePlayerPerformance,existing);
 remove();assert.equal('unonePlayerPerformance'in target,false);
 const removeAgain=installPlayerPerformanceAccessor(target,()=>m.snapshot());assert(target.unonePlayerPerformance);removeAgain();
 const inherited=Object.create({unonePlayerPerformance:{owner:'other'}});installPlayerPerformanceAccessor(inherited,()=>null)();assert.equal(Object.hasOwn(inherited,'unonePlayerPerformance'),false);
});
test('RAF timestamps, newly shown snapshots and submission wall time remain separate paired measurements',()=>{
 let clock=0;const m=createPlayerCompletionMetrics({now:()=>clock});m.accept({world:{frame:0}},true);
 clock=4;m.finish(done,done,done,0,clock,'startup',null,0);
 const frames=[1,1,2,2,3],ends=[18,40,44,63,77];
 for(let i=0;i<frames.length;i++){const at=10+i*16;clock=ends[i];m.attempt();m.finish(done,done,done,frames[i],clock,'scheduler_raf',at,at+1,i%2===0);clock+=2;m.rafEnd(at,at+1,clock,i%2===0);}
 const r=m.snapshot({includeRafSamples:true});assert.equal(r.completed_draws,6);assert.equal(r.presented_frame_changes,4);
 assert.equal(r.successful_submission_raf_intervals.p95_ms,16);assert.equal(r.successful_submission_raf_intervals.max_ms,16);assert.equal(r.new_snapshot_raf_intervals.retained,2);assert.equal(r.new_snapshot_raf_intervals.p95_ms,32);
 assert.equal(r.completed_intervals.p95_ms,22,'v1 completion-clock intervals still include startup and repeats');assert.notEqual(r.submit_sync_wall.max_ms,r.callback_sync_wall.max_ms);
 assert.deepEqual(r.raf_diagnostics.source_counts,{manual:0,startup:1,scheduler_raf:5,unknown:0});assert.equal(r.raf_diagnostics.scheduler_raf.repeats,2);
 const rows=r.raf_diagnostics.samples;assert.equal(rows.length,6);assert.deepEqual(rows[2],{source:'scheduler_raf',raf_time_ms:26,start_ms:27,end_ms:40,callback_end_ms:42,snapshot_frame:1,outcome:'completed',new_snapshot:false,regression:false,in_flight:false});
 assert.equal(rows[0].source,'startup');assert.equal(rows[0].raf_time_ms,null);assert.equal(rows[0].callback_end_ms,null);assert(Object.isFrozen(rows));assert(Object.isFrozen(rows[2]));
 assert.throws(()=>{rows[2].end_ms=999;},TypeError);assert.notEqual(m.snapshot({includeRafSamples:true}).raf_diagnostics.samples[2],rows[2]);assert.equal('samples'in m.snapshot().raf_diagnostics,false);
});
test('fresh RAF intervals exclude manual/startup already shown frames, repeats, unknown frames and regressions',()=>{
 let clock=0;const m=createPlayerCompletionMetrics({now:()=>clock});m.accept({world:{frame:10}},true);
 m.finish(done,done,done,10,1,'startup');m.finish(done,done,done,12,2,'manual');
 for(const [i,frame]of [12,13,11,13,14,14,null].entries()){const raf=10+i*16;clock=raf+2;m.finish(done,done,done,frame,clock,'scheduler_raf',raf,raf+1);m.rafEnd(raf,raf+1,++clock);}
 const r=m.snapshot({includeRafSamples:true}),stats=r.raf_diagnostics.scheduler_raf;
 assert.equal(r.successful_submission_raf_intervals.retained,6);assert.equal(r.new_snapshot_raf_intervals.retained,1);assert.equal(r.new_snapshot_raf_intervals.max_ms,48);
 assert.equal(stats.repeats,1);assert.equal(stats.regressions,1);assert.equal(stats.already_submitted_frames,4);assert.equal(stats.unknown_frames,1);
 const rafRows=r.raf_diagnostics.samples.filter(row=>row.source==='scheduler_raf');assert.deepEqual(rafRows.map(row=>row.new_snapshot),[false,true,false,false,true,false,false]);assert.equal(rafRows[2].regression,true);assert.equal(rafRows[6].snapshot_frame,null);
 assert.equal(r.presented_frame_changes,7,'legacy global change counter still includes regressions and null changes');
});
test('skips, errors and callback-only RAFs have explicit outcomes and nominal deadline scopes',()=>{
 let clock=0;const m=createPlayerCompletionMetrics({now:()=>clock});m.accept({world:{frame:1}},true);
 clock=8;m.finish({status:'skipped',reason:'ui_assets_pending'},done,done,1,clock,'scheduler_raf',0,1,true,10);clock=12;m.rafEnd(0,1,clock,true,10);
 clock=34;m.finish(undefined,done,done,1,clock,'scheduler_raf',16,20,false,10);clock=35;m.rafEnd(16,19,clock,false,10);
 clock=44;m.error('scheduler_raf',32,34,true,clock,2,10);clock=45;m.rafEnd(32,33,clock,true,10);
 clock=53;m.rafEnd(48,49,clock,false,10);
 m.preparationEnd(m.epoch(),0,12,27,2,false,10);m.preparationEnd(m.epoch(),32,35,36,0,true,10);
 const r=m.snapshot({includeRafSamples:true});assert.deepEqual(r.raf_diagnostics.samples.map(row=>row.outcome),['skipped','unknown','error','no_submission']);assert.equal(r.completed_draws,0);assert.equal(r.draw_attempts,0);assert.equal(r.error_draws,1);
 assert.equal(r.raf_diagnostics.samples[3].end_ms,null);assert.equal(r.raf_diagnostics.samples[3].callback_end_ms,53);assert.equal(r.raf_diagnostics.callbacks,4);assert.equal(r.raf_diagnostics.callbacks_in_flight,2);
 assert.deepEqual(r.raf_diagnostics.nominal_deadlines.submission,{eligible:3,missed:2,unknown:0});assert.deepEqual(r.raf_diagnostics.nominal_deadlines.callback,{eligible:4,missed:3,unknown:0});assert.deepEqual(r.raf_diagnostics.nominal_deadlines.preparation,{eligible:1,missed:1,unknown:0});
 assert.equal(r.raf_diagnostics.preparation_steps,2);assert.equal(r.raf_diagnostics.preparation_cancelled,1);assert.equal(r.preparation_wall.max_ms,15);assert.match(r.raf_diagnostics.nominal_deadlines.scope,/not GPU/);
});
test('primitive RAF storage is bounded and default or stale queries construct no paired row objects',()=>{
 let clock=0;const m=createPlayerCompletionMetrics({now:()=>clock});m.accept({world:{frame:0}},true);
 const original=Object.freeze;let rowObjects=0;Object.freeze=value=>{if(value&&Object.hasOwn(value,'raf_time_ms'))rowObjects++;return original(value);};
 try{
  for(let i=1;i<=700;i++){const at=i*16;clock=at+1;m.finish(done,done,done,i,clock,'scheduler_raf',at,at);clock=at+3;m.rafEnd(at,at,clock,false);}
  assert.equal(rowObjects,0,'no per-frame paired object allocations');const full=m.snapshot({windowMs:60000});assert.equal(rowObjects,0);assert.equal('samples'in full.raf_diagnostics,false);assert.equal(full.raf_diagnostics.retained,512);assert.equal(full.raf_diagnostics.recorded_total,700);assert.equal(full.successful_submission_raf_intervals.retained,512);assert.equal(full.successful_submission_raf_intervals.max_ms,16);assert.ok(full.successful_submission_raf_intervals.coverage_ms>8000);
  const short=m.snapshot({windowMs:32,includeRafSamples:true});assert.equal(short.raf_diagnostics.samples.length,3);assert.equal(rowObjects,3,'window filtering precedes object construction');assert.equal(short.raf_diagnostics.samples[0].snapshot_frame,698);
  clock+=60001;const stale=m.snapshot({includeRafSamples:true});assert.deepEqual(stale.raf_diagnostics.samples,[]);assert.equal(rowObjects,3);assert.equal(stale.new_snapshot_raf_intervals.retained,0);assert.equal(stale.new_snapshot_raf_intervals.max_ms,null);assert.equal(stale.new_snapshot_raf_intervals.coverage_ms,0);
 }finally{Object.freeze=original;}
});
test('reset rejects stale asynchronous preparation epochs and clears paired/wall/counter history',()=>{
 let clock=10;const m=createPlayerCompletionMetrics({now:()=>clock});m.accept({world:{frame:9}},true);const old=m.epoch();m.finish(done,done,done,9,12,'scheduler_raf',10,11);m.preparationEnd(old,10,12,16,1,false);
 m.reset(7);assert.equal(m.epoch(),old+1);assert.equal(m.preparationEnd(old,10,12,1000,50,false),false);
 const cleared=m.snapshot({includeRafSamples:true});assert.equal(cleared.raf_diagnostics.recorded_total,0);assert.equal(cleared.preparation_wall.retained,0);assert.equal(cleared.raf_diagnostics.preparations,0);assert.equal(cleared.completed_draws,0);assert.equal(cleared.completed_intervals.retained,0);
 clock=24;assert.equal(m.preparationEnd(m.epoch(),20,21,23,1,false,10),true);assert.equal(m.preparationEnd(m.epoch(),20,22,24,Infinity,true,10),true);
 const r=m.snapshot();assert.equal(r.raf_diagnostics.preparation_steps,1);assert.equal(r.raf_diagnostics.preparation_unknown_steps,1);assert.equal(r.raf_diagnostics.preparation_cancelled,1);assert.equal(r.preparation_wall.retained,1);assert.equal(r.dropped_steps_total,null);
});
test('startup/manual long spans and hidden cancelled preparation never pollute active RAF pacing wall statistics',()=>{
 let clock=0;const m=createPlayerCompletionMetrics({now:()=>clock});m.accept({world:{frame:0}},true);
 m.finish(done,done,done,0,1000,'startup',null,0);m.error('manual',null,1,false,1100,0);
 m.preparationEnd(m.epoch(),10,12,120000,3,true,16);clock=120001;
 const r=m.snapshot({windowMs:60000});assert.equal(r.submit_sync_wall.retained,0);assert.equal(r.callback_sync_wall.retained,0);assert.equal(r.preparation_wall.retained,0);assert.equal(r.raf_diagnostics.preparation_cancelled,1);assert.equal(r.raf_diagnostics.preparation_steps,3);assert.equal(r.raf_diagnostics.nominal_deadlines.preparation.eligible,0);assert.equal(r.raf_diagnostics.nominal_deadlines.preparation.unknown,0);assert.equal(r.raf_diagnostics.source_counts.startup,1);assert.equal(r.raf_diagnostics.source_counts.manual,1);
});
test('opt-in samples require booleans and unknown labels, frames and timestamps stay explicit',()=>{
 let clock=10;const m=createPlayerCompletionMetrics({now:()=>clock});for(const invalid of [null,undefined,0,1,'true',{},[]])assert.throws(()=>m.snapshot({includeRafSamples:invalid}),/PLAYER_PERFORMANCE_OPTIONS_INVALID/);
 m.error('other',null,null,false,clock,'bad');m.finish(done,done,done,null,++clock,'scheduler_raf',null,null,false,NaN);
 const r=m.snapshot({includeRafSamples:true});assert.equal(r.raf_diagnostics.source_counts.unknown,1);assert.equal(r.raf_diagnostics.scheduler_raf.unknown_frames,1);assert.equal(r.raf_diagnostics.scheduler_raf.unknown_raf_timestamps,1);assert.equal(r.raf_diagnostics.nominal_deadlines.submission.unknown,1);
 assert.equal(r.raf_diagnostics.samples[0].source,'unknown');assert.equal(r.raf_diagnostics.samples[0].snapshot_frame,null);assert.equal(r.raf_diagnostics.samples[1].raf_time_ms,null);assert.equal(r.raf_diagnostics.samples[1].start_ms,null);assert.equal(r.new_snapshot_raf_intervals.retained,0);
});
