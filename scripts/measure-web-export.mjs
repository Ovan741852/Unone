// Measure one production Web export in a real headless browser, the same way every time.
//
//   node scripts/measure-web-export.mjs --export <export dir> --output <report.json>
//        [--cold 5] [--warm 5] [--profile-pairs 1] [--milestone city.interactive] ...
//   node scripts/measure-web-export.mjs --export <export dir> --output <report.json> --scenario <scenario.json>
//
// Each cold run is a new browser process with a new profile (empty HTTP and code caches); warm runs
// share one browser whose caches a first, unreported load primed. Profiler pairs load the same export
// warm with ?unone_profile=1 and without it, alternating which goes first. The report keeps every raw
// sample beside median/p95 across runs. Times are milliseconds relative to window.playerBoot (the
// export's index.html sets it before any module loads); a value the browser does not expose is null,
// never a guess, and quantiles taken at different times are never added together.
//
// The tool reads the player's existing accessors (body.dataset.playerMetrics and playerStartup,
// unonePlayerPerformance, unonePlayerAssets, unonePlayerProfile) and Resource Timing. It adds timing
// wrappers around WebAssembly compile/instantiate and FontFace.load, a longtask observer, and the
// browser's own network log (Chrome DevTools Protocol) for what came from cache. It needs Node 22+ and
// Edge or Chrome; it starts the browser muted and closes it when done. No dependencies.
//
// --scenario runs a scripted scenario (measure-web-scenario.mjs) in a fresh browser per run: the game's
// screens driven by real key and tap input, with memory owners, heap and browser processes sampled per
// round; see docs/profiling.md.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import {parseScenario,runScenario,readProcessMemory,measureBlank,flattenFrames,BLANK_PATH,BLANK_HTML} from './measure-web-scenario.mjs';

export const SCHEMA='unone.web-export-measurement.v1';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const round=n=>finite(n)?Math.round(n*1000)/1000:null;
const minus=(a,b)=>finite(a)&&finite(b)?round(a-b):null;

// ---------------------------------------------------------------- options

const DEFAULTS=Object.freeze({cold:5,warm:5,profilePairs:1,milestones:[],settleMs:1000,frameWindowMs:1000,timeoutMs:60000,
 viewport:{width:1280,height:720},dpr:1,seed:'42',backend:null,cacheControl:null,compress:'none',network:null,cpuThrottle:1,
 browser:null,headed:false,keepStorage:false,allowDevelopment:false,wasmTiming:'split',includeProfileEvents:false,pollMs:100,scenario:null,scenarioRuns:1,scenarioProfile:false,blankControl:true});
const NETWORK_PRESETS=Object.freeze({
 // Chrome DevTools' own throttling presets; emulated in the browser, not a real radio network.
 'fast-4g':{latency_ms:60,download_kbps:9000,upload_kbps:1500},
 'slow-4g':{latency_ms:150,download_kbps:1600,upload_kbps:750},
 'fast-3g':{latency_ms:150,download_kbps:1600*0.9,upload_kbps:750*0.9},
});
export const USAGE=`Usage: node scripts/measure-web-export.mjs --export <production export dir> --output <report.json>
  [--cold N=5] [--warm N=5] [--profile-pairs N=1] [--milestone NAME]... [--settle-ms 1000]
  [--frame-window-ms 1000] [--timeout-ms 60000] [--viewport 1280x720] [--dpr 1] [--seed 42]
  [--backend main|worker] [--cache-control VALUE] [--compress none|gzip]
  [--network fast-4g|slow-4g|fast-3g|LATENCY_MS,DOWN_KBPS,UP_KBPS] [--cpu-throttle RATE]
  [--browser PATH] [--headed] [--keep-storage] [--allow-development] [--wasm-timing split|observe]
  [--include-profile-events] [--scenario FILE] [--scenario-runs N=1] [--scenario-profile] [--no-blank-control]
  With --scenario, cold, warm and profiler pairs default to 0 unless given.`;

export function parseArgs(argv){
 const options={...DEFAULTS,milestones:[]},given=new Set(),take=(i,name)=>{const value=argv[i+1];if(value===undefined||value.startsWith('--'))throw Error(`MEASURE_ARG_INVALID: ${name} needs a value`);return value;};
 const count=(value,name,min=0)=>{const n=Number(value);if(!Number.isInteger(n)||n<min||n>100)throw Error(`MEASURE_ARG_INVALID: ${name} must be an integer ${min}..100`);return n;};
 const ms=(value,name)=>{const n=Number(value);if(!Number.isInteger(n)||n<0||n>600000)throw Error(`MEASURE_ARG_INVALID: ${name} must be whole milliseconds 0..600000`);return n;};
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];
  switch(arg){
   case '--export':options.export=take(i,arg);i++;break;
   case '--output':options.output=take(i,arg);i++;break;
   case '--cold':options.cold=count(take(i,arg),arg);given.add(arg);i++;break;
   case '--warm':options.warm=count(take(i,arg),arg);given.add(arg);i++;break;
   case '--profile-pairs':options.profilePairs=count(take(i,arg),arg);given.add(arg);i++;break;
   case '--scenario':options.scenario=take(i,arg);i++;break;
   case '--scenario-runs':options.scenarioRuns=count(take(i,arg),arg,1);i++;break;
   case '--scenario-profile':options.scenarioProfile=true;break;
   case '--no-blank-control':options.blankControl=false;break;
   case '--milestone':{const name=take(i,arg);if(name.length<1||name.length>64||/[\u0000-\u001f\u007f]/.test(name))throw Error('MEASURE_ARG_INVALID: --milestone must be 1-64 printable characters, the name the game passes to api.profile.mark');options.milestones.push(name);i++;break;}
   case '--settle-ms':options.settleMs=ms(take(i,arg),arg);i++;break;
   case '--frame-window-ms':{const n=ms(take(i,arg),arg);if(n<1||n>60000)throw Error('MEASURE_ARG_INVALID: --frame-window-ms must be 1..60000 (the player accessor limit)');options.frameWindowMs=n;i++;break;}
   case '--timeout-ms':options.timeoutMs=ms(take(i,arg),arg);i++;break;
   case '--viewport':{const match=/^(\d{2,5})x(\d{2,5})$/.exec(take(i,arg));if(!match)throw Error('MEASURE_ARG_INVALID: --viewport is WIDTHxHEIGHT in CSS pixels, e.g. 926x428');options.viewport={width:Number(match[1]),height:Number(match[2])};i++;break;}
   case '--dpr':{const n=Number(take(i,arg));if(!finite(n)||n<=0||n>8)throw Error('MEASURE_ARG_INVALID: --dpr must be in (0,8]');options.dpr=n;i++;break;}
   case '--seed':{const value=take(i,arg);if(!/^\d{1,20}$/.test(value)||BigInt(value)>18446744073709551615n)throw Error('MEASURE_ARG_INVALID: --seed is an unsigned 64-bit integer');options.seed=value;i++;break;}
   case '--backend':{const value=take(i,arg);if(!['main','worker'].includes(value))throw Error('MEASURE_ARG_INVALID: --backend is main or worker');options.backend=value;i++;break;}
   case '--cache-control':options.cacheControl=take(i,arg);i++;break;
   case '--compress':{const value=take(i,arg);if(!['none','gzip'].includes(value))throw Error('MEASURE_ARG_INVALID: --compress is none or gzip');options.compress=value;i++;break;}
   case '--network':options.network=parseNetwork(take(i,arg));i++;break;
   case '--cpu-throttle':{const n=Number(take(i,arg));if(!finite(n)||n<1||n>20)throw Error('MEASURE_ARG_INVALID: --cpu-throttle must be 1..20');options.cpuThrottle=n;i++;break;}
   case '--browser':options.browser=take(i,arg);i++;break;
   case '--headed':options.headed=true;break;
   case '--keep-storage':options.keepStorage=true;break;
   case '--allow-development':options.allowDevelopment=true;break;
   case '--wasm-timing':{const value=take(i,arg);if(!['split','observe'].includes(value))throw Error('MEASURE_ARG_INVALID: --wasm-timing is split or observe');options.wasmTiming=value;i++;break;}
   case '--include-profile-events':options.includeProfileEvents=true;break;
   case '--help':case '-h':options.help=true;break;
   default:throw Error(`MEASURE_ARG_UNKNOWN: ${arg}`);
  }
 }
 if(options.help)return options;
 if(!options.export||!options.output)throw Error('MEASURE_ARG_INVALID: --export and --output are required');
 // A scenario is minutes of memory sampling; startup runs come along only when asked for.
 if(options.scenario){if(!given.has('--cold'))options.cold=0;if(!given.has('--warm'))options.warm=0;if(!given.has('--profile-pairs'))options.profilePairs=0;}
 else options.scenarioRuns=0;
 if(options.cold+options.warm+options.profilePairs+options.scenarioRuns===0)throw Error('MEASURE_ARG_INVALID: nothing to measure');
 return options;
}

export function parseNetwork(value){
 if(Object.hasOwn(NETWORK_PRESETS,value))return {preset:value,...NETWORK_PRESETS[value]};
 const parts=value.split(',').map(Number);
 if(parts.length!==3||!parts.every(n=>finite(n)&&n>=0))throw Error('MEASURE_ARG_INVALID: --network is a preset (fast-4g, slow-4g, fast-3g) or LATENCY_MS,DOWN_KBPS,UP_KBPS');
 return {preset:null,latency_ms:parts[0],download_kbps:parts[1],upload_kbps:parts[2]};
}

// ---------------------------------------------------------------- statistics

// Median (middle, or mean of the two middles) and nearest-rank p95 over one kind of sample taken at
// the same point in comparable runs. With five samples the p95 is the largest one.
export function quantiles(values){
 const xs=values.filter(finite).sort((a,b)=>a-b),n=xs.length;
 if(!n)return {n:0,nulls:values.length,median:null,p95:null,min:null,max:null};
 const median=n%2?xs[(n-1)/2]:(xs[n/2-1]+xs[n/2])/2;
 return {n,nulls:values.length-n,median:round(median),p95:round(xs[Math.ceil(n*0.95)-1]),min:round(xs[0]),max:round(xs[n-1])};
}

export function summarize(samples){
 const names=new Set();for(const sample of samples)for(const name of Object.keys(sample.metrics??{}))names.add(name);
 const out={};for(const name of [...names].sort())out[name]=quantiles(samples.map(sample=>sample.metrics?.[name]??null));
 return out;
}

// For each metric present in both runs of a pair: on minus off, and the median of those differences.
export function pairDeltas(pairs){
 const names=new Set();for(const pair of pairs)for(const name of Object.keys(pair.off?.metrics??{}))if(Object.hasOwn(pair.on?.metrics??{},name))names.add(name);
 const out={};
 for(const name of [...names].sort()){
  const deltas=pairs.map(pair=>minus(pair.on?.metrics?.[name],pair.off?.metrics?.[name]));
  out[name]={off:quantiles(pairs.map(pair=>pair.off?.metrics?.[name]??null)),on:quantiles(pairs.map(pair=>pair.on?.metrics?.[name]??null)),on_minus_off:quantiles(deltas)};
 }
 return out;
}

// ---------------------------------------------------------------- normalizing one load

const pathOf=url=>{try{return decodeURIComponent(new URL(url).pathname);}catch{return String(url);}};

// One Resource Timing entry joined with the browser's network log. Sizes are null when the browser
// hides them (a cross-origin or opaque-origin response without Timing-Allow-Origin reports zero for
// every size): a zero transferSize is a cache hit only when the sizes are visible at all.
export function resourceRow(entry,network,boot){
 const sizesVisible=!(entry.transferSize===0&&entry.encodedBodySize===0&&entry.decodedBodySize===0);
 const detailVisible=!(entry.requestStart===0&&entry.responseStart===0&&entry.startTime>0);
 const at=value=>detailVisible&&finite(value)&&value>0?minus(value,boot):null;
 let cache=null,cacheSource=null;
 if(network){
  cacheSource='browser_network_log';
  cache=network.failed?'failed':network.fromServiceWorker?'service_worker':network.fromPrefetchCache?'prefetch_cache':network.fromDiskCache?'disk_cache':network.servedFromCache?'memory_cache':network.status===304?'revalidated':'network';
 }
 const pageHint=!sizesVisible?null:entry.transferSize===0?'local_cache':'network';
 return {path:pathOf(entry.name),initiator_type:entry.initiatorType??null,status:network?.status??(finite(entry.responseStatus)&&entry.responseStatus>0?entry.responseStatus:null),
  protocol:entry.nextHopProtocol||network?.protocol||null,start_ms:minus(entry.startTime,boot),request_start_ms:at(entry.requestStart),response_start_ms:at(entry.responseStart),
  response_end_ms:minus(entry.responseEnd,boot),duration_ms:round(entry.duration),
  transfer_bytes:sizesVisible?entry.transferSize:null,encoded_bytes:sizesVisible?entry.encodedBodySize:null,decoded_bytes:sizesVisible?entry.decodedBodySize:null,
  network_bytes:finite(network?.encodedDataLength)?network.encodedDataLength:null,sizes_visible:sizesVisible,timing_detail_visible:detailVisible,
  cache,cache_source:cacheSource,page_cache_hint:pageHint,render_blocking:entry.renderBlockingStatus??null,mime_type:network?.mimeType??null};
}

// Join Resource Timing entries to network log rows by URL, in request order.
export function joinNetwork(entries,networkRows){
 const byUrl=new Map();for(const row of networkRows){const list=byUrl.get(row.url)??[];list.push(row);byUrl.set(row.url,list);}
 return entries.map(entry=>{const list=byUrl.get(entry.name);return list?.length?list.shift():null;});
}

// Startup steps from the player's own startup screen report: when each began and completed,
// relative to playerBoot. The 'player' step (fetching and evaluating the module graph) runs from boot.
export function startupSteps(report){
 if(!report||!Array.isArray(report.steps))return [];
 return report.steps.map(step=>{const started=finite(step.started_ms)?step.started_ms:step.id==='player'&&finite(step.ms)?0:null,completed=finite(step.ms)?step.ms:null;
  return {id:step.id,state:step.state,started_ms:started,completed_ms:completed,duration_ms:minus(completed,started),...(finite(step.total)?{done:step.done,total:step.total}:{})};});
}

const kindOf=row=>{const p=row.path.toLowerCase();return p.endsWith('.wasm')?'wasm':/\.(m?js)$/.test(p)?'javascript':/\.(ttf|otf|woff2?)$/.test(p)?'font':/\.(png|jpe?g|webp|gif|avif|svg)$/.test(p)?'image':/\.json$/.test(p)?'json':/\.(ogg|mp3|wav|m4a)$/.test(p)?'audio':p.endsWith('/')||p.endsWith('.html')?'document':'other';};
// A player interval distribution with its timestamps moved to the playerBoot clock and values rounded.
export function fromBoot(distribution,boot){
 if(!distribution||typeof distribution!=='object')return null;
 const out={};for(const [key,value] of Object.entries(distribution))out[key]=/(^|_)(start|end)_ms$/.test(key)?minus(value,boot):finite(value)?round(value):value;
 return out;
}
const sumOrNull=values=>values.length&&values.every(finite)?values.reduce((a,b)=>a+b,0):null;
const maxOrNull=values=>{const xs=values.filter(finite);return xs.length?round(Math.max(...xs)):null;};

// Everything one load produced, raw page values in, boot-relative sample out.
export function normalizeLoad(raw,{network=[],server=[],options={},kind,index,profiling,url}){
 const boot=finite(raw?.boot)?raw.boot:null;
 const entries=Array.isArray(raw?.resources)?raw.resources:[];
 const joined=joinNetwork(entries,network),resources=entries.map((entry,i)=>resourceRow(entry,joined[i],boot));
 for(const row of resources)row.kind=kindOf(row);
 const steps=startupSteps(raw?.startup);
 const step=id=>steps.find(row=>row.id===id)??null;
 const metrics=raw?.metrics??null;
 const wasmResource=resources.find(row=>row.kind==='wasm')??null;
 const wasmCalls=(raw?.probe?.wasm??[]).map(call=>({api:call.api,split:call.split===true,status:call.status,start_ms:minus(call.start_ms,boot),compiled_ms:minus(call.compiled_ms,boot),end_ms:minus(call.end_ms,boot),bytes:finite(call.bytes)?call.bytes:null}));
 const mainWasm=wasmCalls.find(call=>call.api==='instantiateStreaming'||call.api==='instantiate(bytes)')??null;
 const fonts=(raw?.probe?.fonts??[]).map(face=>({family:face.family,weight:face.weight??null,status:face.status,start_ms:minus(face.start_ms,boot),end_ms:minus(face.end_ms,boot)}));
 const imageRows=(raw?.assets?.loading?.recent??[]).map(row=>({id:row.id,state:row.state,queued_ms:minus(row.queued_at_ms,boot),started_ms:minus(row.started_at_ms,boot),completed_ms:minus(row.completed_at_ms,boot),
  queue_ms:round(row.queue_ms),load_event_ms:round(row.load_event_ms),decode_ms:round(row.decode_ms),network_ms:round(row.network_ms),transfer_bytes:finite(row.transfer_bytes)&&row.transfer_bytes>0?row.transfer_bytes:null,encoded_body_bytes:finite(row.encoded_body_bytes)&&row.encoded_body_bytes>0?row.encoded_body_bytes:null,error:row.error??null}));
 const perf=raw?.perf??null;
 const milestoneRows=(perf?.milestones?.rows??[]).map(row=>({name:row.name,frame:row.frame,sequence:row.sequence,accepted_ms:minus(row.accepted_at_ms,boot),presented_ms:minus(row.presented_at_ms,boot),presented_frame:row.presented_frame}));
 const firstSubmission=finite(metrics?.first_presented_ms)?round(metrics.first_presented_ms):null;
 const longTasks=(raw?.probe?.long_tasks??[]).map(task=>({start_ms:minus(task.start_ms,boot),duration_ms:round(task.duration_ms)}));
 const beforeFirst=longTasks.filter(task=>firstSubmission!==null&&finite(task.start_ms)&&task.start_ms<firstSubmission);
 const js=resources.filter(row=>row.kind==='javascript');
 const frame=name=>perf?.[name]??null;
 const profile=raw?.profile?profileSummary(raw.profile,options.includeProfileEvents):null;
 const nav=raw?.nav??null;
 const flat={
  'boot_ms':round(boot),
  'navigation.response_end_ms':round(nav?.responseEnd),
  'navigation.dom_content_loaded_ms':minus(nav?.domContentLoadedEventEnd,boot),
  'player.module_graph_ready_ms':step('player')?.completed_ms??null,
  'player.runtime_ready_ms':finite(metrics?.runtime_ready_ms)?round(metrics.runtime_ready_ms):null,
  'player.first_successful_submission_ms':firstSubmission,
  'wasm.fetch_duration_ms':wasmResource?.duration_ms??null,
  'wasm.response_end_ms':wasmResource?.response_end_ms??null,
  'wasm.call_ms':mainWasm?minus(mainWasm.end_ms,mainWasm.start_ms):null,
  'wasm.compile_ms':mainWasm?.split?minus(mainWasm.compiled_ms,mainWasm.start_ms):null,
  'wasm.instantiate_ms':mainWasm?.split?minus(mainWasm.end_ms,mainWasm.compiled_ms):null,
  'wasm.ready_ms':mainWasm?.end_ms??null,
  'javascript.files':js.length,
  'javascript.encoded_bytes':sumOrNull(js.map(row=>row.encoded_bytes)),
  'javascript.last_response_end_ms':maxOrNull(js.map(row=>row.response_end_ms)),
  'fonts.faces':fonts.length,
  'fonts.ready_ms':maxOrNull(fonts.map(face=>face.end_ms)),
  'images.loaded':imageRows.length,
  'images.ready_ms':maxOrNull(imageRows.map(row=>row.completed_ms)),
  'images.queue_ms_max':maxOrNull(imageRows.map(row=>row.queue_ms)),
  'images.load_event_ms_max':maxOrNull(imageRows.map(row=>row.load_event_ms)),
  'images.decode_ms_max':maxOrNull(imageRows.map(row=>row.decode_ms)),
  'resources.count':resources.length,
  'resources.transfer_bytes':sumOrNull(resources.map(row=>row.transfer_bytes)),
  'resources.network_bytes':sumOrNull(resources.map(row=>row.network_bytes)),
  'resources.from_browser_cache':resources.filter(row=>['disk_cache','memory_cache','prefetch_cache','service_worker'].includes(row.cache)).length,
  'resources.revalidated':resources.filter(row=>row.cache==='revalidated').length,
  'long_tasks.before_first_submission':firstSubmission===null?null:beforeFirst.length,
  'long_tasks.ms_before_first_submission':firstSubmission===null?null:round(beforeFirst.reduce((sum,task)=>sum+(task.duration_ms??0),0)),
  'frames.successful_submission_p95_ms':frame('successful_submission_raf_intervals')?.p95_ms??null,
  'frames.new_snapshot_p95_ms':frame('new_snapshot_raf_intervals')?.p95_ms??null,
  'frames.preparation_p95_ms':frame('preparation_wall')?.p95_ms??null,
  'frames.window_coverage':frame('successful_submission_raf_intervals')?.window_coverage??null,
  'memory.js_heap_used_bytes':finite(raw?.cdp_metrics?.JSHeapUsedSize)?raw.cdp_metrics.JSHeapUsedSize:null,
  'memory.wasm_linear_bytes':finite(raw?.playerPerformance?.backend?.wasm_linear_bytes)?raw.playerPerformance.backend.wasm_linear_bytes:null,
  'memory.image_resident_bytes_estimate':finite(raw?.assets?.broker?.resident_bytes_estimate)?raw.assets.broker.resident_bytes_estimate:null,
 };
 for(const row of steps){flat[`startup.${row.id}.started_ms`]=row.started_ms;flat[`startup.${row.id}.completed_ms`]=row.completed_ms;flat[`startup.${row.id}.duration_ms`]=row.duration_ms;}
 for(const name of options.milestones??[]){const row=milestoneRows.find(candidate=>candidate.name===name);flat[`milestone.${name}.accepted_ms`]=row?.accepted_ms??null;flat[`milestone.${name}.presented_ms`]=row?.presented_ms??null;}
 for(const [name,value] of Object.entries(flat))if(finite(value))flat[name]=round(value);
 const visibilityLog=raw?.probe?.visibility??[];
 return {kind,index,profiling,url,ok:true,error:null,
  foreground:{visibility_at_start:visibilityLog[0]?.state??null,focused_at_start:raw?.probe?.focused_at_start??null,visibility_at_sample:raw?.visibility??null,focused_at_sample:raw?.focused??null,
   hidden_during_run:visibilityLog.some(entry=>entry.state!=='visible'),blur_events:(raw?.probe?.focus??[]).filter(entry=>!entry.focused).length},
  page:{device_pixel_ratio:raw?.dpr??null,inner_size:raw?.inner??null,user_agent:raw?.ua??null,backend:metrics?.backend??null,renderer:metrics?.renderer??null,seed:metrics?.seed??null,seed_source:metrics?.seed_source??null,
   error:raw?.error??null,time_origin_epoch_ms:raw?.time_origin??null,sampled_at_ms:minus(raw?.now,boot),player_accessors:{performance:Boolean(perf),assets:Boolean(raw?.assets),profile:Boolean(raw?.profile),milestones:Boolean(perf?.milestones)}},
  metrics:flat,
  startup_steps:steps,
  navigation:nav?{origin:'navigation start (performance.timeOrigin)',boot_ms:round(boot),response_start_ms:round(nav.responseStart),response_end_ms:round(nav.responseEnd),dom_interactive_ms:round(nav.domInteractive),dom_content_loaded_ms:round(nav.domContentLoadedEventEnd),load_event_end_ms:round(nav.loadEventEnd),transfer_bytes:nav.transferSize===0&&nav.encodedBodySize===0?null:nav.transferSize}:null,
  wasm:{resource:wasmResource,calls:wasmCalls,method:mainWasm?.split?'split: compileStreaming/compile then instantiate (the same work instantiateStreaming does)':mainWasm?'observed call only: compile and instantiate are not separable':null,
   note:wasmCalls.length?null:'No WebAssembly call reached the page: the worker backend loads the runtime inside a Worker the page cannot instrument, or the page failed first.'},
  javascript:{modules:js},
  fonts:{faces:fonts,resources:resources.filter(row=>row.kind==='font')},
  images:{rows:imageRows,totals:raw?.assets?.loading?{completed:raw.assets.loading.completed,failed:raw.assets.loading.failed,cancelled:raw.assets.loading.cancelled,recent_capacity:raw.assets.loading.recent_capacity}:null,broker:raw?.assets?.broker??null},
  milestones:milestoneRows,
  frames:perf?{window_ms:options.frameWindowMs,sampled_at_ms:minus(perf.queried_at_ms,boot),completed_draws:perf.completed_draws,presented_frame_changes:perf.presented_frame_changes,dropped_steps_total:perf.dropped_steps_total,
   successful_submission_raf_intervals:fromBoot(perf.successful_submission_raf_intervals,boot),new_snapshot_raf_intervals:fromBoot(perf.new_snapshot_raf_intervals,boot),preparation_wall:fromBoot(perf.preparation_wall,boot),submit_sync_wall:fromBoot(perf.submit_sync_wall,boot),
   note:'One window read at sampled_at_ms; intervals are submission cadence, not GPU time or physical display.'}:null,
  memory:{js_heap_used_bytes:flat['memory.js_heap_used_bytes'],js_heap_total_bytes:finite(raw?.cdp_metrics?.JSHeapTotalSize)?raw.cdp_metrics.JSHeapTotalSize:null,wasm_linear_bytes:flat['memory.wasm_linear_bytes'],
   image_resident_bytes_estimate:flat['memory.image_resident_bytes_estimate'],note:'Separate owners measured at one time; never add them as process or GPU memory. wasm_linear_bytes is capacity, not live use.'},
  long_tasks:longTasks,
  paint:(raw?.paints??[]).map(entry=>({name:entry.name,start_ms:minus(entry.start_ms,boot)})),
  resources,
  server_requests:server,
  profile,
  console_errors:raw?.console_errors??[]};
}

export function profileSummary(report,includeEvents=false){
 const kinds={};for(const event of report.events??[]){const key=`${event.kind}:${event.status}`;kinds[key]=(kinds[key]??0)+1;}
 return {schema:report.schema??null,limit:report.limit??null,counts:report.counts??null,retained_events:(report.events??[]).length,retained_by_kind_status:kinds,
  coverage_note:'A bounded ring: overwritten records stay counted, so retained events alone are not continuous coverage.',...(includeEvents?{events:report.events}:{})};
}

// ---------------------------------------------------------------- export identity and static server

export async function readExport(root,{allowDevelopment=false}={}){
 const exportJsonBytes=await readFile(path.join(root,'export.json'));
 const exported=JSON.parse(exportJsonBytes);
 if(typeof exported.release_root!=='string')throw Error('MEASURE_EXPORT_INVALID: export.json has no release_root; export again with the current game CLI');
 const release=path.join(root,exported.release_root);
 const runtimeBytes=await readFile(path.join(release,'runtime','runtime.json'));
 const runtime=JSON.parse(runtimeBytes);
 for(const [file,expected] of [[runtime.wasm,runtime.wasm_sha256],[runtime.javascript,runtime.javascript_sha256]]){
  if(typeof file!=='string'||typeof expected!=='string')throw Error('MEASURE_EXPORT_INVALID: runtime.json names no wasm/javascript with hashes');
  const actual=sha256(await readFile(path.join(release,'runtime',file)));
  if(actual!==expected)throw Error(`MEASURE_EXPORT_INVALID: runtime/${file} does not match runtime.json (${actual} != ${expected})`);
 }
 const development=exported.variant!=='production'||exported.dev_tools!==false||exported.preview_tools===true||runtime.dev_tools!==false||runtime.preview_tools===true;
 if(development&&!allowDevelopment)throw Error('MEASURE_EXPORT_NOT_PRODUCTION: measure a production export (variant production, no dev or preview tools); --allow-development measures a development one and says so in the report');
 const files=Array.isArray(exported.files)?exported.files:[];
 return {root,exported,runtime,development,artifact:{export_dir:root,export_json_sha256:sha256(exportJsonBytes),index_html_sha256:sha256(await readFile(path.join(root,'index.html'))),
  release_root:exported.release_root,variant:exported.variant??null,project:exported.project??null,files:files.length||null,total_bytes:finite(exported.total_bytes)?exported.total_bytes:null,
  renderer_mode:exported.renderer_mode??null,compiled_systems:exported.compiled_systems??null,cache_policy:exported.cache_policy??null,
  runtime_json_sha256:sha256(runtimeBytes),wasm:runtime.wasm,wasm_sha256:runtime.wasm_sha256,wasm_bytes:finite(runtime.wasm_bytes)?runtime.wasm_bytes:null,javascript:runtime.javascript,javascript_sha256:runtime.javascript_sha256},
  engine:{source_commit:runtime.source_commit??null,source_dirty:typeof runtime.source_dirty==='boolean'?runtime.source_dirty:null,runtime_packages:runtime.runtime_packages??null,cargo_features:runtime.cargo_features??null,exports:runtime.exports??null},
  execution:{variant:exported.variant??null,profile:runtime.profile??exported.profile??null,dev_tools:runtime.dev_tools??null,preview_tools:runtime.preview_tools??null,phase_profile:runtime.phase_profile??null,
   sampling_profile:runtime.sampling_profile??null,profile_mode:runtime.profile_mode??null,bytecode_optimization_level:runtime.bytecode_optimization_level??null}};
}

const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.png':'image/png',
 '.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.avif':'image/avif','.ttf':'font/ttf','.otf':'font/otf','.woff':'font/woff','.woff2':'font/woff2',
 '.ogg':'audio/ogg','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.txt':'text/plain; charset=utf-8','.bin':'application/octet-stream','.glb':'model/gltf-binary','.css':'text/css'};
const COMPRESSIBLE=new Set(['.html','.js','.mjs','.wasm','.json','.svg','.txt','.css','.bin']);

// The export declares how a host should cache it (export.json cache_policy): index.html revalidates,
// the immutable release generation is cached for a year. --cache-control replaces it for every file.
export function cacheControlFor(relative,policy,override){
 if(override)return override;
 const p=relative.replace(/\\/g,'/');
 if(p===''||p==='index.html')return policy?.['index.html']??'no-cache';
 if(p.startsWith('releases/')&&policy?.['releases/'])return policy['releases/'];
 return 'no-cache';
}

export async function startServer(root,{cachePolicy=null,cacheControl=null,compress='none'}={}){
 const base=path.resolve(root),log=[],cache=new Map();
 const server=createServer(async(request,response)=>{
  const entry={path:null,status:0,bytes:0,conditional:Boolean(request.headers['if-none-match']),encoding:'identity'};
  try{
   const url=new URL(request.url,'http://localhost');let relative=decodeURIComponent(url.pathname).replace(/^\/+/,'');
   if(url.pathname===BLANK_PATH){const body=Buffer.from(BLANK_HTML);entry.path=BLANK_PATH;entry.status=200;entry.bytes=body.length;response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-length':body.length});response.end(request.method==='HEAD'?undefined:body);return;}
   if(relative===''||relative.endsWith('/'))relative+='index.html';
   const file=path.resolve(base,relative);entry.path='/'+relative;
   if(file!==base&&!file.toLowerCase().startsWith((base+path.sep).toLowerCase()))throw Object.assign(Error('outside export'),{status:403});
   let item=cache.get(file);
   if(!item){const info=await stat(file);if(!info.isFile())throw Object.assign(Error('not a file'),{status:404});const bytes=await readFile(file);item={bytes,etag:`"${sha256(bytes).slice(0,32)}"`,modified:info.mtime.toUTCString(),gzip:null};cache.set(file,item);}
   const ext=path.extname(file).toLowerCase();
   const headers={'content-type':MIME[ext]??'application/octet-stream','cache-control':cacheControlFor(relative,cachePolicy,cacheControl),etag:item.etag,'last-modified':item.modified,'timing-allow-origin':'*'};
   if(request.headers['if-none-match']===item.etag){entry.status=304;response.writeHead(304,headers);response.end();return;}
   let body=item.bytes;
   if(compress==='gzip'&&COMPRESSIBLE.has(ext)&&/\bgzip\b/.test(request.headers['accept-encoding']??'')){item.gzip??=gzipSync(item.bytes);body=item.gzip;headers['content-encoding']='gzip';headers.vary='Accept-Encoding';entry.encoding='gzip';}
   headers['content-length']=body.length;entry.status=200;entry.bytes=body.length;
   response.writeHead(200,headers);response.end(request.method==='HEAD'?undefined:body);
  }catch(error){entry.status=error.status??404;response.writeHead(entry.status,{'content-type':'text/plain'});response.end(String(error.message??error));}
  finally{log.push(entry);}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {url:`http://127.0.0.1:${server.address().port}/`,log,take(){return log.splice(0,log.length);},close:()=>new Promise(resolve=>server.close(()=>resolve()))};
}

// ---------------------------------------------------------------- browser and DevTools protocol

class Cdp{
 constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();this.listeners=new Set();
  ws.onmessage=event=>{const message=JSON.parse(event.data);
   if(message.id){const waiting=this.pending.get(message.id);if(!waiting)return;this.pending.delete(message.id);clearTimeout(waiting.timer);
    if(message.error)waiting.reject(Error(`${waiting.method}: ${message.error.message}`));else waiting.resolve(message.result);}
   else for(const listener of this.listeners)listener(message);};
  ws.onclose=()=>{for(const waiting of this.pending.values()){clearTimeout(waiting.timer);waiting.reject(Error('CDP_CLOSED'));}this.pending.clear();};
 }
 static async connect(url){const ws=new WebSocket(url);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=()=>reject(Error('CDP_CONNECT_FAILED'));});return new Cdp(ws);}
 send(method,params={},sessionId=undefined,timeoutMs=30000){
  const id=++this.id;
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error(`CDP_TIMEOUT: ${method}`));},timeoutMs);
   this.pending.set(id,{resolve,reject,method,timer});this.ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 }
 on(listener){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
 close(){try{this.ws.close();}catch{}}
}

export function findBrowser(explicit){
 const candidates=[explicit,process.env.UNONE_BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/microsoft-edge','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean);
 const found=candidates.find(candidate=>existsSync(candidate));
 if(!found)throw Error('MEASURE_BROWSER_MISSING: install Edge or Chrome, or pass --browser <path> (or UNONE_BROWSER_PATH)');
 return found;
}

// Flags that keep a headless tab treated as a foreground one, plus muted audio: a headless tab
// plays through the speakers with no window to find it by.
export function browserArgs({profileDir,headed,viewport}){
 return [...(headed?[]:['--headless=new']),'--mute-audio','--remote-debugging-port=0',`--user-data-dir=${profileDir}`,'--no-first-run','--no-default-browser-check',
  '--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--disable-component-update','--disable-sync',
  `--window-size=${viewport.width},${viewport.height}`,'about:blank'];
}

async function launchBrowser(executable,options){
 const profileDir=await mkdtemp(path.join(os.tmpdir(),'unone-measure-'));
 const args=browserArgs({profileDir,headed:options.headed,viewport:options.viewport});
 // On Windows msedge.exe can hand the profile to a browser process of its own and exit at once,
 // so the launcher's exit means nothing; the profile's DevToolsActivePort says the browser is up.
 const child=spawn(executable,args,{stdio:['ignore','ignore','ignore'],windowsHide:true});
 let exitCode=null;child.once('exit',code=>{exitCode=code;});
 const portFile=path.join(profileDir,'DevToolsActivePort');let endpoint=null;
 for(let i=0;i<150&&!endpoint;i++){
  try{const [port,wsPath]=(await readFile(portFile,'utf8')).split(/\r?\n/);if(port&&wsPath)endpoint=`ws://127.0.0.1:${port.trim()}${wsPath.trim()}`;}catch{}
  if(!endpoint){if(exitCode!==null&&exitCode!==0)break;await sleep(100);}
 }
 if(!endpoint){try{child.kill();}catch{}await rm(profileDir,{recursive:true,force:true}).catch(()=>{});throw Error(`MEASURE_BROWSER_NO_DEVTOOLS: ${executable} published no DevTools endpoint${exitCode?` (exit ${exitCode})`:' within 15 s'}`);}
 const cdp=await Cdp.connect(endpoint);let closed=false;const wasClosed=new Promise(resolve=>{const previous=cdp.ws.onclose;cdp.ws.onclose=event=>{closed=true;previous?.(event);resolve();};});
 const version=await cdp.send('Browser.getVersion');
 let browserPid=null;try{browserPid=(await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(p=>p.type==='browser')?.id??null;}catch{}
 let gpu=null;try{const info=await cdp.send('SystemInfo.getInfo');gpu={devices:(info.gpu?.devices??[]).map(d=>({vendor_id:d.vendorId,device_id:d.deviceId,vendor:d.vendorString,device:d.deviceString,driver_vendor:d.driverVendor,driver_version:d.driverVersion})),feature_status:info.gpu?.featureStatus??null};}catch{}
 async function close(){
  try{await cdp.send('Browser.close',{},undefined,5000);}catch{}
  await Promise.race([wasClosed,sleep(10000)]);
  if(!closed){cdp.close();if(browserPid)try{process.kill(browserPid);}catch{}}
  // The browser's helper processes release the profile a moment after it closes.
  for(let i=0;i<40;i++){try{await rm(profileDir,{recursive:true,force:true});break;}catch{await sleep(250);}}
 }
 return {cdp,version,gpu,args,close};
}

// Instrumentation added to every document before its own scripts. Timing only: every wrapper
// returns what the original returns, and a 'split' instantiateStreaming does exactly the two steps
// instantiateStreaming is specified as (compileStreaming, then instantiate).
export function probeSource({wasmTiming='split'}={}){
 return `(()=>{if(window.top!==window||window.__unoneMeasure)return;
const now=()=>performance.now(),split=${JSON.stringify(wasmTiming==='split')};
const probe={version:1,wasm:[],fonts:[],long_tasks:[],visibility:[{state:document.visibilityState,at_ms:now()}],focus:[],focused_at_start:document.hasFocus()};
Object.defineProperty(window,'__unoneMeasure',{value:probe});
const W=WebAssembly,o={instantiateStreaming:W.instantiateStreaming,instantiate:W.instantiate,compileStreaming:W.compileStreaming,compile:W.compile};
const row=(api,bytes=null)=>{const r={api,split:false,status:'pending',start_ms:now(),compiled_ms:null,end_ms:null,bytes};if(probe.wasm.length<32)probe.wasm.push(r);return r;};
const settle=(r,promise)=>promise.then(v=>{r.end_ms=now();r.status='ok';return v;},e=>{r.end_ms=now();r.status='error';throw e;});
const size=s=>s instanceof ArrayBuffer||ArrayBuffer.isView(s)?s.byteLength:null;
if(o.instantiateStreaming)W.instantiateStreaming=function(source,imports){const r=row('instantiateStreaming');
 if(split&&o.compileStreaming){r.split=true;return settle(r,o.compileStreaming.call(W,source).then(module=>{r.compiled_ms=now();return o.instantiate.call(W,module,imports).then(instance=>({module,instance}));}));}
 return settle(r,o.instantiateStreaming.call(W,source,imports));};
W.instantiate=function(source,imports){
 if(source instanceof W.Module)return settle(row('instantiate(module)'),o.instantiate.call(W,source,imports));
 const r=row('instantiate(bytes)',size(source));
 if(split){r.split=true;return settle(r,o.compile.call(W,source).then(module=>{r.compiled_ms=now();return o.instantiate.call(W,module,imports).then(instance=>({module,instance}));}));}
 return settle(r,o.instantiate.call(W,source,imports));};
if(o.compileStreaming)W.compileStreaming=function(source){return settle(row('compileStreaming'),o.compileStreaming.call(W,source));};
W.compile=function(source){return settle(row('compile',size(source)),o.compile.call(W,source));};
if(window.FontFace){const load=FontFace.prototype.load;FontFace.prototype.load=function(){const r={family:this.family,weight:this.weight,status:'pending',start_ms:now(),end_ms:null};if(probe.fonts.length<128)probe.fonts.push(r);return settle(r,load.call(this));};}
try{new PerformanceObserver(list=>{for(const e of list.getEntries())if(probe.long_tasks.length<512)probe.long_tasks.push({start_ms:e.startTime,duration_ms:e.duration});}).observe({type:'longtask',buffered:true});}catch{}
document.addEventListener('visibilitychange',()=>{if(probe.visibility.length<64)probe.visibility.push({state:document.visibilityState,at_ms:now()});});
addEventListener('focus',()=>{if(probe.focus.length<64)probe.focus.push({focused:true,at_ms:now()});});
addEventListener('blur',()=>{if(probe.focus.length<64)probe.focus.push({focused:false,at_ms:now()});});
})();`;
}

// One read of everything the player and the browser expose, as one JSON string.
export function collectSource({frameWindowMs}){
 return `JSON.stringify((()=>{const d=document.body?.dataset??{},parse=t=>{try{return t?JSON.parse(t):null;}catch{return null;}};
const nav=performance.getEntriesByType('navigation')[0];
let perf=null;try{perf=window.unonePlayerPerformance?.snapshot({windowMs:${Number(frameWindowMs)}})??null;}catch(e){perf={error:String(e.message??e)};}
let assets=null;try{assets=window.unonePlayerAssets?.snapshot?.({includeTimings:true})??null;}catch(e){assets={error:String(e.message??e)};}
let profile=null;try{profile=window.unonePlayerProfile?.report?.()??null;}catch(e){profile={error:String(e.message??e)};}
return {boot:window.playerBoot??null,time_origin:performance.timeOrigin,now:performance.now(),visibility:document.visibilityState,focused:document.hasFocus(),dpr:devicePixelRatio,inner:[innerWidth,innerHeight],ua:navigator.userAgent,
metrics:parse(d.playerMetrics),startup:parse(d.playerStartup),error:d.playerError??null,playerPerformance:parse(d.playerPerformance),
nav:nav?nav.toJSON():null,resources:performance.getEntriesByType('resource').map(e=>e.toJSON()),paints:performance.getEntriesByType('paint').map(e=>({name:e.name,start_ms:e.startTime})),
perf,assets,profile,probe:window.__unoneMeasure??null};})())`;
}

const POLL_SOURCE=`(()=>{const d=document.body?.dataset??{};let presented=[];try{presented=(window.unonePlayerPerformance?.snapshot({windowMs:1000})?.milestones?.rows??[]).filter(r=>r.presented_at_ms!==null).map(r=>r.name);}catch{}
return JSON.stringify({error:d.playerError??null,ready:Boolean(d.playerMetrics&&JSON.parse(d.playerMetrics).first_presented_ms!==undefined),presented,milestones:Boolean(window.unonePlayerPerformance?.snapshot({windowMs:1000})?.milestones)});})()`;

async function openPage(browser,options){
 const {cdp}=browser,{targetId}=await cdp.send('Target.createTarget',{url:'about:blank'});
 const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
 const send=(method,params={},timeoutMs)=>cdp.send(method,params,sessionId,timeoutMs);
 const network=new Map(),consoleErrors=[];let collecting=false,readyResolve=null;
 cdp.on(message=>{
  if(message.sessionId!==sessionId)return;const p=message.params??{};
  if(message.method==='Runtime.consoleAPICalled'){
   const text=(p.args??[]).map(arg=>arg.value??arg.description??'').join(' ');
   if(text.startsWith('UNONE_PLAYER_READY '))readyResolve?.('ready');
   if(p.type==='error'&&consoleErrors.length<32)consoleErrors.push(text.slice(0,2000));
   if(p.type==='error')readyResolve?.('error');
   return;
  }
  if(message.method==='Runtime.exceptionThrown'){if(consoleErrors.length<32)consoleErrors.push(String(p.exceptionDetails?.exception?.description??p.exceptionDetails?.text??'exception').slice(0,2000));readyResolve?.('error');return;}
  if(!collecting)return;
  if(message.method==='Network.requestWillBeSent'){if(network.size<4096)network.set(p.requestId,{url:p.request?.url,type:p.type??null,status:null,fromDiskCache:false,servedFromCache:false,fromServiceWorker:false,fromPrefetchCache:false,encodedDataLength:null,protocol:null,mimeType:null,failed:false});}
  else if(message.method==='Network.requestServedFromCache'){const row=network.get(p.requestId);if(row)row.servedFromCache=true;}
  else if(message.method==='Network.responseReceived'){const row=network.get(p.requestId);if(row){const r=p.response??{};Object.assign(row,{status:r.status??null,fromDiskCache:r.fromDiskCache===true,fromServiceWorker:r.fromServiceWorker===true,fromPrefetchCache:r.fromPrefetchCache===true,protocol:r.protocol??null,mimeType:r.mimeType??null});}}
  else if(message.method==='Network.loadingFinished'){const row=network.get(p.requestId);if(row)row.encodedDataLength=p.encodedDataLength??null;}
  else if(message.method==='Network.loadingFailed'){const row=network.get(p.requestId);if(row){row.failed=true;row.error=p.errorText??null;}}
 });
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:options.viewport.width,height:options.viewport.height,deviceScaleFactor:options.dpr,mobile:false});
 await send('Emulation.setFocusEmulationEnabled',{enabled:true});
 if(options.cpuThrottle!==1)await send('Emulation.setCPUThrottlingRate',{rate:options.cpuThrottle});
 if(options.network)await send('Network.emulateNetworkConditions',{offline:false,latency:options.network.latency_ms,downloadThroughput:options.network.download_kbps*1000/8,uploadThroughput:options.network.upload_kbps*1000/8});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:probeSource(options)});
 async function evaluate(expression,timeoutMs=15000){const result=await send('Runtime.evaluate',{expression,returnByValue:true},timeoutMs);if(result.exceptionDetails)throw Error(`MEASURE_EVALUATE_FAILED: ${result.exceptionDetails.exception?.description??result.exceptionDetails.text}`);return result.result?.value;}
 async function load(url,{origin,keepStorage,milestones,timeoutMs,settleMs,pollMs,frameWindowMs}){
  await send('Page.navigate',{url:'about:blank'});await sleep(100);
  if(!keepStorage)await send('Storage.clearDataForOrigin',{origin,storageTypes:'local_storage,indexeddb,service_workers,cache_storage'});
  network.clear();consoleErrors.length=0;collecting=true;
  const readyOrError=new Promise(resolve=>{readyResolve=resolve;});
  const started=Date.now();
  await send('Page.navigate',{url});
  const first=await Promise.race([readyOrError,sleep(timeoutMs).then(()=>'timeout')]);readyResolve=null;
  let outcome={ready:first==='ready',error:null,presented:[],milestones:false,timedOut:first==='timeout'};
  // A console error is not necessarily fatal; the player's own error attribute is.
  for(;;){
   try{outcome={...outcome,...JSON.parse(await evaluate(POLL_SOURCE,5000))};}catch(error){outcome.error??=String(error.message??error);break;}
   if(outcome.error)break;
   const waiting=milestones.filter(name=>!outcome.presented.includes(name));
   if(outcome.ready&&waiting.length===0)break;
   if(Date.now()-started>timeoutMs){outcome.timedOut=true;break;}
   await sleep(pollMs);
  }
  if(!outcome.error&&outcome.ready&&settleMs>0)await sleep(settleMs);
  let raw=null,collectError=null;
  try{raw=JSON.parse(await evaluate(collectSource({frameWindowMs}),20000));}catch(error){collectError=String(error.message??error);}
  if(raw){try{await send('Performance.enable');const {metrics}=await send('Performance.getMetrics');raw.cdp_metrics=Object.fromEntries(metrics.map(m=>[m.name,m.value]));await send('Performance.disable');}catch{}}
  collecting=false;
  if(raw)raw.console_errors=[...consoleErrors];
  const waiting=milestones.filter(name=>!outcome.presented.includes(name));
  const error=raw?.error??outcome.error??collectError??(outcome.ready?null:outcome.timedOut?`MEASURE_TIMEOUT: no first presented frame within ${timeoutMs} ms`:'MEASURE_NOT_READY')
   ??(waiting.length?`MEASURE_MILESTONE_TIMEOUT: ${waiting.join(', ')} not presented within ${timeoutMs} ms${outcome.milestones?'':' (this player publishes no milestones: rebuild the runtime and export with an engine that has api.profile.mark)'}`:null);
  return {raw,network:[...network.values()],error};
 }
 return {load,send,evaluate,close:()=>cdp.send('Target.closeTarget',{targetId}).catch(()=>{})};
}

// ---------------------------------------------------------------- orchestration

function measuredUrl(serverUrl,{seed,backend},profiling,profileLimit=null){
 const url=new URL(serverUrl);url.searchParams.set('seed',seed);if(backend)url.searchParams.set('backend',backend);if(profiling)url.searchParams.set('unone_profile','1');if(profiling&&profileLimit)url.searchParams.set('unone_profile_limit',String(profileLimit));return url.href;
}

async function measureOnce(page,server,options,{kind,index,profiling,milestones=options.milestones,profileLimit=null}){
 const url=measuredUrl(server.url,options,profiling,profileLimit);server.take();
 const {raw,network,error}=await page.load(url,{origin:new URL(server.url).origin,keepStorage:options.keepStorage,milestones,timeoutMs:options.timeoutMs,settleMs:options.settleMs,pollMs:options.pollMs,frameWindowMs:options.frameWindowMs});
 const sample=normalizeLoad(raw,{network,server:server.take(),options,kind,index,profiling,url});
 if(error){sample.ok=false;sample.error=error;}
 return sample;
}

export async function measure(options,log=message=>process.stderr.write(message+'\n')){
 const exported=await readExport(path.resolve(options.export),options);
 let scenario=null;
 if(options.scenarioRuns>0){const bytes=await readFile(path.resolve(options.scenario));scenario={file:{name:path.basename(options.scenario),sha256:sha256(bytes)},definition:parseScenario(bytes.toString('utf8'))};}
 const executable=findBrowser(options.browser);
 const server=await startServer(exported.root,{cachePolicy:exported.exported.cache_policy,cacheControl:options.cacheControl,compress:options.compress});
 const runs=[],pairs=[],scenarioRuns=[];let browserInfo=null;
 const conditionsOf=browser=>({browser:{product:browser.version.product,user_agent:browser.version.userAgent,js_version:browser.version.jsVersion,protocol:browser.version.protocolVersion,executable,headless:!options.headed,args:browser.args.filter(arg=>!arg.startsWith('--user-data-dir='))},gpu:browser.gpu});
 try{
  for(let i=0;i<options.cold;i++){
   const browser=await launchBrowser(executable,options);browserInfo??=conditionsOf(browser);
   try{const page=await openPage(browser,options);const sample=await measureOnce(page,server,options,{kind:'cold',index:i+1,profiling:false});runs.push(sample);log(`cold ${i+1}/${options.cold}: ${sample.ok?`first submission ${sample.metrics['player.first_successful_submission_ms']} ms`:sample.error}`);}
   finally{await browser.close();}
  }
  if(options.warm+options.profilePairs>0){
   const browser=await launchBrowser(executable,options);browserInfo??=conditionsOf(browser);
   try{
    const page=await openPage(browser,options);
    const prime=await measureOnce(page,server,options,{kind:'prime',index:0,profiling:false});
    log(`prime (not reported in the summary): ${prime.ok?'ok':prime.error}`);
    runs.push(prime);
    for(let i=0;i<options.warm;i++){const sample=await measureOnce(page,server,options,{kind:'warm',index:i+1,profiling:false});runs.push(sample);log(`warm ${i+1}/${options.warm}: ${sample.ok?`first submission ${sample.metrics['player.first_successful_submission_ms']} ms`:sample.error}`);}
    for(let i=0;i<options.profilePairs;i++){
     const order=i%2===0?['off','on']:['on','off'],pair={index:i+1,order:`${order[0]}_first`};
     for(const side of order){const sample=await measureOnce(page,server,options,{kind:'profiler_pair',index:i+1,profiling:side==='on'});runs.push(sample);pair[side]=sample;}
     pairs.push(pair);log(`profiler pair ${i+1}/${options.profilePairs} (${pair.order}): ${pair.off.ok&&pair.on.ok?'ok':pair.off.error??pair.on.error}`);
    }
   }finally{await browser.close();}
  }
  // Each scenario run is a fresh browser: it starts cold, waits for the scenario's start mark,
  // then drives the game and samples memory until the settle checkpoint.
  const windows=scenario?scenario.definition.phases.filter(phase=>phase.kind==='frames'):[];
  const blankMs=windows.length&&options.blankControl?Math.max(...windows.map(phase=>phase.window_ms)):0;
  const scenarioTotal=options.scenarioRuns+(options.scenarioRuns&&options.scenarioProfile?1:0);
  for(let i=0;i<scenarioTotal;i++){
   const profiling=i===options.scenarioRuns;
   const milestones=[...new Set([...options.milestones,...(scenario.definition.start_mark?[scenario.definition.start_mark]:[])])];
   const browser=await launchBrowser(executable,options);browserInfo??=conditionsOf(browser);
   try{
    const page=await openPage(browser,options);
    // The browser's own cadence on an empty page, same browser and viewport, before the game loads.
    let blank=null;
    if(blankMs&&!profiling){try{blank=await measureBlank(page,new URL(BLANK_PATH,server.url).href,{windowMs:blankMs});log(`scenario ${i+1}: blank control p95 ${blank.raf_interval.p95_ms} ms over ${blank.frames} frames`);}catch(error){blank={error:String(error.message??error)};}}
    const startup=await measureOnce(page,server,options,{kind:'scenario',index:i+1,profiling,milestones,profileLimit:profiling?2048:null});runs.push(startup);
    let result;
    if(!startup.ok)result={ok:false,error:`MEASURE_SCENARIO_NOT_STARTED: ${startup.error}`,phases:[],settled:null,samples:null};
    else{
     log(`scenario ${i+1}/${options.scenarioRuns}: ${scenario.definition.name} started`);
     const readOs=async()=>{let info;try{info=(await browser.cdp.send('SystemInfo.getProcessInfo')).processInfo;}catch(error){return {supported:false,error:String(error.message??error),processes:[]};}return readProcessMemory(info);};
     result=await runScenario(page,scenario.definition,{readOs,profiling,log:message=>log(`scenario ${i+1}${profiling?' (profiler on)':''}: ${message}`)});
    }
    scenarioRuns.push({index:i+1,profiling,startup_run:runs.length-1,...(blank?{blank_control:blank}:{}),...result});
    log(`scenario ${i+1}/${scenarioTotal}${profiling?' (profiler on, diagnostic)':''}: ${result.ok?'ok':result.error}`);
   }finally{await browser.close();}
  }
 }finally{await server.close();}
 return buildReport({options,exported,runs,pairs,browserInfo,scenario,scenarioRuns});
}

const SCENARIO_NOTES=Object.freeze([
 'scenario: memory owners come from unonePlayerPerformance.snapshot({includeMemory:true}); within/overlaps say which owners hold the same bytes, so never add owner rows, heaps or processes together.',
 'scenario: a round peak is the largest value sampled every sample_ms during the round (plus its checkpoint), not a continuous high-water mark; os.*.peak_working_set_bytes is the OS high-water mark since the process started.',
 'scenario: os.* values are read at round checkpoints only, by the OS, per process; GPU dedicated/shared bytes are the driver counters for that process. The page renderer is reported as the largest renderer process.',
 'scenario: no garbage collection is forced; a JS or Luau heap can rise across rounds and fall later without leaking. trend.second_half_not_higher compares two halves of this window only and does not prove that nothing leaks.',
 'scenario: closed_images and released bytes in the player are logical releases, not memory the browser or OS has taken back.',
 'scenario: presented_after_input_ms is the milestone presentation minus the page clock just before the input was dispatched; it includes DevTools input delivery.',
 'scenario frames: submission_interval is between the end times of consecutive completed scheduler draws inside the window; raf_interval and new_snapshot_interval use those draws\' RAF timestamps. Percentiles are per window (nearest rank) and are never pooled across runs; the summary takes each window value across runs.',
 'scenario frames: input_latency is the player\'s own measurement: the earliest browser input a tick consumed, to the first completed submission presenting that tick. It is not display scanout, and host-only effects such as UI scroll are timed to the same submission.',
 'scenario frames: blank_control is an empty page\'s requestAnimationFrame cadence in the same browser and viewport before the game loads. A headless browser has no physical display: no interval here is scanout or GPU completion.',
 'scenario frames: a profiler-on run (--scenario-profile) locates where frame time goes; its frame numbers include the profiler\'s own cost and are never for acceptance.',
]);

/** Per scenario run, the values a comparison needs, summarized across runs like any other metric. */
export function scenarioSummary(scenarioRuns){
 return summarize(scenarioRuns.filter(run=>run.ok&&!run.profiling).map(run=>{
  const metrics={},put=(prefix,values)=>{for(const [name,value] of Object.entries(values??{}))if(finite(value))metrics[`${prefix}.${name}`]=value;};
  put('baseline',run.baseline?.metrics);
  if(run.blank_control?.raf_interval)put('blank_control',flattenFrames({raf_interval:run.blank_control.raf_interval}));
  for(const phase of run.phases??[]){
   if(phase.kind==='frames'){put(`${phase.name}.frames`,flattenFrames(phase.metrics));continue;}
   put(`${phase.name}.last_round_end`,phase.rounds.filter(r=>!r.warmup).at(-1)?.end);
   put(`${phase.name}.peak`,Object.fromEntries(Object.entries(phase.trend?.peak??{}).map(([name,t])=>[name,t.max])));
  }
  put('settled',run.settled?.metrics);
  return {metrics};
 }));
}

export function buildReport({options,exported,runs,pairs,browserInfo,scenario=null,scenarioRuns=[],createdAt=new Date().toISOString()}){
 const ok=kind=>runs.filter(run=>run.kind===kind&&run.ok);
 const okPairs=pairs.filter(pair=>pair.off?.ok&&pair.on?.ok);
 const coverage={};
 for(const kind of ['cold','warm']){const all=runs.filter(run=>run.kind===kind);coverage[kind]={requested:kind==='cold'?options.cold:options.warm,completed:all.length,ok:all.filter(run=>run.ok).length,failed:all.filter(run=>!run.ok).map(run=>({index:run.index,error:run.error}))};}
 coverage.profiler_pairs={requested:options.profilePairs,ok:okPairs.length,failed:pairs.filter(pair=>!(pair.off?.ok&&pair.on?.ok)).map(pair=>({index:pair.index,error:pair.off?.error??pair.on?.error}))};
 if(scenario)coverage.scenario={requested:options.scenarioRuns,ok:scenarioRuns.filter(run=>run.ok&&!run.profiling).length,profile_run:options.scenarioProfile?scenarioRuns.some(run=>run.profiling&&run.ok):null,failed:scenarioRuns.filter(run=>!run.ok).map(run=>({index:run.index,profiling:run.profiling,error:run.error}))};
 const foreground=runs.filter(run=>run.ok).every(run=>run.foreground.visibility_at_start==='visible'&&!run.foreground.hidden_during_run&&run.foreground.focused_at_sample===true);
 const notes=[
  'Times are milliseconds relative to window.playerBoot unless a field says otherwise; navigation.* fields are relative to navigation start, and boot_ms is playerBoot itself.',
  'summary.* quantiles are taken across runs of one kind, per metric; they are never added to one another. A within-run image or frame value (images.*_max, frames.*_p95_ms) is one number per run, summarized like any other.',
  'p95 is nearest-rank: with five runs it equals the slowest run.',
  'null means the browser or this player did not expose the value; it is never zero by assumption. transfer_bytes is null when the browser hides sizes (cross-origin without Timing-Allow-Origin, opaque origins); cache comes from the browser network log, not from transferSize.',
  'Profiler-on runs are diagnostics for locating costs; compare profiler-off runs for acceptance.',
  'Emulated network and CPU throttling are not a real device or radio network.',
 ];
 if(exported.development)notes.push('This export is a development build (--allow-development): its timings are not production timings.');
 if(!foreground)notes.push('At least one run was not foreground and focused for its whole duration; check runs[].foreground before using its timings.');
 if(scenario)notes.push(...SCENARIO_NOTES);
 return {schema:SCHEMA,created_at:createdAt,tool:{name:'measure-web-export',script:'scripts/measure-web-export.mjs',node:process.version},
  artifact:exported.artifact,engine:exported.engine,execution:{...exported.execution,development:exported.development},
  environment:{...browserInfo,os:{platform:process.platform,release:os.release(),arch:process.arch,cpu:os.cpus()[0]?.model?.trim()??null,logical_cpus:os.cpus().length,memory_bytes:os.totalmem()}},
  conditions:{viewport:options.viewport,device_pixel_ratio:options.dpr,seed:options.seed,backend_override:options.backend,focus_emulated:true,foreground_all_runs:foreground,
   network:options.network?{emulated:true,...options.network}:{emulated:false,note:'Loopback server: no network latency or bandwidth limit.'},cpu_throttle:options.cpuThrottle,
   server:{kind:'loopback static server',cache_control:options.cacheControl??'export cache_policy',cache_policy:options.cacheControl?null:exported.artifact.cache_policy,etag:true,compression:options.compress,timing_allow_origin:'*'},
   storage_cleared_between_runs:!options.keepStorage,cold:'new browser process and profile per run (empty HTTP and code caches)',warm:'one browser profile primed by an unreported first load; each run is a new document',
   wasm_timing:options.wasmTiming,poll_ms_after_first_submission:options.pollMs,settle_ms:options.settleMs,frame_window_ms:options.frameWindowMs,timeout_ms:options.timeoutMs,milestones:options.milestones},
  clock:{origin:'window.playerBoot',origin_definition:'performance.now() when the export index.html head runs, before any module loads; performance.now() itself counts from navigation start (performance.timeOrigin).',
   unit:'ms',host_clock:'main-thread performance.now(); worker clocks are not mixed in'},
  instrumentation:['Timing wrappers on WebAssembly.instantiateStreaming/instantiate/compileStreaming/compile and FontFace.prototype.load (results unchanged)','longtask PerformanceObserver','DevTools protocol Page/Runtime/Network domains; Performance.getMetrics once per run','one player-accessor poll every '+options.pollMs+' ms between the first submission and the last awaited milestone'],
  coverage,
  summary:{cold:summarize(ok('cold')),warm:summarize(ok('warm')),profiler_pairs:pairDeltas(okPairs)},
  ...(scenario?{scenario:{file:scenario.file,definition:scenario.definition,conditions:{browser:'a new browser process and profile per run',profiler:options.scenarioProfile?'off for acceptance runs; one extra diagnostic run with ?unone_profile=1&unone_profile_limit=2048':false,sample_ms:scenario.definition.sample_ms,settle_ms:scenario.definition.settle_ms,
   frame_windows:{poll_ms:2000,source:'unonePlayerPerformance.snapshot({includeRafSamples:true}) draw and input rows, stitched by sequence; the memory sampler pauses during a window',blank_control:options.blankControl?'empty page recording requestAnimationFrame timestamps, same browser and viewport, before the game loads':false},
   os_memory:process.platform==='win32'?'per process at checkpoints: working set, peak working set, private bytes, GPU dedicated/shared (Windows GPU counters)':process.platform==='linux'?'per process at checkpoints: VmRSS, VmHWM, RssAnon; no GPU memory':'not read on this platform'},
   summary:scenarioSummary(scenarioRuns),runs:scenarioRuns}}:{}),
  runs,
  pairs:pairs.map(pair=>({index:pair.index,order:pair.order,off_run:runs.indexOf(pair.off),on_run:runs.indexOf(pair.on)})),
  notes};
}

// A few owners' movement across each phase of the first completed scenario run, for the console.
const FRAME_CONSOLE=['submission_interval.p50_ms','submission_interval.p95_ms','submission_interval.p99_ms','submission_interval.over_50ms','submission_interval.over_100ms','raf_interval.p95_ms','raf_interval.over_50ms','new_snapshot_interval.p95_ms','dropped_steps','input_latency.p50_ms','input_latency.p95_ms','completed_submissions'];
const CONSOLE_METRICS=['images.decoded.resident.entries','images.decoded.resident.bytes','gpu.textures.entries','gpu.geometries.entries','luau.heap.bytes','js_heap.used_bytes','os.largest_renderer.private_bytes','os.gpu_process.gpu_dedicated_bytes'];
export function scenarioConsole(scenario){
 const run=scenario.runs.find(r=>r.ok&&!r.profiling);if(!run)return {ok:0,runs:scenario.runs.length};
 const median=name=>scenario.summary?.[name]?.median??null;
 const frames=prefix=>Object.fromEntries(FRAME_CONSOLE.map(name=>[name,median(`${prefix}.${name}`)]).filter(([,v])=>v!==null));
 return {ok:scenario.runs.filter(r=>r.ok&&!r.profiling).length,runs:scenario.runs.length,
  ...(run.blank_control?{blank_control_median:frames('blank_control')}:{}),
  phases:Object.fromEntries(run.phases.map(phase=>phase.kind==='frames'?[phase.name,{median_across_runs:frames(`${phase.name}.frames`)}]:[phase.name,{rounds:phase.trend.rounds,
  round_end:Object.fromEntries(CONSOLE_METRICS.filter(name=>phase.trend.end[name]?.n).map(name=>{const t=phase.trend.end[name];return [name,{first:t.first,last:t.last,max:t.max,second_half_not_higher:t.second_half_not_higher}];}))}])),
  settled:Object.fromEntries(CONSOLE_METRICS.filter(name=>finite(run.settled?.metrics?.[name])).map(name=>[name,run.settled.metrics[name]]))};
}

async function main(argv){
 let options;
 try{options=parseArgs(argv);}catch(error){console.error(String(error.message));console.error(USAGE);return 2;}
 if(options.help){console.log(USAGE);return 0;}
 const report=await measure(options);
 await mkdir(path.dirname(path.resolve(options.output)),{recursive:true});
 // Compact: a scenario's raw samples are thousands of numbers.
 await writeFile(options.output,JSON.stringify(report)+'\n');
 const failed=[...report.runs.filter(run=>!run.ok&&run.kind!=='prime'),...(report.scenario?.runs??[]).filter(run=>!run.ok).map(run=>({kind:'scenario_run',index:run.index,error:run.error}))];
 const pick=(kind,name)=>report.summary[kind]?.[name]?.median??null;
 console.log(JSON.stringify({ok:failed.length===0,output:path.resolve(options.output),cold_ok:report.coverage.cold.ok,warm_ok:report.coverage.warm.ok,profiler_pairs_ok:report.coverage.profiler_pairs.ok,
  median_first_submission_ms:{cold:pick('cold','player.first_successful_submission_ms'),warm:pick('warm','player.first_successful_submission_ms')},
  ...(report.scenario?{scenario:scenarioConsole(report.scenario)}:{}),
  ...(options.milestones.length?{median_milestone_presented_ms:Object.fromEntries(options.milestones.map(name=>[name,{cold:pick('cold',`milestone.${name}.presented_ms`),warm:pick('warm',`milestone.${name}.presented_ms`)}]))}:{}),
  failed:failed.map(run=>({kind:run.kind,index:run.index,error:run.error}))},null,1));
 return failed.length?1:0;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main(process.argv.slice(2)).then(code=>{process.exitCode=code;},error=>{console.error(String(error?.stack??error));process.exitCode=1;});
}
