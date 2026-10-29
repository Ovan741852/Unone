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
