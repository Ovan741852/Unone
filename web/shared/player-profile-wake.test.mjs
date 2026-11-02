import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createPlayerProfiler,playerProfileOptions} from './raster-diagnostics.mjs';
const source=fs.readFileSync(new URL('../player/main.js',import.meta.url),'utf8');
function registration(search){
 const opts=playerProfileOptions(search),profiler=opts?createPlayerProfiler({limit:opts.limit,now:()=>0}):null;
 const start=source.indexOf('function recordSchedulerWake('),end=source.indexOf('\nconst metrics=',start);
 assert(start>=0&&end>start,'Actual main wake recorder is present');
 const begin=source.indexOf('scheduler=createAsyncScheduler({'),finish=source.indexOf('\n /* DEVELOPER_CONNECT */',begin);
 assert(begin>=0&&finish>begin);let options;
 const context={profiler,draw(){},fail(){},createAsyncScheduler:value=>{options=value;return{};},document:{body:{dataset:{}}}};
 vm.createContext(context);vm.runInContext(source.slice(start,end)+source.slice(begin,finish),context);
 return{profiler,options,context};
}
test('production main enables bounded passive wake records only through the real profile opt-in',()=>{
 const off=registration('');assert.equal(off.profiler,null);assert.equal(off.options.onWakeDiagnostic,null);
 const on=registration('?unone_profile=1&unone_profile_limit=16');assert.equal(typeof on.options.onWakeDiagnostic,'function');assert.equal(on.options.onWake,undefined,'development PROFILE_WAKE marker is not overwritten');
 for(let i=0;i<25;i++)on.options.onWakeDiagnostic({source:'raf',raf_time_ms:i*10,wake_start_ms:i*10,wake_end_ms:i*10+4,generation:1,generation_end:1,reset_before_wake:i===0,reset_during_wake:false,elapsed_ms:10,acc_before_ms:0,acc_after_ms:0,acc_current_ms:0,due:1,admitted:1,lost:0,actual_steps:1,attempted_steps:1,dropped_delta:0,cancelled:false,paused:false,error:null});
 const report=on.profiler.report();assert.equal(report.events.length,16);assert.equal(report.counts.overwritten,9);assert(report.events.every(e=>e.kind==='wake'&&e.status==='ok'));
 const row=report.events.at(-1);assert.equal(row.attrs.raf_time_ms,240);assert.equal(row.attrs.actual_steps,1);assert.equal(row.attrs.wake_end_ms-row.attrs.wake_start_ms,4);assert.equal(row.wall_ms,0,'event wall is observer recording, not duplicated update/draw wall');
 assert.equal(Object.hasOwn(row.attrs,'error_code'),false,'healthy null error must not become an UNCLASSIFIED error');
});
test('actual main wake consumer records only genuine sanitized errors and preserves cancellation status',()=>{
 const on=registration('?unone_profile=1');
 on.options.onWakeDiagnostic({cancelled:false,error:'TICK_FAILED: private runtime detail',raf_time_ms:10});
 on.options.onWakeDiagnostic({cancelled:true,error:'RUNTIME_CLOSED: abandoned request',raf_time_ms:20});
 const [failed,cancelled]=on.profiler.report().events;
 assert.equal(failed.status,'error');assert.equal(failed.attrs.error_code,'TICK_FAILED');assert.equal(Object.hasOwn(failed.attrs,'error'),false);
 assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.attrs.error_code,'RUNTIME_CLOSED');assert.equal(Object.hasOwn(cancelled.attrs,'error'),false);
});
test('actual main wake observer failure cannot escape into game scheduling',()=>{
 const on=registration('?unone_profile=1');on.profiler.record=()=>{throw Error('PROFILER_SINK_FAILED');};
 assert.doesNotThrow(()=>on.options.onWakeDiagnostic({cancelled:false,error:null}));assert.match(on.context.document.body.dataset.playerProfileError,/PROFILER_SINK_FAILED/);
});
