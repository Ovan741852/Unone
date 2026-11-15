import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseArgs,quantiles,summarize,pairDeltas,resourceRow,joinNetwork,startupSteps,normalizeLoad,readExport,startServer,cacheControlFor,browserArgs,probeSource,collectSource,buildReport,shiftInput,profileMissing,pageWithoutQuery,measuredUrl,SCHEMA,
 parseAttach,listTargets,pickPageTarget,findAdb,parseDevtoolsSockets,chooseSocket,parseGetprop,parseWebViewProvider,deviceInfo,adbConnect,attachedOsMemory,touchCondition} from './measure-web-export.mjs';

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

test('--url measures a page the caller serves; --export still names the export it serves',()=>{
 const options=parseArgs(['--export','e','--output','r.json','--url','http://127.0.0.1:8080/harness.html?room=1']);
 assert.equal(options.url,'http://127.0.0.1:8080/harness.html?room=1');
 assert.equal(parseArgs(['--export','e','--output','r.json']).url,null);
 assert.throws(()=>parseArgs(['--export','e','--output','r.json','--url','file:///c:/x/index.html']),/MEASURE_ARG_INVALID: --url/);
 assert.throws(()=>parseArgs(['--export','e','--output','r.json','--url','not a url']),/MEASURE_ARG_INVALID: --url/);
 assert.throws(()=>parseArgs(['--output','r.json','--url','http://127.0.0.1/']),/--export and --output are required/);
 assert.throws(()=>parseArgs(['--export','e','--output','r.json','--url','http://127.0.0.1/','--compress','gzip']),/with --url the page/);
 assert.throws(()=>parseArgs(['--export','e','--output','r.json','--url','http://127.0.0.1/','--cache-control','no-store']),/with --url the page/);
 // The tool's own query rides on the page's; the report drops the page's query.
 const url=new URL(measuredUrl(options.url,{seed:'7',backend:null},true,2048));
 assert.equal(url.searchParams.get('room'),'1');assert.equal(url.searchParams.get('seed'),'7');
 assert.equal(url.searchParams.get('unone_profile'),'1');assert.equal(url.searchParams.get('unone_profile_limit'),'2048');
 assert.equal(pageWithoutQuery('http://127.0.0.1:8080/harness.html?token=secret#x'),'http://127.0.0.1:8080/harness.html');
});

test('an embedding page is instrumented in every frame; an export page only in its top frame',()=>{
 const install=embedded=>{
  const sandbox={performance:{now:()=>1},document:{visibilityState:'visible',hasFocus:()=>true,addEventListener(){}},addEventListener(){},WebAssembly:{},ArrayBuffer};
  sandbox.window=sandbox;sandbox.window.top={};
  new Function('window','performance','document','addEventListener','WebAssembly','ArrayBuffer','with(window){'+probeSource({embedded})+'}')(sandbox,sandbox.performance,sandbox.document,sandbox.addEventListener,sandbox.WebAssembly,ArrayBuffer);
  return Boolean(sandbox.__unoneMeasure);
 };
 assert.equal(install(false),false);assert.equal(install(true),true);
});

test('pointer input moves by the player iframe origin; keys and a page-level player do not move',()=>{
 const offset={x:40,y:25};
 assert.deepEqual(shiftInput('Input.dispatchMouseEvent',{type:'mouseMoved',x:10,y:20,button:'none'},offset),{type:'mouseMoved',x:50,y:45,button:'none'});
 assert.deepEqual(shiftInput('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:1,y:2,id:0}]},offset),{type:'touchStart',touchPoints:[{x:41,y:27,id:0}]});
 const key={type:'keyDown',key:'a'};assert.equal(shiftInput('Input.dispatchKeyEvent',key,offset),key);
 const move={type:'mouseMoved',x:3,y:4};assert.equal(shiftInput('Input.dispatchMouseEvent',move,{x:0,y:0}),move);assert.equal(shiftInput('Input.dispatchMouseEvent',move,null),move);
});

test('a profiler run whose player reports no profiler fails, naming the page when it embeds the player',()=>{
 assert.equal(profileMissing({profile:{events:[]}},{profiling:true,embedded:true}),null);
 assert.equal(profileMissing({profile:null},{profiling:false,embedded:true}),null);
 assert.equal(profileMissing(null,{profiling:true,embedded:true}),null,'a failed load reports its own error');
 assert.match(profileMissing({profile:null},{profiling:true,embedded:true}),/MEASURE_PROFILE_NOT_ENABLED: .*pass \?unone_profile/);
 assert.doesNotMatch(profileMissing({profile:null},{profiling:true,embedded:false}),/page must/);
});

test('--attach takes over a running browser: nothing cold, the device viewport, no launch flags',()=>{
 const options=parseArgs(['--export','e','--output','r.json','--attach','http://127.0.0.1:9222']);
 assert.deepEqual(options.attach,{http:'http://127.0.0.1:9222/',ws:null,kind:null,targetId:null});
 assert.equal(options.cold,0,'an attached browser has no cold runs');assert.equal(options.warm,5);
 assert.equal(options.viewport,null,'the device keeps its own viewport');assert.equal(options.dpr,null);
 const forced=parseArgs(['--export','e','--output','r.json','--attach','http://127.0.0.1:9222','--viewport','926x428','--dpr','3','--attach-target','game']);
 assert.deepEqual(forced.viewport,{width:926,height:428});assert.equal(forced.dpr,3);assert.equal(forced.attachTarget,'game');
 const adb=parseArgs(['--export','e','--output','r.json','--adb-socket','package:dev.koncrate.viewer.test','--adb-serial','127.0.0.1:5555','--scenario','s.json']);
 assert.equal(adb.adbSocket,'package:dev.koncrate.viewer.test');assert.equal(adb.cold,0);assert.equal(adb.scenarioRuns,1);
 assert.equal(parseArgs(['--export','e','--output','r','--serve-port','8765']).servePort,8765);
 for(const [argv,pattern] of [
  [['--attach','http://127.0.0.1:9222','--cold','2'],/a cold run is a new browser process/],
  [['--attach','http://127.0.0.1:9222','--browser','x.exe'],/already running/],
  [['--attach','http://127.0.0.1:9222','--headed'],/already running/],
  [['--attach-target','x'],/picks a page of an attached browser/],
  [['--attach','http://127.0.0.1:9222','--adb-socket','auto'],/not both/],
  [['--adb-serial','emulator-5554'],/only go with --adb-socket/],
  [['--adb-socket','rm -rf'],/--adb-socket is auto/],
  [['--serve-port','80'],/--serve-port/],
  [['--device-label','a\u0007b'],/--device-label/],
 ])assert.throws(()=>parseArgs(['--export','e','--output','r',...argv]),pattern,argv.join(' '));
 assert.equal(parseArgs(['--export','e','--output','r','--attach','http://127.0.0.1:9222','--cold','0']).cold,0,'an explicit --cold 0 is fine');
});

test('an attach endpoint is the DevTools HTTP root or a browser or page WebSocket',()=>{
 assert.deepEqual(parseAttach('http://127.0.0.1:9222/json/version'),{http:'http://127.0.0.1:9222/',ws:null,kind:null,targetId:null});
 assert.deepEqual(parseAttach('ws://127.0.0.1:9222/devtools/browser/abc'),{http:'http://127.0.0.1:9222/',ws:'ws://127.0.0.1:9222/devtools/browser/abc',kind:'browser',targetId:null});
 assert.deepEqual(parseAttach('ws://127.0.0.1:9222/devtools/browser'),{http:'http://127.0.0.1:9222/',ws:'ws://127.0.0.1:9222/devtools/browser',kind:'browser',targetId:null},'Android names its browser endpoint without an id');
 assert.equal(parseAttach('ws://localhost:9222/devtools/page/E1F2').targetId,'E1F2');
 for(const value of ['localhost:9222','https://example.com/','http://127.0.0.1:9222/somewhere','ws://127.0.0.1:9222/devtools/page','ws://127.0.0.1:9222/other','http://127.0.0.1:9222/?x=1'])
  assert.throws(()=>parseAttach(value),/MEASURE_ARG_INVALID: --attach/,value);
});

test('the page to take over: the --attach-target match, the only page, or the only visible WebView',()=>{
 const list=listTargets([
  {id:'A',type:'page',url:'https://appassets.androidplatform.net/workspace/index.html?session=secret',title:'Workspace',description:'{"attached":true,"empty":false,"height":1980,"screenX":0,"screenY":0,"visible":false,"width":1080}',webSocketDebuggerUrl:'ws://127.0.0.1:9222/devtools/page/A'},
  {id:'B',type:'page',url:'http://127.0.0.1:8765/?seed=42',title:'Unone',description:'{"attached":true,"visible":true,"width":1080,"height":1980}'},
  {id:'W',type:'service_worker',url:'http://127.0.0.1:8765/sw.js',title:'',description:''}]);
 assert.deepEqual(list[0].size,{width:1080,height:1980});assert.equal(list[0].visible,false);assert.equal(list[1].webSocketDebuggerUrl,null,'a page another client holds has no WebSocket');
 assert.equal(list[2].visible,null,'no description, no claim');
 const visible=pickPageTarget(list);assert.equal(visible.id,'B');assert.equal(visible.selected_by,'the only visible page');
 assert.equal(pickPageTarget(list,'Workspace').id,'A');assert.equal(pickPageTarget(list,'Workspace').selected_by,'--attach-target');
 assert.equal(pickPageTarget([{id:'only',type:'page',url:'about:blank',title:''}]).selected_by,'the only page');
 const both=list.map(t=>({...t,visible:null}));
 assert.throws(()=>pickPageTarget(both),error=>/MEASURE_ATTACH_AMBIGUOUS: 2 pages/.test(error.message)&&!error.message.includes('secret'),'pages are listed without their query');
 assert.throws(()=>pickPageTarget(list,'nothing'),/MEASURE_ATTACH_NO_PAGE: no page's URL or title contains "nothing"/);
 assert.throws(()=>pickPageTarget([list[2]]),/MEASURE_ATTACH_NO_PAGE: the attached browser shows no page/);
});

const PROC_NET_UNIX=['Num       RefCount Protocol Flags    Type St Inode Path',
 '0000000000000000: 00000002 00000000 00010000 0001 01 23456 @webview_devtools_remote_4321',
 '0000000000000000: 00000003 00000000 00000000 0001 03 23460 @webview_devtools_remote_4321',
 '0000000000000000: 00000002 00000000 00010000 0001 01 23457 @chrome_devtools_remote',
 '0000000000000000: 00000002 00000000 00010000 0001 01 1234 /dev/socket/zygote',
 '0000000000000000: 00000002 00000000 00010000 0001 01 1235 @jdwp-control',''].join('\n');

test('DevTools sockets on the device and which one --adb-socket means',()=>{
 const sockets=parseDevtoolsSockets(PROC_NET_UNIX.replace(/\n/g,'\r\n'));
 assert.deepEqual(sockets,[{socket:'webview_devtools_remote_4321',kind:'webview',pid:4321},{socket:'chrome_devtools_remote',kind:'chrome',pid:null}]);
 const packageOf=new Map([[4321,'dev.koncrate.viewer.test']]);
 assert.equal(chooseSocket(sockets,'package:dev.koncrate.viewer.test',{pids:[4321],packageOf}).socket,'webview_devtools_remote_4321');
 assert.equal(chooseSocket(sockets,'chrome_devtools_remote').kind,'chrome');
 assert.equal(chooseSocket([sockets[0]],'auto').pid,4321);
 assert.throws(()=>chooseSocket(sockets,'auto',{packageOf}),/MEASURE_ADB_AMBIGUOUS: 2 DevTools sockets \(webview_devtools_remote_4321 \(dev.koncrate.viewer.test\), chrome_devtools_remote\)/);
 assert.throws(()=>chooseSocket(sockets,'package:com.example.game',{pids:[999]}),/com.example.game is running but has no WebView DevTools socket: its WebView debugging is off/);
 assert.throws(()=>chooseSocket(sockets,'package:com.example.game',{pids:[]}),/com.example.game is not running/);
 assert.throws(()=>chooseSocket([],'auto'),/no app on the device has a DevTools socket open \(sockets: none\)/);
 assert.throws(()=>chooseSocket(sockets,'webview_devtools_remote_1'),/there is no socket named webview_devtools_remote_1/);
});

test('the device record keeps build properties and emulator markers, never serials or identifiers',()=>{
 const props=parseGetprop(['[ro.product.manufacturer]: [samsung]','[ro.product.model]: [SM-S942N]','[ro.build.version.release]: [16]','[ro.build.version.sdk]: [36]','[ro.build.type]: [user]',
  '[ro.serialno]: [R5CT0000000]','[ro.boot.qemu]: [1]','[ro.kernel.qemu]: [0]','[ro.hardware]: [ranchu]','[ro.bst.instance.id]: [889889d4]','[ro.bst.version]: [16.0.0.29]','[persist.sys.timezone]: [Asia/Taipei]'].join('\r\n'));
 assert.equal(props['ro.product.model'],'SM-S942N');
 const device=deviceInfo(props);
 assert.equal(device.manufacturer,'samsung');assert.equal(device.android_release,'16');assert.equal(device.sdk,'36');assert.equal(device.build_type,'user');assert.equal(device.brand,null);
 assert.equal(device.emulator,true,'a phone model with emulator properties is an emulator');
 assert.deepEqual(device.emulator_markers.map(m=>m.key).sort(),['ro.boot.qemu','ro.bst.instance.id','ro.bst.version','ro.hardware']);
 assert.equal(device.emulator_markers.find(m=>m.key==='ro.bst.instance.id').value,'(identifier not recorded)');
 assert(!JSON.stringify(device).includes('R5CT0000000'),'no serial number');assert(!JSON.stringify(device).includes('Taipei'));
 assert.equal(deviceInfo(parseGetprop('[ro.product.model]: [Pixel 9]\n[ro.hardware]: [tensor]\n[init.svc.tombstoned]: [running]')).emulator,null,'no marker is unknown, not "a phone"');
 // What BlueStacks 16 actually reports: a Samsung model and qcom hardware, with its services and EGL giving it away.
 const bluestacks=deviceInfo(parseGetprop(['[ro.product.manufacturer]: [samsung]','[ro.product.model]: [SM-S942B]','[ro.hardware]: [qcom]','[ro.product.cpu.abi]: [x86_64]',
  '[init.svc.bstsvcmgrtest]: [running]','[init.svc.vendor.RTVboxGuestService]: [running]','[ro.hardware.egl]: [emulation]','[init.svc.tombstoned]: [running]'].join('\n')));
 assert.equal(bluestacks.emulator,true);assert.deepEqual(bluestacks.emulator_markers.map(m=>m.key).sort(),['init.svc.bstsvcmgrtest','init.svc.vendor.RTVboxGuestService','ro.hardware.egl']);
 assert.deepEqual(parseWebViewProvider('Current WebView package (name, version): (com.google.android.webview, 141.0.7390.122)\nPreferred'),{package:'com.google.android.webview',version:'141.0.7390.122'});
 assert.equal(parseWebViewProvider('nothing here'),null);
});

test('adb: forwards the WebView socket, lets the device reach the server, and removes both afterwards',async()=>{
 const calls=[],out={'get-state':'device\n','shell cat /proc/net/unix':PROC_NET_UNIX,'shell cat /proc/4321/cmdline':'dev.koncrate.viewer.test\0','shell pidof dev.koncrate.viewer.test':'4321\n',
  'shell getprop':'[ro.product.model]: [SM-S942N]\n[ro.bst.version]: [16.0.0.29]\n','shell dumpsys webviewupdate':'Current WebView package (name, version): (com.google.android.webview, 141.0.1)'};
 const run=async(command,args)=>{calls.push([command,...args].join(' '));const key=args.slice(2).join(' ');if(key in out)return out[key];if(/^(forward|reverse)/.test(key))return '';throw Error(`unexpected ${key}`);};
 const session=await adbConnect({adb:null,adbSerial:'127.0.0.1:5555',adbSocket:'package:dev.koncrate.viewer.test'},{serverPort:8765,run,freePort:async()=>61234});
 assert.deepEqual(session.endpoint,{http:'http://127.0.0.1:61234/',ws:null,kind:null,targetId:null});
 assert.equal(session.via.package,'dev.koncrate.viewer.test');assert.equal(session.via.socket,'webview_devtools_remote_4321');
 assert.equal(session.device.model,'SM-S942N');assert.equal(session.device.emulator,true);assert.deepEqual(session.device.webview_provider,{package:'com.google.android.webview',version:'141.0.1'});
 assert(calls.every(call=>call.includes(' -s 127.0.0.1:5555 ')),'every call names the device');
 assert(calls.some(call=>call.endsWith(' forward tcp:61234 localabstract:webview_devtools_remote_4321')));
 assert(calls.some(call=>call.endsWith(' reverse tcp:8765 tcp:8765')));
 calls.length=0;await session.close();
 assert.deepEqual(calls.map(call=>call.split(' -s 127.0.0.1:5555 ')[1]),['reverse --remove tcp:8765','forward --remove tcp:61234']);
 calls.length=0;await session.close();assert.equal(calls.length,0,'closing twice removes nothing twice');
 // A failed reverse takes the forward back with it.
 const failing=async(command,args)=>{if(args[2]==='reverse'&&args[3]!=='--remove'){calls.push(args.slice(2).join(' '));throw Error('exit 1: error: closed');}return run(command,args);};
 calls.length=0;await assert.rejects(adbConnect({adbSerial:'127.0.0.1:5555',adbSocket:'webview_devtools_remote_4321'},{serverPort:8765,run:failing,freePort:async()=>61235}),/MEASURE_ADB_FAILED: adb reverse tcp:8765 tcp:8765: exit 1: error: closed/);
 assert(calls.at(-1).endsWith(' forward --remove tcp:61235'));
 await assert.rejects(adbConnect({adbSocket:'auto'},{run:async()=>'unauthorized\n'}),/MEASURE_ADB_NO_DEVICE: adb get-state says "unauthorized"/);
 await assert.rejects(adbConnect({adbSocket:'auto'},{run:async()=>{throw Object.assign(Error('spawn adb ENOENT'),{code:'ENOENT'});}}),/MEASURE_ADB_MISSING: .*--adb <path to adb>/);
});

test('adb is found from --adb, UNONE_ADB_PATH or an SDK, else PATH',()=>{
 const sdkAdb=path.join('C:/sdk','platform-tools','adb.exe');
 assert.equal(findAdb(null,{env:{ANDROID_HOME:'C:/sdk'},exists:file=>file===sdkAdb,platform:'win32',home:'C:/home'}),sdkAdb);
 assert.equal(findAdb(null,{env:{UNONE_ADB_PATH:'D:/bs/HD-Adb.exe'},exists:()=>true,platform:'win32',home:'C:/home'}),'D:/bs/HD-Adb.exe');
 assert.equal(findAdb(null,{env:{},exists:()=>false,platform:'linux',home:'/home/u'}),'adb');
 assert.throws(()=>findAdb('Z:/missing/adb.exe',{exists:()=>false}),/MEASURE_ADB_MISSING: Z:\/missing\/adb.exe does not exist/);
});

test('report: an attached run says what was measured where, without host OS memory or cold runs',()=>{
 const options=parseArgs(['--export','e','--output','r','--adb-socket','auto','--scenario','s.json','--device-label','BlueStacks emulator on this PC (not a phone, not 4G)']);
 const exported={development:false,artifact:{cache_policy:null},engine:{},execution:{}};
 const browserInfo={browser:{product:'Chrome/141',attached:{endpoint:'http://127.0.0.1:61234/',via:{tool:'adb'}}},device:{label:options.deviceLabel,reported:{model:'SM-S942N',emulator:true}}};
 const scenarioRuns=[{index:1,profiling:false,ok:true,touch:{emulated:false,max_touch_points:10},phases:[]}];
 const report=buildReport({options,exported,runs:[],pairs:[],browserInfo,scenario:{file:{},definition:{sample_ms:250,settle_ms:0,phases:[{kind:'frames',name:'f',setup:[],loop:[{kind:'pinch'}]}]}},scenarioRuns,createdAt:'2026-11-15T00:00:00Z'});
 assert.equal(report.environment.device.label,'BlueStacks emulator on this PC (not a phone, not 4G)');assert.equal(report.environment.device.reported.emulator,true);
 assert.equal(report.conditions.viewport,null);assert.equal(report.conditions.viewport_overridden,false);assert.match(report.conditions.viewport_note,/own viewport/);
 assert.match(report.conditions.cold,/^none/);assert.equal(report.coverage.cold.requested,0);
 assert.match(report.conditions.network.note,/adb reverse/);
 assert.match(report.scenario.conditions.os_memory,/^not read/);assert.match(report.scenario.conditions.browser,/attached browser/);
 assert.match(report.scenario.conditions.touch_emulation,/^not emulated: the attached browser reports 10 touch points/);
 assert(report.notes.some(note=>/environment\.os is the machine that ran this tool/.test(note)));
 assert.equal(attachedOsMemory().supported,false);assert.match(attachedOsMemory().error,/^MEASURE_OS_MEMORY_UNAVAILABLE/);
 assert.match(touchCondition([{touch:{emulated:true,max_touch_points:0}}],true),/reported no touch points/);
 assert.match(touchCondition([],false),/touch emulation with 5 points from before the game loads/);
});
