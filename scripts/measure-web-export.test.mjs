import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseArgs,quantiles,summarize,pairDeltas,resourceRow,joinNetwork,startupSteps,normalizeLoad,readExport,startServer,cacheControlFor,browserArgs,probeSource,collectSource,buildReport,SCHEMA} from './measure-web-export.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('arguments: defaults are five cold, five warm and one profiler pair; unknown or malformed flags fail',()=>{
 const options=parseArgs(['--export','e','--output','r.json']);
 assert.equal(options.cold,5);assert.equal(options.warm,5);assert.equal(options.profilePairs,1);assert.deepEqual(options.viewport,{width:1280,height:720});assert.equal(options.seed,'42');
 const custom=parseArgs(['--export','e','--output','r.json','--milestone','city.interactive','--milestone','battle.ready','--viewport','926x428','--dpr','3','--network','slow-4g','--cpu-throttle','4']);
 assert.deepEqual(custom.milestones,['city.interactive','battle.ready']);assert.equal(custom.dpr,3);assert.equal(custom.network.preset,'slow-4g');assert.equal(custom.cpuThrottle,4);
 assert.deepEqual(parseArgs(['--export','e','--output','r','--network','40,10000,5000']).network,{preset:null,latency_ms:40,download_kbps:10000,upload_kbps:5000});
 for(const argv of [['--export','e'],['--export','e','--output','r','--typo'],['--export','e','--output','r','--viewport','big'],['--export','e','--output','r','--cold','-1'],
  ['--export','e','--output','r','--cold','0','--warm','0','--profile-pairs','0'],['--export','e','--output','r','--milestone',''],['--export','e','--output','r','--seed','-3'],['--export','e','--output','r','--frame-window-ms','0']])
  assert.throws(()=>parseArgs(argv),/MEASURE_ARG_/,argv.join(' '));
});

test('quantiles: median and nearest-rank p95 over present values only; nulls are counted, not zeroed',()=>{
 assert.deepEqual(quantiles([5,1,4,2,3]),{n:5,nulls:0,median:3,p95:5,min:1,max:5});
 assert.deepEqual(quantiles([4,1,null,3,2]),{n:4,nulls:1,median:2.5,p95:4,min:1,max:4});
 assert.deepEqual(quantiles([null,undefined,NaN]),{n:0,nulls:3,median:null,p95:null,min:null,max:null});
 const twenty=Array.from({length:20},(_,i)=>i+1);assert.equal(quantiles(twenty).p95,19);
});

test('summaries and profiler pair deltas take each metric across runs, never adding different quantiles',()=>{
 const runs=[{metrics:{a:10,b:null}},{metrics:{a:30,b:2}},{metrics:{a:20}}];
 const summary=summarize(runs);assert.equal(summary.a.median,20);assert.equal(summary.b.n,1);assert.equal(summary.b.nulls,2);
 const pairs=[{off:{metrics:{x:100,y:1}},on:{metrics:{x:130}}},{off:{metrics:{x:110}},on:{metrics:{x:120}}}];
 const deltas=pairDeltas(pairs);assert.deepEqual(Object.keys(deltas),['x'],'a metric missing from the profiled side has no delta');
 assert.equal(deltas.x.on_minus_off.median,20);assert.equal(deltas.x.off.median,105);
});

test('resource rows: hidden sizes are null and a zero transfer is a cache hit only when sizes are visible',()=>{
 const boot=50;
 const local={name:'http://h/releases/x/runtime/a.wasm',initiatorType:'fetch',startTime:100,requestStart:110,responseStart:150,responseEnd:300,duration:200,transferSize:0,encodedBodySize:900,decodedBodySize:900};
 const cached=resourceRow(local,{status:200,fromDiskCache:true},boot);
 assert.equal(cached.cache,'disk_cache');assert.equal(cached.page_cache_hint,'local_cache');assert.equal(cached.transfer_bytes,0);assert.equal(cached.start_ms,50);assert.equal(cached.response_end_ms,250);
 const opaque={...local,transferSize:0,encodedBodySize:0,decodedBodySize:0,requestStart:0,responseStart:0};
 const hidden=resourceRow(opaque,null,boot);
 assert.equal(hidden.transfer_bytes,null);assert.equal(hidden.encoded_bytes,null);assert.equal(hidden.page_cache_hint,null,'transferSize=0 behind an opaque origin is not a cache hit');
 assert.equal(hidden.cache,null);assert.equal(hidden.request_start_ms,null);assert.equal(hidden.response_end_ms,250,'start/end stay visible');
 assert.equal(resourceRow({...local,transferSize:300},{status:304},boot).cache,'revalidated');
 assert.equal(resourceRow({...local,transferSize:1200},{status:200},boot).cache,'network');
 assert.equal(resourceRow(local,{status:200,servedFromCache:true},boot).cache,'memory_cache');
 assert.equal(resourceRow(local,{failed:true},boot).cache,'failed');
});

test('network rows join resource entries by URL in request order',()=>{
 const joined=joinNetwork([{name:'a'},{name:'b'},{name:'a'}],[{url:'a',status:200},{url:'a',status:304},{url:'b',status:200}]);
 assert.deepEqual(joined.map(row=>row.status),[200,200,304]);
 assert.equal(joinNetwork([{name:'c'}],[])[0],null);
});

test('startup steps give start, completion and duration; the module graph step starts at boot',()=>{
 const rows=startupSteps({steps:[{id:'player',state:'done',ms:40},{id:'content',state:'done',started_ms:41,ms:60},{id:'images',state:'active',started_ms:61,done:1,total:4},{id:'audio',state:'pending'}]});
 assert.deepEqual(rows[0],{id:'player',state:'done',started_ms:0,completed_ms:40,duration_ms:40});
 assert.deepEqual(rows[1],{id:'content',state:'done',started_ms:41,completed_ms:60,duration_ms:19});
 assert.deepEqual(rows[2],{id:'images',state:'active',started_ms:61,completed_ms:null,duration_ms:null,done:1,total:4});
 assert.equal(rows[3].started_ms,null);assert.deepEqual(startupSteps(null),[]);
});

function rawLoad(overrides={}){
 return {boot:100,time_origin:1e12,now:2100,visibility:'visible',focused:true,dpr:1,inner:[1280,720],ua:'UA',
  metrics:{runtime_ready_ms:400,first_presented_ms:700,backend:'main',renderer:'three-webgl',seed:'42',seed_source:'query'},
  startup:{state:'ready',steps:[{id:'player',state:'done',ms:50},{id:'runtime',state:'done',started_ms:200,ms:400}]},
  playerPerformance:{backend:{wasm_linear_bytes:33554432}},
  nav:{responseStart:20,responseEnd:30,domInteractive:90,domContentLoadedEventEnd:95,loadEventEnd:120,transferSize:2000,encodedBodySize:1800},
  resources:[{name:'http://h/releases/g/runtime/u.wasm',initiatorType:'fetch',startTime:250,requestStart:255,responseStart:260,responseEnd:350,duration:100,transferSize:5000,encodedBodySize:4800,decodedBodySize:4800},
   {name:'http://h/releases/g/web/player/main.js',initiatorType:'script',startTime:110,requestStart:111,responseStart:120,responseEnd:130,duration:20,transferSize:700,encodedBodySize:600,decodedBodySize:600}],
  paints:[{name:'first-paint',start_ms:105}],
  perf:{queried_at_ms:2050,completed_draws:90,presented_frame_changes:80,dropped_steps_total:0,successful_submission_raf_intervals:{p95_ms:16.700000000000045,window_coverage:0.98,oldest_start_ms:1100,newest_end_ms:2050},new_snapshot_raf_intervals:{p95_ms:16.8},preparation_wall:{p95_ms:2},
   milestones:{rows:[{name:'city.interactive',frame:1,sequence:1,accepted_at_ms:780,presented_at_ms:800,presented_frame:1}]}},
  assets:{broker:{resident_bytes_estimate:4096},loading:{completed:2,failed:0,cancelled:0,recent_capacity:128,recent:[{id:'a',state:'ready',queued_at_ms:300,started_at_ms:301,completed_at_ms:350,queue_ms:1,load_event_ms:40,decode_ms:9,network_ms:null,transfer_bytes:0,encoded_body_bytes:null},{id:'b',state:'ready',queued_at_ms:300,started_at_ms:320,completed_at_ms:420,queue_ms:20,load_event_ms:70,decode_ms:null}]}},
  profile:null,
  probe:{wasm:[{api:'instantiateStreaming',split:true,status:'ok',start_ms:250,compiled_ms:360,end_ms:380}],fonts:[{family:'Body',status:'ok',start_ms:150,end_ms:190}],long_tasks:[{start_ms:300,duration_ms:80},{start_ms:900,duration_ms:60}],
   visibility:[{state:'visible',at_ms:1}],focus:[],focused_at_start:true},
  cdp_metrics:{JSHeapUsedSize:1000,JSHeapTotalSize:2000},console_errors:[],...overrides};
}

test('one load becomes boot-relative metrics with nulls for what the page did not expose',()=>{
 const sample=normalizeLoad(rawLoad(),{network:[{url:'http://h/releases/g/runtime/u.wasm',status:200}],options:{milestones:['city.interactive','missing'],frameWindowMs:1000},kind:'cold',index:1,profiling:false,url:'u'});
 const m=sample.metrics;
 assert.equal(m['player.first_successful_submission_ms'],700);assert.equal(m['player.runtime_ready_ms'],400);assert.equal(m['player.module_graph_ready_ms'],50);
 assert.equal(m['startup.runtime.duration_ms'],200);
 assert.equal(m['wasm.fetch_duration_ms'],100);assert.equal(m['wasm.response_end_ms'],250);assert.equal(m['wasm.compile_ms'],110);assert.equal(m['wasm.instantiate_ms'],20);assert.equal(m['wasm.ready_ms'],280);
 assert.equal(m['fonts.ready_ms'],90);assert.equal(m['images.ready_ms'],320);assert.equal(m['images.queue_ms_max'],20);assert.equal(m['images.decode_ms_max'],9,'a null decode stays out of the maximum');
 assert.equal(m['milestone.city.interactive.accepted_ms'],680);assert.equal(m['milestone.city.interactive.presented_ms'],700);
 assert.equal(m['milestone.missing.presented_ms'],null,'an awaited milestone the game never declared is null');
 assert.equal(m['long_tasks.before_first_submission'],1);assert.equal(m['long_tasks.ms_before_first_submission'],80);
 assert.equal(m['resources.transfer_bytes'],5700);assert.equal(m['memory.wasm_linear_bytes'],33554432);
 assert.equal(sample.images.rows[0].transfer_bytes,null,'a zero image transfer is unknown, not free');
 assert.equal(sample.navigation.boot_ms,100);assert.equal(sample.foreground.hidden_during_run,false);
 assert.equal(sample.wasm.method.startsWith('split'),true);
 assert.equal(sample.frames.successful_submission_raf_intervals.oldest_start_ms,1000,'window timestamps move to the playerBoot clock');assert.equal(sample.frames.successful_submission_raf_intervals.p95_ms,16.7);assert.equal(m['frames.successful_submission_p95_ms'],16.7);
 const hidden=normalizeLoad(rawLoad({resources:[{name:'http://h/a.png',initiatorType:'img',startTime:200,requestStart:0,responseStart:0,responseEnd:260,duration:60,transferSize:0,encodedBodySize:0,decodedBodySize:0}],perf:null,probe:{wasm:[],fonts:[],long_tasks:[],visibility:[{state:'hidden',at_ms:1}],focus:[{focused:false}]}}),{options:{milestones:[]},kind:'warm',index:2,profiling:false});
 assert.equal(hidden.metrics['resources.transfer_bytes'],null,'one hidden size makes the total unknown');
 assert.equal(hidden.metrics['wasm.call_ms'],null);assert.equal(hidden.metrics['frames.successful_submission_p95_ms'],null);
 assert.equal(hidden.foreground.hidden_during_run,true);assert.equal(hidden.foreground.blur_events,1);
 assert.match(hidden.wasm.note,/worker backend/);
});

test('report: summaries only over successful runs of one kind; the prime load is kept raw but never summarized',()=>{
 const sample=(kind,index,first,ok=true)=>({kind,index,ok,error:ok?null:'MEASURE_TIMEOUT',metrics:{'player.first_successful_submission_ms':first},foreground:{visibility_at_start:'visible',hidden_during_run:false,focused_at_sample:true}});
 const runs=[sample('cold',1,500),sample('cold',2,700),sample('cold',3,null,false),sample('prime',0,9000),sample('warm',1,300),sample('profiler_pair',1,320),sample('profiler_pair',1,360)];
 const pairs=[{index:1,order:'off_first',off:runs[5],on:runs[6]}];
 const options={...parseArgs(['--export','e','--output','r']),cold:3,warm:1};
 const exported={development:false,artifact:{cache_policy:{'index.html':'no-cache'}},engine:{source_commit:'abc'},execution:{variant:'production'}};
 const report=buildReport({options,exported,runs,pairs,browserInfo:{browser:{product:'Edg/1'}},createdAt:'2026-11-15T00:00:00Z'});
 assert.equal(report.schema,SCHEMA);assert.equal(report.clock.origin,'window.playerBoot');
 assert.equal(report.summary.cold['player.first_successful_submission_ms'].n,2);assert.equal(report.summary.cold['player.first_successful_submission_ms'].median,600);
 assert.equal(report.summary.warm['player.first_successful_submission_ms'].median,300,'the prime load is not a warm sample');
 assert.equal(report.summary.profiler_pairs['player.first_successful_submission_ms'].on_minus_off.median,40);
 assert.deepEqual(report.coverage.cold,{requested:3,completed:3,ok:2,failed:[{index:3,error:'MEASURE_TIMEOUT'}]});
 assert.deepEqual(report.pairs,[{index:1,order:'off_first',off_run:5,on_run:6}]);
 assert.equal(report.conditions.foreground_all_runs,true);assert.equal(report.runs.length,7);
});

test('the export must be production and its runtime must match runtime.json',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'unone-measure-test-'));
 try{
  const release=path.join(root,'releases','g1');await mkdir(path.join(release,'runtime'),{recursive:true});
  const wasm=Buffer.from('wasm'),js=Buffer.from('js');
  await writeFile(path.join(release,'runtime','u.wasm'),wasm);await writeFile(path.join(release,'runtime','u.js'),js);
  const runtime={wasm:'u.wasm',wasm_sha256:sha(wasm),javascript:'u.js',javascript_sha256:sha(js),dev_tools:false,preview_tools:false,profile:'release',source_commit:'c0ffee',source_dirty:false,bytecode_optimization_level:2};
  await writeFile(path.join(release,'runtime','runtime.json'),JSON.stringify(runtime));
  await writeFile(path.join(root,'index.html'),'<html>');
  const write=value=>writeFile(path.join(root,'export.json'),JSON.stringify(value));
  await write({release_root:'releases/g1',variant:'production',dev_tools:false,preview_tools:false,cache_policy:{'index.html':'no-cache, must-revalidate','releases/':'public, max-age=31536000, immutable'},files:[{path:'index.html'}]});
  const exported=await readExport(root);
  assert.equal(exported.engine.source_commit,'c0ffee');assert.equal(exported.execution.bytecode_optimization_level,2);assert.equal(exported.artifact.wasm_sha256,sha(wasm));assert.equal(exported.artifact.files,1);
  await write({release_root:'releases/g1',variant:'development',dev_tools:false,preview_tools:true});
  await assert.rejects(readExport(root),/MEASURE_EXPORT_NOT_PRODUCTION/);
  assert.equal((await readExport(root,{allowDevelopment:true})).development,true);
  await write({release_root:'releases/g1',variant:'production',dev_tools:false});
  await writeFile(path.join(release,'runtime','u.wasm'),Buffer.from('changed'));
  await assert.rejects(readExport(root),/does not match runtime.json/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('the server applies the export cache policy, revalidates with ETags and stays inside the export',async()=>{
 const policy={'index.html':'no-cache, must-revalidate','releases/':'public, max-age=31536000, immutable'};
 assert.equal(cacheControlFor('index.html',policy),'no-cache, must-revalidate');assert.equal(cacheControlFor('releases/g/a.wasm',policy),'public, max-age=31536000, immutable');
 assert.equal(cacheControlFor('legacy.js',policy),'no-cache');assert.equal(cacheControlFor('releases/g/a.wasm',policy,'public, max-age=300'),'public, max-age=300');
 const root=await mkdtemp(path.join(os.tmpdir(),'unone-measure-serve-'));
 try{
  await mkdir(path.join(root,'releases','g'),{recursive:true});await writeFile(path.join(root,'index.html'),'<html>');await writeFile(path.join(root,'releases','g','a.wasm'),Buffer.alloc(2048,1));
  const server=await startServer(root,{cachePolicy:policy,compress:'gzip'});
  try{
   const page=await fetch(server.url);assert.equal(page.status,200);assert.equal(page.headers.get('cache-control'),'no-cache, must-revalidate');assert.equal(await page.text(),'<html>');
   const wasm=await fetch(server.url+'releases/g/a.wasm');assert.equal(wasm.headers.get('content-type'),'application/wasm');assert.equal(wasm.headers.get('cache-control'),policy['releases/']);
   assert.equal(wasm.headers.get('timing-allow-origin'),'*');assert.equal(wasm.headers.get('content-encoding'),'gzip');assert.equal((await wasm.arrayBuffer()).byteLength,2048);
   const again=await fetch(server.url+'releases/g/a.wasm',{headers:{'if-none-match':wasm.headers.get('etag')}});assert.equal(again.status,304);
   assert.equal((await fetch(server.url+'..%2f..%2fwindows')).status,403);assert.equal((await fetch(server.url+'missing.js')).status,404);
   const log=server.take();assert.deepEqual(log.map(entry=>entry.status),[200,200,304,403,404]);assert.equal(log[1].encoding,'gzip');assert.equal(server.take().length,0);
  }finally{await server.close();}
 }finally{await rm(root,{recursive:true,force:true});}
});

test('the browser is muted, headless and keeps the tab in the foreground',()=>{
 const args=browserArgs({profileDir:'p',headed:false,viewport:{width:926,height:428}});
 for(const flag of ['--headless=new','--mute-audio','--remote-debugging-port=0','--user-data-dir=p','--window-size=926,428','--disable-renderer-backgrounding'])assert(args.includes(flag),flag);
 assert(!browserArgs({profileDir:'p',headed:true,viewport:{width:1,height:1}}).includes('--headless=new'));
});

test('page instrumentation parses, returns what WebAssembly returns and records each phase',async()=>{
 for(const source of [probeSource({wasmTiming:'split'}),probeSource({wasmTiming:'observe'}),collectSource({frameWindowMs:1000})])assert.doesNotThrow(()=>new Function(source));
 // Run the probe against a stand-in WebAssembly in a sandbox window.
 const calls=[],module={},instance={};
 class Module{}
 const W={Module,compileStreaming:async()=>{calls.push('compileStreaming');return module;},instantiate:async(source)=>{calls.push(source===module?'instantiate(module)':'instantiate(bytes)');return source===module?instance:{module,instance};},compile:async()=>{calls.push('compile');return module;},instantiateStreaming:async()=>{calls.push('instantiateStreaming');return {module,instance};}};
 const sandbox={performance:{now:(()=>{let t=0;return ()=>t+=5;})()},document:{visibilityState:'visible',hasFocus:()=>true,addEventListener(){}},addEventListener(){},WebAssembly:W,ArrayBuffer};
 sandbox.window=sandbox;sandbox.window.top=sandbox;
 new Function('window','performance','document','addEventListener','WebAssembly','ArrayBuffer','with(window){'+probeSource({wasmTiming:'split'})+'}')(sandbox,sandbox.performance,sandbox.document,sandbox.addEventListener,W,ArrayBuffer);
 const result=await W.instantiateStreaming({},{env:{}});
 assert.equal(result.instance,instance);assert.equal(result.module,module);assert.deepEqual(calls,['compileStreaming','instantiate(module)'],'split does exactly compileStreaming then instantiate');
 const row=sandbox.__unoneMeasure.wasm[0];assert.equal(row.api,'instantiateStreaming');assert.equal(row.status,'ok');assert(row.compiled_ms>row.start_ms&&row.end_ms>row.compiled_ms);
});

test('the server serves the blank control page beside the export, uncached, without touching the export',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'unone-blank-'));
 const server=await startServer(root,{});
 try{
  const response=await fetch(new URL('/__unone_measure/blank.html',server.url));
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.match(await response.text(),/requestAnimationFrame/);
  assert.deepEqual(server.take().map(row=>[row.path,row.status]),[['/__unone_measure/blank.html',200]]);
 }finally{await server.close();await rm(root,{recursive:true,force:true});}
});
