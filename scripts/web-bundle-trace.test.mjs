import test from 'node:test';
import assert from 'node:assert/strict';
import {createBundleTrace} from './web-bundle-trace.mjs';
import {parseScenario} from './measure-web-scenario.mjs';
import {scenarioConsole} from './measure-web-export.mjs';

function runtime() {
  let now=10,timer;
  const groups=[{name:'arena',state:'idle',mode:null,held:0,ready:0,total:1}];
  const loading={completed:0,failed:0,cancelled:0,recent:[]}, resources=[];
  const submission={session:1,error_draws:0,skip_counts:{ui_assets_pending:0,ui_diagnostics:0}};
  const host={
    location:new URL('https://example.org/game/'),
    performance:{now:()=>now,getEntriesByType:()=>resources},
    setInterval(fn){timer=fn;return 1;},clearInterval(){timer=null;},
    unonePlayerAssets:{snapshot:()=>({available:true,catalog_generation:1,groups,loading})},
    unonePlayerPerformance:{snapshot:()=>submission},
  };
  function load(decode_ms) {
    loading.completed++;
    loading.recent.push({id:'texture://arena',state:'ready',completed_at_ms:now,decode_ms});
  }
  return {host,groups,submission,loading,resources,load,tick(){now+=10;timer();}};
}

test('bundle trace correlates releases, pending draws, actual decodes and transmitted requests',()=>{
  const r=runtime(),report=createBundleTrace({expect_released:['arena']},r.host);
  report.mark('battle');Object.assign(r.groups[0],{state:'ready',mode:'load',held:1,ready:1});
  r.tick();r.load(2);r.submission.skip_counts.ui_assets_pending+=3;r.tick();
  report.mark('return');Object.assign(r.groups[0],{state:'unloaded',held:0,ready:0});
  r.load(null);r.tick();r.load(0);r.tick();
  const resource=(start,query,size)=>({name:'https://example.org/image.png?token='+query,initiatorType:'img',
    startTime:start,responseEnd:start+1,transferSize:size,encodedBodySize:4096});
  r.resources.push(resource(20,'secret',800),resource(35,'secret',700),resource(40,'second',500),
    resource(45,'second',0),resource(50,'hidden',0));
  const trace=report.finish();
  assert.equal(trace.ok,true);assert.deepEqual(trace.final_held,[]);
  assert.deepEqual(trace.group_events.map(x=>[x.phase,x.state]),[[1,'ready'],[2,'unloaded']]);
  assert.equal(trace.phases[1].draws.ui_assets_pending,3);
  assert.deepEqual(trace.findings.map(f=>[f.code,f.count]),[['BUNDLE_REPEATED_IMAGE_DECODE',2],['BUNDLE_REPEATED_NETWORK_TRANSFER',2]]);
  assert.equal(trace.loads.length,3);assert.equal(trace.resources.length,5);
  assert(!JSON.stringify(trace).includes('secret'));assert(!JSON.stringify(trace).includes('token='));
});

test('missing final releases fail only when ownership or the missing declaration is observed',()=>{
 const r=runtime();const trace=createBundleTrace({expect_released:['arena','missing']},r.host);
 Object.assign(r.groups[0],{state:'loading',mode:'load',held:0});r.tick();
 r.submission.skip_counts.ui_diagnostics=1;r.submission.error_draws=2;
 const result=trace.finish();assert.equal(result.ok,false);
 assert.deepEqual(result.findings.map(f=>f.code),['BUNDLE_UI_DIAGNOSTIC_DRAWS','BUNDLE_DRAW_ERROR','BUNDLE_EXPECTED_RELEASE_MISSING','BUNDLE_EXPECTED_GROUP_UNKNOWN']);
});

test('missing broker, overrun load history, hidden size and absent decode timings stay explicit',()=>{
 const r=runtime();delete r.host.unonePlayerAssets;
 const unavailable=createBundleTrace({expect_released:['arena']},r.host).finish();
 assert.equal(unavailable.ok,false);assert.deepEqual(unavailable.findings.map(f=>f.code),['BUNDLE_TRACE_UNAVAILABLE']);
 const available=runtime(),trace=createBundleTrace({},available.host);
 available.load(null);available.load(null);available.loading.recent.shift();
 const result=trace.finish();assert.deepEqual(result.findings.map(f=>f.code),['BUNDLE_TRACE_INCOMPLETE']);
 assert.equal(result.findings[0].missed_load_timings,1);
});

test('scenario parser validates trace fields and preserves existing definitions',()=>{
 const base={schema:'unone.web-scenario.v1',name:'map',phases:[{name:'battle',rounds:1,steps:[{wait_ms:0}]}]};
 assert(!('bundle_trace' in parseScenario(JSON.stringify(base))));
 assert.deepEqual(parseScenario(JSON.stringify({...base,bundle_trace:{expect_released:['arena']}})).bundle_trace,
   {expect_released:['arena'],sample_ms:250});
 assert.equal(parseScenario(JSON.stringify({...base,bundle_trace:{max_visible_queue_ms:16.7}})).bundle_trace.max_visible_queue_ms,16.7);
 for(const spec of [true,{sample_ms:1},{expect_released:null},{expect_released:['a','a']},{unknown:false},
   ...[-1,600001,null,'10'].map(max_visible_queue_ms=>({max_visible_queue_ms}))])
   assert.throws(()=>parseScenario(JSON.stringify({...base,bundle_trace:spec})),/MEASURE_SCENARIO_INVALID/);
});

test('visible queue gate distinguishes no sample, zero wait, shared IDs and exact-budget equality by completion phase',()=>{
 const r=runtime();r.loading.visible_queue_supported=true;
 const trace=createBundleTrace({max_visible_queue_ms:10},r.host);
 const load=(id,ms)=>{r.load(null);Object.assign(r.loading.recent.at(-1),{id,visible_queue_ms:ms});};
 r.tick();trace.mark('town');
 load('prefetch',null);load('fast',0);load('edge',10);load('late',12);r.tick();
 load('late',18);load('other',14);r.tick();trace.mark('return');
 load('fast',0);const result=trace.finish();
 assert.equal(result.ok,false);assert.equal(result.methods.visible_queue,true);
 assert.deepEqual(result.phases.map(p=>p.visible_queue),[
   {samples:0,worst_ms:null,worst_id:null,over_budget_loads:0,over_budget_images:0},
   {samples:5,worst_ms:18,worst_id:'late',over_budget_loads:3,over_budget_images:2},
   {samples:1,worst_ms:0,worst_id:'fast',over_budget_loads:0,over_budget_images:0}]);
 assert.deepEqual(result.findings.map(f=>[f.code,f.severity,f.phase]),[['BUNDLE_VISIBLE_QUEUE_BUDGET_EXCEEDED','error',1]]);
});

test('a queue budget fails for an older reporter, missed load history or malformed queue samples',()=>{
 const old=runtime();
 for(const value of [null,-1,Infinity,600001,'10'])
   assert.throws(()=>createBundleTrace({max_visible_queue_ms:value},old.host),/BUNDLE_VISIBLE_QUEUE_BUDGET_INVALID/);
 assert.equal(createBundleTrace({},old.host).finish().ok,true);
 const absent=createBundleTrace({max_visible_queue_ms:0},old.host).finish();
 assert.equal(absent.ok,false);assert(absent.findings.some(f=>f.code==='BUNDLE_VISIBLE_QUEUE_UNAVAILABLE'));
 const r=runtime();r.loading.visible_queue_supported=true;
 const noLoads=createBundleTrace({max_visible_queue_ms:0},r.host).finish();
 assert.equal(noLoads.ok,true);assert.equal(noLoads.phases[0].visible_queue.worst_ms,null);
 const trace=createBundleTrace({max_visible_queue_ms:10},r.host);r.load(null);r.load(null);r.loading.recent.shift();
 const invalid=trace.finish();
 assert.equal(invalid.ok,false);
 const finding=invalid.findings.find(f=>f.code==='BUNDLE_VISIBLE_QUEUE_INCOMPLETE');
 assert.equal(finding.missed_load_timings,1);assert.equal(finding.invalid_queue_rows,1);
});

test('CLI summary keeps stable finding counts even for a failed ownership assertion',()=>{
 const warnings=[{code:'BUNDLE_REPEATED_IMAGE_DECODE'},{code:'BUNDLE_REPEATED_IMAGE_DECODE'},
   {code:'BUNDLE_EXPECTED_RELEASE_MISSING'}];
 const consoleReport=scenarioConsole({runs:[{index:1,ok:false,bundle_trace:{ok:false,findings:warnings}}]});
 assert.deepEqual(consoleReport.bundle_traces,[{run:1,ok:false,findings:{
   BUNDLE_REPEATED_IMAGE_DECODE:2,BUNDLE_EXPECTED_RELEASE_MISSING:1}}]);
});
