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
//
// --url measures a page the caller serves instead (a platform harness with the player in an iframe,
// also a sandboxed one in its own process): reads go to the frame that runs the export index.html.
//
// --attach measures inside a browser that is already running (an Android WebView or Chrome reached
// over adb forward, or any browser with a DevTools port): it takes over one existing page instead of
// launching a browser, never closes the browser, and reads no OS process memory (the browser's
// processes are not this machine's). --adb-socket finds that endpoint on an Android device itself
// and lets the device reach this tool's server through adb reverse.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {createServer as createNetServer} from 'node:net';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import {parseScenario,runScenario,readProcessMemory,measureBlank,probeTouch,flattenFrames,usesTouch,runProcess,cpuTimes,hostCpuBusy,BLANK_PATH,BLANK_HTML} from './measure-web-scenario.mjs';

export const SCHEMA='unone.web-export-measurement.v1';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const round=n=>finite(n)?Math.round(n*1000)/1000:null;
const minus=(a,b)=>finite(a)&&finite(b)?round(a-b):null;
const printable=(value,max=64)=>typeof value==='string'&&value.length>=1&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);

// ---------------------------------------------------------------- options

const DEFAULTS=Object.freeze({cold:5,warm:5,profilePairs:1,milestones:[],settleMs:1000,frameWindowMs:1000,timeoutMs:60000,
 viewport:{width:1280,height:720},dpr:1,seed:'42',backend:null,cacheControl:null,compress:'none',network:null,cpuThrottle:1,
 browser:null,headed:false,keepStorage:false,allowDevelopment:false,wasmTiming:'split',includeProfileEvents:false,pollMs:100,scenario:null,scenarioRuns:1,scenarioProfile:false,blankControl:true,url:null,
 attach:null,attachTarget:null,servePort:0,adb:null,adbSerial:null,adbSocket:null,deviceLabel:null});
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
  [--url PAGE] [--serve-port PORT]
  [--attach http://HOST:PORT|ws://... [--attach-target TEXT]] [--device-label TEXT]
  [--adb-socket auto|package:NAME|SOCKET [--adb-serial SERIAL] [--adb PATH]]
  With --scenario, cold, warm and profiler pairs default to 0 unless given.
  A scenario may set bundle_trace to sample group holds/releases, broker image timings, actual image
  transfers and skipped draws by phase. Its expect_released list checks end-of-run ownership.
  bundle_trace.max_visible_queue_ms (0..600000) fails a run when a renderer waits longer for an
  image load slot, or when the player cannot report that timing.
  --url opens a page you serve instead of serving --export: the player may sit in an iframe of it, also a
  sandboxed (opaque-origin) one. --export still names the export that page serves, for the report's hashes.
  The page must pass ?unone_profile and ?unone_profile_limit on to the player frame for profiler runs.
  --attach takes over one page of a browser that is already running (its DevTools endpoint) instead of
  launching one; --attach-target picks the page by URL or title text. Nothing is cold there (cold runs are
  refused), the viewport is the device's unless --viewport/--dpr are given, and OS memory is not read.
  --adb-socket attaches to an Android WebView or Chrome over adb: it forwards the DevTools socket, lets the
  device reach this tool's server with adb reverse, records the device's build properties and removes
  both forwards afterwards. --serve-port fixes this tool's server port (default: any free one).`;

export function parseArgs(argv){
 const options={...DEFAULTS,milestones:[]},given=new Set(),take=(i,name)=>{const value=argv[i+1];if(value===undefined||value.startsWith('--'))throw Error(`MEASURE_ARG_INVALID: ${name} needs a value`);return value;};
 const count=(value,name,min=0)=>{const n=Number(value);if(!Number.isInteger(n)||n<min||n>100)throw Error(`MEASURE_ARG_INVALID: ${name} must be an integer ${min}..100`);return n;};
 const ms=(value,name)=>{const n=Number(value);if(!Number.isInteger(n)||n<0||n>600000)throw Error(`MEASURE_ARG_INVALID: ${name} must be whole milliseconds 0..600000`);return n;};
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];
  switch(arg){
   case '--export':options.export=take(i,arg);i++;break;
   case '--url':{const value=take(i,arg);let url;try{url=new URL(value);}catch{url=null;}
    if(!url||!['http:','https:'].includes(url.protocol))throw Error('MEASURE_ARG_INVALID: --url is the http(s) page that serves the export, e.g. your platform harness with the player in an iframe');
    options.url=url.href;i++;break;}
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
   case '--viewport':{const match=/^(\d{2,5})x(\d{2,5})$/.exec(take(i,arg));if(!match)throw Error('MEASURE_ARG_INVALID: --viewport is WIDTHxHEIGHT in CSS pixels, e.g. 926x428');options.viewport={width:Number(match[1]),height:Number(match[2])};given.add(arg);i++;break;}
   case '--dpr':{const n=Number(take(i,arg));if(!finite(n)||n<=0||n>8)throw Error('MEASURE_ARG_INVALID: --dpr must be in (0,8]');options.dpr=n;given.add(arg);i++;break;}
   case '--attach':options.attach=parseAttach(take(i,arg));i++;break;
   case '--attach-target':{const value=take(i,arg);if(!printable(value,200))throw Error('MEASURE_ARG_INVALID: --attach-target is 1-200 printable characters of the page URL or title');options.attachTarget=value;i++;break;}
   case '--serve-port':{const n=Number(take(i,arg));if(!Number.isInteger(n)||n<1024||n>65535)throw Error('MEASURE_ARG_INVALID: --serve-port is a TCP port 1024..65535');options.servePort=n;i++;break;}
   case '--adb':options.adb=take(i,arg);i++;break;
   case '--adb-serial':{const value=take(i,arg);if(!/^[\w.:\-]{1,128}$/.test(value))throw Error('MEASURE_ARG_INVALID: --adb-serial is a serial from adb devices, e.g. emulator-5554 or 127.0.0.1:5555');options.adbSerial=value;i++;break;}
   case '--adb-socket':{const value=take(i,arg);if(!/^(auto|package:[A-Za-z][\w.]{0,254}|[A-Za-z][\w.\-]{0,254})$/.test(value))throw Error('MEASURE_ARG_INVALID: --adb-socket is auto, package:<android package> or a DevTools socket name such as webview_devtools_remote_1234 or chrome_devtools_remote');options.adbSocket=value;i++;break;}
   case '--device-label':{const value=take(i,arg);if(!printable(value,200))throw Error('MEASURE_ARG_INVALID: --device-label is 1-200 printable characters, e.g. "BlueStacks emulator on this PC"');options.deviceLabel=value;i++;break;}
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
 // The page behind --url is served by its own server; this tool cannot change how.
 if(options.url&&(options.cacheControl!==null||options.compress!=='none'))throw Error("MEASURE_ARG_INVALID: --cache-control and --compress change this tool's own server; with --url the page's server decides");
 if(options.attach&&options.adbSocket)throw Error('MEASURE_ARG_INVALID: --adb-socket finds and forwards the DevTools endpoint itself; give --attach or --adb-socket, not both');
 if((options.adb||options.adbSerial)&&!options.adbSocket)throw Error('MEASURE_ARG_INVALID: --adb and --adb-serial only go with --adb-socket');
 const attached=Boolean(options.attach||options.adbSocket);
 if(options.attachTarget&&!attached)throw Error('MEASURE_ARG_INVALID: --attach-target picks a page of an attached browser; give --attach or --adb-socket');
 if(attached){
  // The attached browser is one long-lived process this tool did not start and will not close.
  if(options.browser||options.headed)throw Error('MEASURE_ARG_INVALID: --browser and --headed launch a browser; an attached one (--attach, --adb-socket) is already running');
  if(given.has('--cold')&&options.cold>0)throw Error('MEASURE_ARG_INVALID: a cold run is a new browser process and profile; an attached browser (--attach, --adb-socket) is one process that stays up, so measure --warm runs there');
  options.cold=0;
  // Its viewport is the device's own unless one is asked for.
  if(!given.has('--viewport'))options.viewport=null;
  if(!given.has('--dpr'))options.dpr=null;
 }
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

/**
 * A DevTools endpoint of a running browser: its HTTP root (http://127.0.0.1:9222, what adb forward
 * gives) or one WebSocket, the browser's (ws://.../devtools/browser/...) or a page's
 * (ws://.../devtools/page/<id>).
 */
export function parseAttach(value){
 let url;try{url=new URL(value);}catch{url=null;}
 const invalid=()=>Error('MEASURE_ARG_INVALID: --attach is a DevTools endpoint: http://127.0.0.1:PORT (e.g. after adb forward tcp:PORT localabstract:webview_devtools_remote_<pid>), ws://HOST:PORT/devtools/browser/<id> or ws://HOST:PORT/devtools/page/<id>');
 if(!url||!url.hostname)throw invalid();
 if(url.protocol==='http:'){if(url.search||url.hash||!['','/','/json','/json/version','/json/list'].includes(url.pathname))throw invalid();return {http:`http://${url.host}/`,ws:null,kind:null,targetId:null};}
 if(url.protocol!=='ws:')throw invalid();
 const match=/^\/devtools\/(browser|page)(?:\/([^/]+))?$/.exec(url.pathname);
 if(!match||match[1]==='page'&&!match[2])throw invalid();
 return {http:`http://${url.host}/`,ws:url.href,kind:match[1],targetId:match[1]==='page'?decodeURIComponent(match[2]):null};
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
 // Observed through the first submission: an observer, and its list not filled before then (later tasks were lost).
 const fullAt=minus(raw?.probe?.long_tasks_full_at,boot);
 const observed=Array.isArray(raw?.probe?.long_tasks)&&!(finite(fullAt)&&firstSubmission!==null&&fullAt<firstSubmission);
 const longTasks=Array.isArray(raw?.probe?.long_tasks)?raw.probe.long_tasks.map(task=>({start_ms:minus(task.start_ms,boot),duration_ms:round(task.duration_ms)})):null;
 const beforeFirst=(longTasks??[]).filter(task=>firstSubmission!==null&&finite(task.start_ms)&&task.start_ms<firstSubmission);
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
  'long_tasks.before_first_submission':firstSubmission===null||!observed?null:beforeFirst.length,
  'long_tasks.ms_before_first_submission':firstSubmission===null||!observed?null:round(beforeFirst.reduce((sum,task)=>sum+(task.duration_ms??0),0)),
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
  page:{device_pixel_ratio:raw?.dpr??null,inner_size:raw?.inner??null,screen_size:raw?.screen??null,max_touch_points:finite(raw?.touch_points)?raw.touch_points:null,user_agent:raw?.ua??null,backend:metrics?.backend??null,renderer:metrics?.renderer??null,seed:metrics?.seed??null,seed_source:metrics?.seed_source??null,
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

export async function startServer(root,{cachePolicy=null,cacheControl=null,compress='none',port=0}={}){
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
 await new Promise((resolve,reject)=>{server.once('error',error=>reject(error.code==='EADDRINUSE'?Error(`MEASURE_SERVE_PORT_BUSY: 127.0.0.1:${port} is in use; pick another --serve-port`):error));server.listen(port,'127.0.0.1',resolve);});
 // A browser on another device (adb reverse) can keep a connection open after its page went blank.
 const close=()=>new Promise(resolve=>{server.close(()=>resolve());server.closeIdleConnections();setTimeout(()=>server.closeAllConnections(),2000).unref();});
 return {url:`http://127.0.0.1:${server.address().port}/`,log,take(){return log.splice(0,log.length);},close};
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
 const gpu=await readGpu(cdp);
 async function close(){
  try{await cdp.send('Browser.close',{},undefined,5000);}catch{}
  let closeTimer=null;
  await Promise.race([wasClosed,new Promise(resolve=>{closeTimer=setTimeout(resolve,10000);})]);
  clearTimeout(closeTimer);
  if(!closed){cdp.close();if(browserPid)try{process.kill(browserPid);}catch{}}
  // The browser's helper processes release the profile a moment after it closes.
  for(let i=0;i<40;i++){try{await rm(profileDir,{recursive:true,force:true});break;}catch{await sleep(250);}}
 }
 return {cdp,version,gpu,args,close,attached:null,target:null,direct:false,leave:[]};
}

async function readGpu(cdp){
 try{const info=await cdp.send('SystemInfo.getInfo',{},undefined,10000);return {devices:(info.gpu?.devices??[]).map(d=>({vendor_id:d.vendorId,device_id:d.deviceId,vendor:d.vendorString,device:d.deviceString,driver_vendor:d.driverVendor,driver_version:d.driverVersion})),feature_status:info.gpu?.featureStatus??null};}
 catch{return null;}
}

// ---------------------------------------------------------------- a browser that is already running (--attach)

const shortUrl=url=>{try{return pageWithoutQuery(url);}catch{return String(url??'').slice(0,200);}};
const rehost=(ws,http)=>{const url=new URL(ws);url.host=new URL(http).host;return url.href;};

/** /json/list rows as targets; an Android WebView row's description is JSON saying whether it is shown. */
export function listTargets(list){
 return (Array.isArray(list)?list:[]).map(row=>{let d=null;try{d=row.description?JSON.parse(row.description):null;}catch{}
  return {id:row.id,type:row.type,url:row.url??'',title:row.title??'',webSocketDebuggerUrl:row.webSocketDebuggerUrl??null,visible:typeof d?.visible==='boolean'?d.visible:null,
   size:finite(d?.width)&&finite(d?.height)?{width:d.width,height:d.height}:null};});
}

/**
 * The page to measure among an attached browser's targets: the one whose URL or title contains
 * `match`; without one, the only page, else the only visible page. Anything else fails and lists them.
 */
export function pickPageTarget(targets,match=null){
 const pages=(targets??[]).filter(t=>t.type==='page');
 const describe=list=>list.map(t=>`${shortUrl(t.url)}${t.title?` "${t.title}"`:''}${t.visible===true?' (visible)':t.visible===false?' (hidden)':''}`).join('; ')||'none';
 let found=pages,selectedBy='the only page';
 if(match){found=pages.filter(t=>String(t.url).includes(match)||String(t.title).includes(match));selectedBy='--attach-target';}
 else if(pages.length>1){const visible=pages.filter(t=>t.visible===true);if(visible.length===1){found=visible;selectedBy='the only visible page';}}
 if(found.length===1)return {...found[0],selected_by:selectedBy};
 if(!found.length)throw Error(`MEASURE_ATTACH_NO_PAGE: ${match?`no page's URL or title contains "${match}"`:'the attached browser shows no page'} (pages: ${describe(pages)}); open the app's WebView or a tab first`);
 throw Error(`MEASURE_ATTACH_AMBIGUOUS: ${found.length} pages${match?` contain "${match}"`:''} (${describe(found)}); pick one with --attach-target <text of its URL or title>`);
}

/**
 * Connect to a running browser's DevTools endpoint and choose the page to take over. The browser
 * WebSocket is used when the endpoint has one; otherwise the chosen page's own WebSocket. close()
 * leaves the page (each openPage registers how) and disconnects: the browser keeps running.
 */
async function attachBrowser(attach,options,via=null){
 const getJson=async name=>{const response=await fetch(new URL(name,attach.http),{signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error(`HTTP ${response.status}`);return response.json();};
 let info=null,list=null;
 try{info=await getJson('json/version');}catch(error){if(!attach.ws)throw Error(`MEASURE_ATTACH_UNREACHABLE: nothing answers ${attach.http}json/version (${error.message}); forward the DevTools socket first (adb forward tcp:PORT localabstract:webview_devtools_remote_<pid>) or use --adb-socket`);}
 try{list=listTargets(await getJson('json/list'));}catch{}
 const browserWs=attach.kind==='browser'?attach.ws:attach.kind===null&&typeof info?.webSocketDebuggerUrl==='string'?rehost(info.webSocketDebuggerUrl,attach.http):null;
 let cdp,target,direct=false;
 if(browserWs){
  cdp=await Cdp.connect(browserWs);
  try{const {targetInfos}=await cdp.send('Target.getTargets');const shown=new Map((list??[]).map(t=>[t.id,t]));
   target=pickPageTarget(targetInfos.map(t=>({id:t.targetId,type:t.type,url:t.url,title:t.title,visible:shown.get(t.targetId)?.visible??null,size:shown.get(t.targetId)?.size??null})),options.attachTarget);}
  catch(error){cdp.close();throw error;}
 }else{
  if(attach.kind==='page')target={...((list??[]).find(t=>t.id===attach.targetId)??{id:attach.targetId,type:'page',url:'',title:'',visible:null,size:null}),webSocketDebuggerUrl:attach.ws,selected_by:'--attach page WebSocket'};
  else{if(!list)throw Error(`MEASURE_ATTACH_UNREACHABLE: ${attach.http}json/list lists no targets`);target=pickPageTarget(list,options.attachTarget);}
  // DevTools hands a page's WebSocket to one client at a time.
  if(!target.webSocketDebuggerUrl)throw Error(`MEASURE_ATTACH_BUSY: ${shortUrl(target.url)} has no free DevTools WebSocket (another client, e.g. chrome://inspect, holds it); close that client`);
  cdp=await Cdp.connect(attach.kind==='page'?attach.ws:rehost(target.webSocketDebuggerUrl,attach.http));direct=true;
 }
 let version=null;
 try{const v=await cdp.send('Browser.getVersion',{},undefined,5000);version={product:v.product,userAgent:v.userAgent,jsVersion:v.jsVersion,protocolVersion:v.protocolVersion};}
 catch{version={product:info?.Browser??null,userAgent:info?.['User-Agent']??null,jsVersion:info?.['V8-Version']??null,protocolVersion:info?.['Protocol-Version']??null};}
 const gpu=await readGpu(cdp),leave=[];
 async function close(){for(const step of leave.splice(0).reverse())try{await step();}catch{}cdp.close();}
 return {cdp,version,gpu,args:null,close,leave,direct,target,
  attached:{endpoint:attach.http,connection:direct?'the page\'s own WebSocket':'the browser WebSocket',android_package:info?.['Android-Package']??null,via,
   page_at_attach:{url:shortUrl(target.url),title:target.title||null,visible:target.visible??null,size:target.size??null,selected_by:target.selected_by}}};
}

// ---------------------------------------------------------------- Android over adb (--adb-socket)

/** adb: --adb, UNONE_ADB_PATH, an Android SDK's platform-tools, else whatever `adb` is on PATH. */
export function findAdb(explicit,{env=process.env,exists=existsSync,platform=process.platform,home=os.homedir()}={}){
 if(explicit){if(!exists(explicit))throw Error(`MEASURE_ADB_MISSING: ${explicit} does not exist`);return explicit;}
 const exe=platform==='win32'?'adb.exe':'adb';
 const candidates=[env.UNONE_ADB_PATH,...[env.ANDROID_HOME,env.ANDROID_SDK_ROOT,env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'Android','Sdk'),path.join(home,'Library','Android','sdk'),path.join(home,'Android','Sdk')].filter(Boolean).map(sdk=>path.join(sdk,'platform-tools',exe))];
 return candidates.filter(Boolean).find(candidate=>exists(candidate))??'adb';
}

/** Listening DevTools sockets from the device's /proc/net/unix: @webview_devtools_remote_<pid>, @chrome_devtools_remote, ... */
export function parseDevtoolsSockets(text){
 const found=new Map();
 for(const line of String(text).split(/\r?\n/)){
  const socket=/\s@([\w.\-]*devtools_remote[\w.\-]*)\s*$/.exec(line)?.[1];if(!socket||found.has(socket))continue;
  const pid=/_devtools_remote_(\d+)$/.exec(socket)?.[1];
  found.set(socket,{socket,kind:socket.startsWith('webview_devtools_remote')?'webview':socket.startsWith('chrome_devtools_remote')?'chrome':'other',pid:pid?Number(pid):null});
 }
 return [...found.values()];
}

/** The socket --adb-socket names: auto (the only one), package:<name> (that app's WebView) or a socket name. */
export function chooseSocket(sockets,want,{pids=null,packageOf=new Map()}={}){
 const describe=()=>sockets.map(s=>s.socket+(s.pid&&packageOf.get(s.pid)?` (${packageOf.get(s.pid)})`:'')).join(', ')||'none';
 const pkg=want.startsWith('package:')?want.slice(8):null;
 const found=want==='auto'?sockets:pkg?sockets.filter(s=>s.pid!==null&&(pids??[]).includes(s.pid)):sockets.filter(s=>s.socket===want);
 if(found.length===1)return found[0];
 if(!found.length){
  const why=want==='auto'?'no app on the device has a DevTools socket open':pkg?(pids?.length?`${pkg} is running but has no WebView DevTools socket: its WebView debugging is off (the app calls WebView.setWebContentsDebuggingEnabled(true) only in a debug or test build) or it has not created a WebView yet`:`${pkg} is not running`):`there is no socket named ${want}`;
  throw Error(`MEASURE_ADB_NO_SOCKET: ${why} (sockets: ${describe()}); open the page in the app first`);
 }
 throw Error(`MEASURE_ADB_AMBIGUOUS: ${found.length} DevTools sockets (${describe()}); pick one with --adb-socket <socket> or --adb-socket package:<name>`);
}

/** `adb shell getprop` output as an object. */
export function parseGetprop(text){
 const out={};for(const match of String(text).matchAll(/^\[([^\]]+)\]: \[([^\]]*)\]\s*$/gm))out[match[1]]=match[2];return out;
}

/** The current WebView provider from `adb shell dumpsys webviewupdate`, or null. */
export function parseWebViewProvider(text){
 const match=/Current WebView package \(name, version\): \(([^,()]+), ([^()]+)\)/.exec(String(text));
 return match?{package:match[1].trim(),version:match[2].trim()}:null;
}

const DEVICE_PROPS=Object.freeze({manufacturer:'ro.product.manufacturer',brand:'ro.product.brand',model:'ro.product.model',device:'ro.product.device',android_release:'ro.build.version.release',
 sdk:'ro.build.version.sdk',build_type:'ro.build.type',abi:'ro.product.cpu.abi',abi_list:'ro.product.cpu.abilist',hardware:'ro.hardware',characteristics:'ro.build.characteristics'});

/**
 * What the device says it is: a few build properties (no serial or identifiers) and every property an
 * emulator is known to set. An emulator can report a phone's maker and model (BlueStacks does), so
 * emulator is true only when such a property is present and null otherwise, never false.
 */
export function deviceInfo(props){
 const out={};for(const [name,key] of Object.entries(DEVICE_PROPS))out[name]=props[key]||null;
 // BlueStacks 16 reports samsung SM-S942B with ro.hardware qcom, but runs init.svc.bstsvcmgrtest,
 // init.svc.vendor.RTVboxGuestService and ro.hardware.egl=emulation.
 const markers=Object.entries(props).filter(([key,value])=>/qemu|bluestacks|vbox|genymotion|ldplayer|(^|[._])(bst|nox|memu)/i.test(key)&&value!==''&&value!=='0'
  ||(key==='ro.hardware'||key==='ro.boot.hardware'||key==='ro.product.board')&&/^(ranchu|goldfish|vbox86|cutf_cvm)$/i.test(value)
  ||key==='ro.hardware.egl'&&value==='emulation')
  .map(([key,value])=>({key,value:/(^|[._])(id|serial|imei|mac|guid|uuid)([._]|$)/i.test(key)?'(identifier not recorded)':value.slice(0,64)}));
 return {...out,emulator:markers.length?true:null,emulator_markers:markers.slice(0,32)};
}

async function freeLocalPort(){
 const server=createNetServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const {port}=server.address();await new Promise(resolve=>server.close(resolve));return port;
}

/**
 * Find the DevTools socket on an Android device, forward it to a free local port, let the device reach
 * this tool's server through adb reverse, and read what the device is. close() removes both forwards.
 */
export async function adbConnect(options,{serverPort=null,run=runProcess,freePort=freeLocalPort}={}){
 const adb=findAdb(options.adb);
 const call=async(args,timeoutMs=15000)=>{
  try{return await run(adb,[...(options.adbSerial?['-s',options.adbSerial]:[]),...args],{timeoutMs});}
  catch(error){if(error.code==='ENOENT')throw Error(`MEASURE_ADB_MISSING: ${adb} not found; install Android platform-tools or pass --adb <path to adb> (BlueStacks ships HD-Adb.exe in its install folder)`);
   throw Error(`MEASURE_ADB_FAILED: adb ${args.join(' ')}: ${String(error.message??error).trim()}`);}
 };
 const state=(await call(['get-state'])).trim();
 if(state!=='device')throw Error(`MEASURE_ADB_NO_DEVICE: adb get-state says "${state}"; connect and authorize the device (adb devices), or pass --adb-serial`);
 const sockets=parseDevtoolsSockets(await call(['shell','cat','/proc/net/unix']));
 const packageOf=new Map();
 for(const s of sockets)if(s.pid)try{packageOf.set(s.pid,(await call(['shell','cat',`/proc/${s.pid}/cmdline`])).split('\0')[0].trim()||null);}catch{}
 let pids=null;
 if(options.adbSocket.startsWith('package:'))pids=(await call(['shell','pidof',options.adbSocket.slice(8)]).catch(()=>'')).trim().split(/\s+/).filter(Boolean).map(Number).filter(Number.isSafeInteger);
 const socket=chooseSocket(sockets,options.adbSocket,{pids,packageOf});
 const device=deviceInfo(parseGetprop(await call(['shell','getprop'])));
 try{device.webview_provider=parseWebViewProvider(await call(['shell','dumpsys','webviewupdate']));}catch{device.webview_provider=null;}
 const hostPort=await freePort(),removals=[];
 const undo=async()=>{for(const args of removals.splice(0).reverse())await call(args).catch(()=>{});};
 try{
  await call(['forward',`tcp:${hostPort}`,`localabstract:${socket.socket}`]);removals.push(['forward','--remove',`tcp:${hostPort}`]);
  if(serverPort){await call(['reverse',`tcp:${serverPort}`,`tcp:${serverPort}`]);removals.push(['reverse','--remove',`tcp:${serverPort}`]);}
 }catch(error){await undo();throw error;}
 return {endpoint:{http:`http://127.0.0.1:${hostPort}/`,ws:null,kind:null,targetId:null},device,
  via:{tool:'adb',adb:path.basename(adb),socket:socket.socket,socket_kind:socket.kind,package:socket.pid?packageOf.get(socket.pid)??null:null,
   forward:`this machine tcp:${hostPort} -> device localabstract:${socket.socket}`,reverse:serverPort?`device tcp:${serverPort} -> this machine tcp:${serverPort}`:null},
  close:undo};
}

// Instrumentation added to every document before its own scripts. Timing only: every wrapper
// returns what the original returns, and a 'split' instantiateStreaming does exactly the two steps
// instantiateStreaming is specified as (compileStreaming, then instantiate).
const BUNDLE_RESOURCE_TIMING_ENTRIES=20000;

export function probeSource({wasmTiming='split',embedded=false,bundleTrace=false}={}){
 // A page that embeds the player (--url) is instrumented in every frame: which one runs the player
 // is only known once its document has parsed.
 return `(()=>{if((!${embedded===true}&&window.top!==window)||window.__unoneMeasure)return;
${bundleTrace?`performance.setResourceTimingBufferSize?.(${BUNDLE_RESOURCE_TIMING_ENTRIES});`:''}
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
// No longtask observer (an observer that silently ignores the type included): null, so readers report unknown rather
// than no long task. The list keeps 4096; long_tasks_full_at is the end of the last kept one once it is full: later
// ones are lost, so a window ending after it cannot know its long tasks. Readers call drain_long_tasks first, so
// entries the observer has not delivered yet are counted.
probe.long_tasks_full_at=null;
try{if(!PerformanceObserver.supportedEntryTypes?.includes('longtask'))throw Error('no longtask entries');
 const keep=entries=>{for(const e of entries){if(probe.long_tasks.length>=4096)continue;probe.long_tasks.push({start_ms:e.startTime,duration_ms:e.duration});
  if(probe.long_tasks.length===4096)probe.long_tasks_full_at=e.startTime+e.duration;}};
 const observer=new PerformanceObserver(list=>keep(list.getEntries()));observer.observe({type:'longtask',buffered:true});
 Object.defineProperty(probe,'drain_long_tasks',{value:()=>keep(observer.takeRecords())});}catch{probe.long_tasks=null;}
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
try{window.__unoneMeasure?.drain_long_tasks?.();}catch{}
return {boot:window.playerBoot??null,time_origin:performance.timeOrigin,now:performance.now(),visibility:document.visibilityState,focused:document.hasFocus(),dpr:devicePixelRatio,inner:[innerWidth,innerHeight],screen:[screen.width,screen.height],touch_points:navigator.maxTouchPoints,ua:navigator.userAgent,
metrics:parse(d.playerMetrics),startup:parse(d.playerStartup),error:d.playerError??null,playerPerformance:parse(d.playerPerformance),
nav:nav?nav.toJSON():null,resources:performance.getEntriesByType('resource').map(e=>e.toJSON()),paints:performance.getEntriesByType('paint').map(e=>({name:e.name,start_ms:e.startTime})),
perf,assets,profile,probe:window.__unoneMeasure??null};})())`;
}

const POLL_SOURCE=`(()=>{const d=document.body?.dataset??{};let presented=[];try{presented=(window.unonePlayerPerformance?.snapshot({windowMs:1000})?.milestones?.rows??[]).filter(r=>r.presented_at_ms!==null).map(r=>r.name);}catch{}
return JSON.stringify({error:d.playerError??null,ready:Boolean(d.playerMetrics&&JSON.parse(d.playerMetrics).first_presented_ms!==undefined),presented,milestones:Boolean(window.unonePlayerPerformance?.snapshot({windowMs:1000})?.milestones)});})()`;

// The player frame of a page that embeds it (--url): a document whose head is the export's
// index.html (it sets window.playerBoot before any module and names the runtime in a meta tag).
const PLAYER_TEST='typeof window.playerBoot==="number"||Boolean(document.querySelector(\'meta[name="unone-runtime"]\'))';

/**
 * Scenario input is authored in CSS pixels of the player's own viewport; a player in an iframe gets
 * pointer coordinates moved by that iframe's content-box origin in the page. Keys go to the focused
 * frame, so they need no move.
 */
export function shiftInput(method,params,offset){
 if(!offset||(offset.x===0&&offset.y===0))return params;
 if(method==='Input.dispatchMouseEvent')return {...params,x:params.x+offset.x,y:params.y+offset.y};
 if(method==='Input.dispatchTouchEvent')return {...params,touchPoints:(params.touchPoints??[]).map(point=>({...point,x:point.x+offset.x,y:point.y+offset.y}))};
 return params;
}

const TOUCH_POINTS=5;

async function openPage(browser,options){
 const {cdp}=browser;let targetId,sessionId;
 // A launched browser gets a new tab; an attached one lends its chosen page (over the browser
 // WebSocket as a session, or as the page's own WebSocket with no session id).
 if(browser.target){targetId=browser.target.id;if(!browser.direct)({sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true}));}
 else{({targetId}=await cdp.send('Target.createTarget',{url:'about:blank'}));({sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true}));}
 const send=(method,params={},timeoutMs)=>cdp.send(method,params,sessionId,timeoutMs);
 let touchEmulated=false,touchPoints=null;
 const embedded=Boolean(options.url),probe=probeSource({...options,embedded});
 // The page's session plus, when it embeds the player, each out-of-process frame it attaches (a
 // sandboxed iframe usually is one). contexts: default execution contexts by id, with their frame.
 const sessions=new Map([[sessionId,{parent:null,root:targetId,contexts:new Map()}]]);
 const frameParents=new Map();
 let player=null,geometry=null,playerOrigin=null;
 const network=new Map(),consoleErrors=[];let collecting=false,readyResolve=null;
 async function attach(parent,info,child){
  const run=()=>cdp.send('Runtime.runIfWaitingForDebugger',{},child).catch(()=>{});
  if(info.type!=='iframe'){await run();return;}
  sessions.set(child,{parent,root:info.targetId,contexts:new Map()});
  const to=(method,params={})=>cdp.send(method,params,child);
  try{
   await to('Page.enable');await to('Runtime.enable');await to('Network.enable');
   await to('Page.addScriptToEvaluateOnNewDocument',{source:probe});
   await to('Emulation.setFocusEmulationEnabled',{enabled:true}).catch(()=>{});
   if(touchEmulated)await to('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:TOUCH_POINTS}).catch(()=>{});
   await to('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true});
  }catch{}
  await run();
 }
 cdp.on(message=>{
  const session=sessions.get(message.sessionId);if(!session)return;const p=message.params??{};
  switch(message.method){
   case 'Target.attachedToTarget':attach(message.sessionId,p.targetInfo??{},p.sessionId);return;
   case 'Target.detachedFromTarget':sessions.delete(p.sessionId);if(player?.sessionId===p.sessionId)player=geometry=null;return;
   case 'Runtime.executionContextCreated':{const c=p.context??{};if(c.auxData?.isDefault)session.contexts.set(c.id,{frameId:c.auxData.frameId});return;}
   case 'Runtime.executionContextDestroyed':session.contexts.delete(p.executionContextId);if(player?.sessionId===message.sessionId&&player.contextId===p.executionContextId)player=geometry=null;return;
   case 'Runtime.executionContextsCleared':session.contexts.clear();if(player?.sessionId===message.sessionId)player=geometry=null;return;
   case 'Page.frameAttached':frameParents.set(p.frameId,p.parentFrameId);return;
  }
  if(message.method==='Runtime.consoleAPICalled'){
   const text=(p.args??[]).map(arg=>arg.value??arg.description??'').join(' ');
   if(text.startsWith('UNONE_PLAYER_READY '))readyResolve?.('ready');
   if(p.type==='error'&&consoleErrors.length<32)consoleErrors.push(text.slice(0,2000));
   if(p.type==='error')readyResolve?.('error');
   return;
  }
  if(message.method==='Runtime.exceptionThrown'){if(consoleErrors.length<32)consoleErrors.push(String(p.exceptionDetails?.exception?.description??p.exceptionDetails?.text??'exception').slice(0,2000));readyResolve?.('error');return;}
  if(!collecting)return;
  // Request ids are per session: an out-of-process frame numbers its own.
  const key=`${message.sessionId}|${p.requestId}`;
  if(message.method==='Network.requestWillBeSent'){if(network.size<4096)network.set(key,{url:p.request?.url,type:p.type??null,status:null,fromDiskCache:false,servedFromCache:false,fromServiceWorker:false,fromPrefetchCache:false,encodedDataLength:null,protocol:null,mimeType:null,failed:false});}
  else if(message.method==='Network.requestServedFromCache'){const row=network.get(key);if(row)row.servedFromCache=true;}
  else if(message.method==='Network.responseReceived'){const row=network.get(key);if(row){const r=p.response??{};Object.assign(row,{status:r.status??null,fromDiskCache:r.fromDiskCache===true,fromServiceWorker:r.fromServiceWorker===true,fromPrefetchCache:r.fromPrefetchCache===true,protocol:r.protocol??null,mimeType:r.mimeType??null});}}
  else if(message.method==='Network.loadingFinished'){const row=network.get(key);if(row)row.encodedDataLength=p.encodedDataLength??null;}
  else if(message.method==='Network.loadingFailed'){const row=network.get(key);if(row){row.failed=true;row.error=p.errorText??null;}}
 });
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
 // An attached browser keeps its own viewport (a phone's screen) unless one is asked for.
 if(options.viewport||options.dpr)await send('Emulation.setDeviceMetricsOverride',{width:options.viewport?.width??0,height:options.viewport?.height??0,deviceScaleFactor:options.dpr??0,mobile:false});
 if(browser.attached)await send('Emulation.setFocusEmulationEnabled',{enabled:true}).catch(()=>{});
 else await send('Emulation.setFocusEmulationEnabled',{enabled:true});
 // A scenario with touch steps: the game sees a touch device from its first frame, as on a phone.
 // An attached browser that already has touch points (a phone, an emulator) is left as it is.
 if(options.touch){
  if(browser.attached)try{touchPoints=await evaluateIn(null,'navigator.maxTouchPoints',5000);}catch{}
  if(!(touchPoints>0)){await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:TOUCH_POINTS});touchEmulated=true;}
 }
 // Leaving an attached page: blank it (the game stops drawing and playing) and let it go.
 if(browser.attached)browser.leave.push(async()=>{await send('Page.navigate',{url:'about:blank'},5000).catch(()=>{});if(sessionId)await cdp.send('Target.detachFromTarget',{sessionId},undefined,5000).catch(()=>{});});
 if(options.cpuThrottle!==1)await send('Emulation.setCPUThrottlingRate',{rate:options.cpuThrottle});
 if(options.network)await send('Network.emulateNetworkConditions',{offline:false,latency:options.network.latency_ms,downloadThroughput:options.network.download_kbps*1000/8,uploadThroughput:options.network.upload_kbps*1000/8});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:probe});
 // Out-of-process frames pause at start until they carry the same probe.
 if(embedded)await send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true});
 async function evaluateIn(target,expression,timeoutMs){
  const result=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,...(target?{contextId:target.contextId}:{})},target?.sessionId??sessionId,timeoutMs);
  if(result.exceptionDetails)throw Error(`MEASURE_EVALUATE_FAILED: ${result.exceptionDetails.exception?.description??result.exceptionDetails.text}`);return result.result?.value;
 }
 async function findPlayer(){
  if(player||!embedded)return player;
  const found=[];
  for(const [sid,session] of sessions)for(const [contextId,context] of session.contexts){
   try{if(await evaluateIn({sessionId:sid,contextId},PLAYER_TEST,3000)===true)found.push({sessionId:sid,contextId,frameId:context.frameId,out_of_process:session.parent!==null});}catch{}
  }
  if(found.length>1)throw Error(`MEASURE_PLAYER_AMBIGUOUS: ${found.length} frames of the page run a Unone player; measure a page with one`);
  player=found[0]??null;geometry=null;return player;
 }
 const notFound=()=>Error('MEASURE_PLAYER_NOT_FOUND: no frame of the page runs a Unone player (the export index.html) yet');
 // The player: the page itself, or for --url the one frame that runs it.
 async function evaluate(expression,timeoutMs=15000){
  if(!embedded)return evaluateIn(null,expression,timeoutMs);
  const target=await findPlayer();if(!target)throw notFound();
  return evaluateIn(target,expression,timeoutMs);
 }
 const evaluateTop=(expression,timeoutMs=15000)=>evaluateIn(null,expression,timeoutMs);
 // Where the player frame sits in the page, and the iframe element that owns it.
 async function playerGeometry(){
  const target=await findPlayer();if(!target)throw notFound();
  if(geometry&&Date.now()-geometry.at<1000)return geometry;
  if(target.sessionId===sessionId&&target.frameId===targetId){geometry={at:Date.now(),x:0,y:0,owner:null};return geometry;}
  // An out-of-process frame's iframe element lives in its parent's session, an in-process one's in the page's.
  const session=sessions.get(target.sessionId),ownerSession=session.parent!==null&&target.frameId===session.root?session.parent:target.sessionId;
  const parentFrame=frameParents.get(target.frameId);
  if(ownerSession!==sessionId||(parentFrame!==undefined&&parentFrame!==targetId))throw Error('MEASURE_PLAYER_NESTED: the player frame is not a direct iframe of the page; only a player in the page or in one of its iframes is supported');
  await cdp.send('DOM.getDocument',{depth:0},ownerSession);
  const {backendNodeId}=await cdp.send('DOM.getFrameOwner',{frameId:target.frameId},ownerSession);
  const {model}=await cdp.send('DOM.getBoxModel',{backendNodeId},ownerSession);
  geometry={at:Date.now(),x:model.content[0],y:model.content[1],width:model.width,height:model.height,owner:{sessionId:ownerSession,backendNodeId}};
  return geometry;
 }
 // Focus moves into the player frame the way a click would; keys then reach it.
 async function focusPlayer(){const g=await playerGeometry();if(g.owner)await cdp.send('DOM.focus',{backendNodeId:g.owner.backendNodeId},g.owner.sessionId);}
 async function sendTo(method,params={},timeoutMs){
  if(!embedded)return send(method,params,timeoutMs);
  if(method==='Input.dispatchMouseEvent'||method==='Input.dispatchTouchEvent')return send(method,shiftInput(method,params,await playerGeometry()),timeoutMs);
  if(method==='Input.dispatchKeyEvent'){if(params.type==='keyDown'||params.type==='rawKeyDown')await focusPlayer().catch(()=>{});return send(method,params,timeoutMs);}
  // The player's heap is its own renderer's when it runs out of process.
  if(method==='Runtime.getHeapUsage'||method==='Memory.getDOMCounters'||method.startsWith('Performance.')){const target=await findPlayer();return cdp.send(method,params,target?.sessionId??sessionId,timeoutMs);}
  return send(method,params,timeoutMs);
 }
 async function playerFrame(){
  if(!embedded)return null;
  const target=await findPlayer().catch(()=>null);if(!target)return {found:false};
  let where=null;try{where=JSON.parse(await evaluateIn(target,'JSON.stringify({url:location.origin+location.pathname,document_origin:self.origin})',5000));}catch{}
  let g=null;try{g=await playerGeometry();}catch(error){g={error:String(error.message??error)};}
  return {found:true,out_of_process:target.out_of_process,url:where?.url??null,document_origin:where?.document_origin??null,
   offset:g&&!g.error?{x:g.x,y:g.y,width:g.width??null,height:g.height??null}:null,...(g?.error?{geometry_error:g.error}:{})};
 }
 async function load(url,{origin,keepStorage,milestones,timeoutMs,settleMs,pollMs,frameWindowMs}){
  await send('Page.navigate',{url:'about:blank'});await sleep(100);player=geometry=null;
  let storageError=null;
  if(!keepStorage)for(const o of new Set([origin,playerOrigin].filter(o=>o&&o!=='null')))await send('Storage.clearDataForOrigin',{origin:o,storageTypes:'local_storage,indexeddb,service_workers,cache_storage'}).catch(error=>{if(!browser.attached)throw error;storageError??=String(error.message??error);});
  network.clear();consoleErrors.length=0;collecting=true;
  const readyOrError=new Promise(resolve=>{readyResolve=resolve;});
  const started=Date.now();
  await send('Page.navigate',{url});
  // The timer is cleared once ready: a pending one would keep the process alive for timeoutMs after the report.
  let readyTimer=null;
  const first=await Promise.race([readyOrError,new Promise(resolve=>{readyTimer=setTimeout(()=>resolve('timeout'),timeoutMs);})]);
  clearTimeout(readyTimer);readyResolve=null;
  let outcome={ready:first==='ready',error:null,presented:[],milestones:false,timedOut:first==='timeout'},focused=false;
  // A console error is not necessarily fatal; the player's own error attribute is.
  for(;;){
   let poll=null;
   try{poll=JSON.parse(await evaluate(POLL_SOURCE,5000));}
   catch(error){const message=String(error.message??error);if(!(embedded&&message.startsWith('MEASURE_PLAYER_NOT_FOUND'))){outcome.error??=message;break;}}
   if(poll)outcome={...outcome,...poll};
   if(outcome.error)break;
   // A player in an iframe runs focused, like one a person clicked into.
   if(embedded&&poll&&!focused){focused=true;await focusPlayer().catch(()=>{});}
   const waiting=milestones.filter(name=>!outcome.presented.includes(name));
   if(poll&&outcome.ready&&waiting.length===0)break;
   if(Date.now()-started>timeoutMs){outcome.timedOut=true;break;}
   await sleep(pollMs);
  }
  if(!outcome.error&&outcome.ready&&settleMs>0)await sleep(settleMs);
  let raw=null,collectError=null;
  try{raw=JSON.parse(await evaluate(collectSource({frameWindowMs}),20000));}catch(error){collectError=String(error.message??error);}
  if(raw){try{await sendTo('Performance.enable');const {metrics}=await sendTo('Performance.getMetrics');raw.cdp_metrics=Object.fromEntries(metrics.map(m=>[m.name,m.value]));await sendTo('Performance.disable');}catch{}}
  if(embedded&&player)try{const o=await evaluateIn(player,'self.origin',3000);playerOrigin=o!==origin?o:null;}catch{}
  collecting=false;
  if(raw)raw.console_errors=[...consoleErrors];
  const waiting=milestones.filter(name=>!outcome.presented.includes(name));
  const error=raw?.error??outcome.error??collectError??(outcome.ready?null:outcome.timedOut?`MEASURE_TIMEOUT: no first presented frame within ${timeoutMs} ms${embedded&&!player?' (no frame of the page runs a Unone player)':''}`:'MEASURE_NOT_READY')
   ??(waiting.length?`MEASURE_MILESTONE_TIMEOUT: ${waiting.join(', ')} not presented within ${timeoutMs} ms${outcome.milestones?'':' (this player publishes no milestones: rebuild the runtime and export with an engine that has api.profile.mark)'}`:null);
  return {raw,network:[...network.values()],error,storageError};
 }
 return {load,send:sendTo,sendTop:send,evaluate,evaluateTop,playerFrame,touch:{emulated:touchEmulated,max_touch_points:touchPoints},
  close:browser.attached?async()=>{}:()=>cdp.send('Target.closeTarget',{targetId}).catch(()=>{})};
}

// ---------------------------------------------------------------- orchestration

// The report names the measured page without its query, which may carry a session or a token.
export function pageWithoutQuery(url){const u=new URL(url);u.search='';u.hash='';return u.href;}

export function measuredUrl(serverUrl,{seed,backend},profiling,profileLimit=null){
 const url=new URL(serverUrl);url.searchParams.set('seed',seed);if(backend)url.searchParams.set('backend',backend);if(profiling)url.searchParams.set('unone_profile','1');if(profiling&&profileLimit)url.searchParams.set('unone_profile_limit',String(profileLimit));return url.href;
}

// A profiler run whose player reports no profiler was not profiled: a page embedding the player
// (--url) has to pass ?unone_profile on to the player frame.
export function profileMissing(raw,{profiling,embedded}){
 if(!profiling||!raw||raw.profile!=null)return null;
 return `MEASURE_PROFILE_NOT_ENABLED: the player reports no profiler${embedded?'; the page must pass ?unone_profile and ?unone_profile_limit on to the player frame':''}`;
}

async function measureOnce(page,server,options,{kind,index,profiling,milestones=options.milestones,profileLimit=null}){
 const base=options.url??server.url,url=measuredUrl(base,options,profiling,profileLimit);server.take();
 const cpu=cpuTimes();
 const {raw,network,error,storageError}=await page.load(url,{origin:new URL(base).origin,keepStorage:options.keepStorage,milestones,timeoutMs:options.timeoutMs,settleMs:options.settleMs,pollMs:options.pollMs,frameWindowMs:options.frameWindowMs});
 const hostCpu=hostCpuBusy(cpu,cpuTimes());
 // With --url the page's own server sent the player; this tool's server only has the blank control.
 const served=server.take();
 const sample=normalizeLoad(raw,{network,server:options.url?null:served,options,kind,index,profiling,url:options.url?pageWithoutQuery(url):url});
 if(storageError)sample.page.storage_clear_error=storageError;
 sample.metrics['host.cpu_busy']=hostCpu;
 if(options.url)sample.player_frame=await page.playerFrame();
 const failed=error??profileMissing(raw,{profiling,embedded:Boolean(options.url)});
 if(failed){sample.ok=false;sample.error=failed;}
 return sample;
}

export async function measure(options,log=message=>process.stderr.write(message+'\n')){
 const exported=await readExport(path.resolve(options.export),options);
 let scenario=null;
 if(options.scenarioRuns>0){const bytes=await readFile(path.resolve(options.scenario));scenario={file:{name:path.basename(options.scenario),sha256:sha256(bytes)},definition:parseScenario(bytes.toString('utf8'))};}
 const attaching=Boolean(options.attach||options.adbSocket);
 const executable=attaching?null:findBrowser(options.browser);
 const server=await startServer(exported.root,{cachePolicy:exported.exported.cache_policy,cacheControl:options.cacheControl,compress:options.compress,port:options.servePort});
 const runs=[],pairs=[],scenarioRuns=[];let browserInfo=null,adb=null;
 const touch=scenario?usesTouch(scenario.definition):false;
 const conditionsOf=browser=>({browser:{product:browser.version.product,user_agent:browser.version.userAgent,js_version:browser.version.jsVersion,protocol:browser.version.protocolVersion,
  executable,headless:attaching?null:!options.headed,args:browser.args?.filter(arg=>!arg.startsWith('--user-data-dir='))??null,...(browser.attached?{attached:browser.attached}:{})},gpu:browser.gpu,
  ...(attaching?{device:{label:options.deviceLabel,...(adb?{reported:adb.device}:{reported:null,note:'Attached with --attach: this tool did not ask the device what it is; see --device-label.'})}}:{})});
 try{
  // The device reaches this tool's server on its own 127.0.0.1 through adb reverse.
  if(options.adbSocket){adb=await adbConnect(options,{serverPort:Number(new URL(server.url).port)});log(`adb: ${adb.via.forward}; ${adb.via.reverse}`);}
  const endpoint=adb?.endpoint??options.attach;
  // A launched browser per cold run, warm block and scenario run; an attached browser lends the same
  // page each time through a new DevTools session.
  const session=async pageOptions=>{
   const browser=attaching?await attachBrowser(endpoint,options,adb?.via??null):await launchBrowser(executable,options);browserInfo??=conditionsOf(browser);
   // A browser this tool did not start can change its GPU setup mid-measurement (Chrome turns Vulkan
   // off after its GPU process crashes): read it again on leaving.
   const close=async()=>{if(attaching)browserInfo.gpu_at_end=await readGpu(browser.cdp);await browser.close();};
   try{return {browser,page:await openPage(browser,pageOptions),close};}catch(error){await browser.close();throw error;}
  };
  for(let i=0;i<options.cold;i++){
   const {page,close}=await session(options);
   try{const sample=await measureOnce(page,server,options,{kind:'cold',index:i+1,profiling:false});runs.push(sample);log(`cold ${i+1}/${options.cold}: ${sample.ok?`first submission ${sample.metrics['player.first_successful_submission_ms']} ms`:sample.error}`);}
   finally{await close();}
  }
  if(options.warm+options.profilePairs>0){
   const {page,close}=await session(options);
   try{
    const prime=await measureOnce(page,server,options,{kind:'prime',index:0,profiling:false});
    log(`prime (not reported in the summary): ${prime.ok?'ok':prime.error}`);
    runs.push(prime);
    for(let i=0;i<options.warm;i++){const sample=await measureOnce(page,server,options,{kind:'warm',index:i+1,profiling:false});runs.push(sample);log(`warm ${i+1}/${options.warm}: ${sample.ok?`first submission ${sample.metrics['player.first_successful_submission_ms']} ms`:sample.error}`);}
    for(let i=0;i<options.profilePairs;i++){
     const order=i%2===0?['off','on']:['on','off'],pair={index:i+1,order:`${order[0]}_first`};
     for(const side of order){const sample=await measureOnce(page,server,options,{kind:'profiler_pair',index:i+1,profiling:side==='on'});runs.push(sample);pair[side]=sample;}
     pairs.push(pair);log(`profiler pair ${i+1}/${options.profilePairs} (${pair.order}): ${pair.off.ok&&pair.on.ok?'ok':pair.off.error??pair.on.error}`);
    }
   }finally{await close();}
  }
  // Each scenario run is a fresh launched browser (an attached one: the same page, reloaded): it
  // waits for the scenario's start mark, then drives the game and samples memory until the settle checkpoint.
  const windows=scenario?scenario.definition.phases.filter(phase=>phase.kind==='frames'):[];
  const blankMs=windows.length&&options.blankControl?Math.max(...windows.map(phase=>phase.window_ms)):0;
  const scenarioTotal=options.scenarioRuns+(options.scenarioRuns&&options.scenarioProfile?1:0);
  for(let i=0;i<scenarioTotal;i++){
   const profiling=i===options.scenarioRuns;
   const milestones=[...new Set([...options.milestones,...(scenario.definition.start_mark?[scenario.definition.start_mark]:[])])];
   // The bundle observer subscribes after startup. Retain early resource entries from navigation.
   const {browser,page,close}=await session({...options,touch,bundleTrace:Boolean(scenario.definition.bundle_trace)});
   try{
    // The browser's own cadence on an empty page, same browser and viewport, before the game loads.
    let blank=null;
    if(blankMs&&!profiling){try{blank=await measureBlank({send:page.send,evaluate:page.evaluateTop},new URL(BLANK_PATH,server.url).href,{windowMs:blankMs});log(`scenario ${i+1}: blank control p95 ${blank.raf_interval.p95_ms} ms over ${blank.frames} frames, host CPU busy ${blank.host_cpu_busy}`);}catch(error){blank={error:String(error.message??error)};}}
    // A browser this tool did not start can take DevTools touch commands and deliver nothing.
    let probe=null;
    if(attaching&&touch){try{probe=await probeTouch({send:page.sendTop,evaluate:page.evaluateTop},new URL(BLANK_PATH,server.url).href);}catch(error){probe={delivered:false,events:[],error:String(error.message??error)};}}
    let startup=null,result=null;
    if(probe&&!probe.delivered)result={ok:false,error:`MEASURE_TOUCH_NOT_DELIVERED: a DevTools finger tap on the blank page reached no pointer event (events: ${probe.events.join(', ')||'none'}${probe.error?`; ${probe.error}`:''}). Chrome 150 on Android delivered none to any new page for about 10 minutes after a two-finger touch sequence (a pinch in an earlier run); wait and measure again, or put one pinch scenario run in each measurement`,phases:[],settled:null,samples:null};
    else{
     startup=await measureOnce(page,server,options,{kind:'scenario',index:i+1,profiling,milestones,profileLimit:profiling?2048:null});runs.push(startup);
     if(!startup.ok)result={ok:false,error:`MEASURE_SCENARIO_NOT_STARTED: ${startup.error}`,phases:[],settled:null,samples:null};
    }
    if(!result){
     log(`scenario ${i+1}/${options.scenarioRuns}: ${scenario.definition.name} started`);
     // An attached browser's process ids are its own machine's: reading them here would name unrelated processes.
     const readOs=attaching?async()=>attachedOsMemory():async()=>{let info;try{info=(await browser.cdp.send('SystemInfo.getProcessInfo')).processInfo;}catch(error){return {supported:false,error:String(error.message??error),processes:[]};}return readProcessMemory(info);};
     result=await runScenario(page,scenario.definition,{readOs,profiling,log:message=>log(`scenario ${i+1}${profiling?' (profiler on)':''}: ${message}`)});
    }
    scenarioRuns.push({index:i+1,profiling,startup_run:startup?runs.length-1:null,...(touch?{touch:{...page.touch,...(probe?{probe}:{})}}:{}),...(blank?{blank_control:blank}:{}),...result});
    log(`scenario ${i+1}/${scenarioTotal}${profiling?' (profiler on, diagnostic)':''}: ${result.ok?'ok':result.error}`);
   }finally{await close();}
  }
 }finally{await adb?.close();await server.close();}
 return buildReport({options,exported,runs,pairs,browserInfo,scenario,scenarioRuns});
}

/** OS memory for an attached browser's checkpoints: not read, and why. */
export function attachedOsMemory(){
 return {platform:null,source:null,supported:false,processes:[],error:'MEASURE_OS_MEMORY_UNAVAILABLE: the attached browser (--attach, --adb-socket) runs as processes this machine cannot read; the process ids DevTools reports belong to its device'};
}

/** How the scenario's touch steps reached the game, from what each run's page found. */
export function touchCondition(scenarioRuns,attached){
 const touches=scenarioRuns.map(run=>run.touch).filter(Boolean);
 if(!attached)return `touch emulation with ${TOUCH_POINTS} points from before the game loads (the scenario has touch steps): the game sees a touch device`;
 if(touches.length&&touches.every(t=>!t.emulated))return `not emulated: the attached browser reports ${[...new Set(touches.map(t=>t.max_touch_points))].join('/')} touch points of its own; touch steps are DevTools touch events dispatched into it, not a finger on its screen`;
 if(touches.length&&touches.every(t=>t.emulated))return `touch emulation with ${TOUCH_POINTS} points: the attached browser reported no touch points of its own`;
 return 'mixed or unknown: see scenario.runs[].touch';
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
  if(run.blank_control?.raf_interval)put('blank_control',flattenFrames({raf_interval:run.blank_control.raf_interval,host_cpu_busy:run.blank_control.host_cpu_busy}));
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
  'host.cpu_busy (per load) and host_cpu_busy (per frame window and blank control) are the busy share of this machine\'s CPU time over all logical CPUs and every process, the measured browser included (os.cpus()). A headless browser\'s or an emulator\'s CPU is this machine\'s: compare runs taken at similar values, and distrust a run taken while another job held the machine.',
 ];
 const attached=Boolean(options.attach||options.adbSocket);
 if(exported.development)notes.push('This export is a development build (--allow-development): its timings are not production timings.');
 if(!foreground)notes.push('At least one run was not foreground and focused for its whole duration; check runs[].foreground before using its timings.');
 if(attached)notes.push('Attached browser (--attach/--adb-socket): environment.os is the machine that ran this tool, not the measured device; environment.browser.attached and environment.device describe the measured one, and environment.device.label is what the person running it said it is.',
  'Attached browser: every run is a new document in one long-lived browser process this tool did not start, so there are no cold runs and its caches and heap carry over between runs; scenario os.* metrics are absent because this machine cannot read that device\'s processes.');
 if(scenario)notes.push(...SCENARIO_NOTES);
 return {schema:SCHEMA,created_at:createdAt,tool:{name:'measure-web-export',script:'scripts/measure-web-export.mjs',node:process.version},
  artifact:exported.artifact,engine:exported.engine,execution:{...exported.execution,development:exported.development},
  environment:{...browserInfo,os:{platform:process.platform,release:os.release(),arch:process.arch,cpu:os.cpus()[0]?.model?.trim()??null,logical_cpus:os.cpus().length,memory_bytes:os.totalmem()}},
  conditions:{viewport:options.viewport,device_pixel_ratio:options.dpr,viewport_overridden:Boolean(options.viewport||options.dpr),...(options.viewport||options.dpr?{}:{viewport_note:'Not overridden: the attached browser\'s own viewport; runs[].page has its inner size, screen size and device pixel ratio.'}),
   seed:options.seed,backend_override:options.backend,focus_emulated:true,foreground_all_runs:foreground,
   network:options.network?{emulated:true,...options.network}:{emulated:false,note:options.adbSocket?'Static server on this machine, reached from the device through adb reverse (the adb transport to the emulator or phone): no radio network, latency or bandwidth limit.':attached?'Static server on this machine; how the attached browser reaches it decides the network path.':'Loopback server: no network latency or bandwidth limit.'},cpu_throttle:options.cpuThrottle,
   server:options.url?{kind:'page served by the caller (--url)',page:pageWithoutQuery(options.url),player:'the frame of the page that runs the export index.html; runs[].player_frame says which',
     note:'This tool served no player file: sizes and cache come from the browser network log, and the page decides caching, compression and whether the export it serves is --export.'}
    :{kind:'loopback static server',cache_control:options.cacheControl??'export cache_policy',cache_policy:options.cacheControl?null:exported.artifact.cache_policy,etag:true,compression:options.compress,timing_allow_origin:'*',...(options.servePort?{port:options.servePort}:{})},
   storage_cleared_between_runs:!options.keepStorage,cold:attached?'none: an attached browser is one process that stays up':'new browser process and profile per run (empty HTTP and code caches)',
   warm:attached?'the attached page, primed by an unreported first load; each run is a new document in the same long-lived browser process':'one browser profile primed by an unreported first load; each run is a new document',
   wasm_timing:options.wasmTiming,poll_ms_after_first_submission:options.pollMs,settle_ms:options.settleMs,frame_window_ms:options.frameWindowMs,timeout_ms:options.timeoutMs,milestones:options.milestones},
  clock:{origin:'window.playerBoot',origin_definition:'performance.now() when the export index.html head runs, before any module loads; performance.now() itself counts from navigation start (performance.timeOrigin).',
   unit:'ms',host_clock:'main-thread performance.now(); worker clocks are not mixed in'},
  instrumentation:['Timing wrappers on WebAssembly.instantiateStreaming/instantiate/compileStreaming/compile and FontFace.prototype.load (results unchanged)','longtask PerformanceObserver','DevTools protocol Page/Runtime/Network domains; Performance.getMetrics once per run','one player-accessor poll every '+options.pollMs+' ms between the first submission and the last awaited milestone'],
  coverage,
  summary:{cold:summarize(ok('cold')),warm:summarize(ok('warm')),profiler_pairs:pairDeltas(okPairs)},
  ...(scenario?{scenario:{file:scenario.file,definition:scenario.definition,conditions:{browser:attached?'the attached browser and page (--attach/--adb-socket) for every run: nothing restarts between runs, and a touch scenario first checks that a DevTools tap reaches the blank page (scenario.runs[].touch.probe)':'a new browser process and profile per run',profiler:options.scenarioProfile?'off for acceptance runs; one extra diagnostic run with ?unone_profile=1&unone_profile_limit=2048':false,sample_ms:scenario.definition.sample_ms,settle_ms:scenario.definition.settle_ms,
   ...(scenario.definition.bundle_trace?{resource_timing_buffer_entries_requested:BUNDLE_RESOURCE_TIMING_ENTRIES}:{}),
   touch_emulation:usesTouch(scenario.definition)?touchCondition(scenarioRuns,attached):false,
   frame_windows:{poll_ms:1000,source:'unonePlayerPerformance.snapshot({includeRafSamples:true,includeRafTicks:true}) draw and input rows (without includeRafTicks from an older player), stitched by sequence; the memory sampler pauses during a window',blank_control:options.blankControl?'empty page recording requestAnimationFrame timestamps, same browser and viewport, before the game loads':false},
   os_memory:attached?'not read: the attached browser\'s processes are its device\'s, not this machine\'s':process.platform==='win32'?'per process at checkpoints: working set, peak working set, private bytes, GPU dedicated/shared (Windows GPU counters)':process.platform==='linux'?'per process at checkpoints: VmRSS, VmHWM, RssAnon; no GPU memory':'not read on this platform'},
   summary:scenarioSummary(scenarioRuns),runs:scenarioRuns}}:{}),
  runs,
  pairs:pairs.map(pair=>({index:pair.index,order:pair.order,off_run:runs.indexOf(pair.off),on_run:runs.indexOf(pair.on)})),
  notes};
}

// A few owners' movement across each phase of the first completed scenario run, for the console.
const FRAME_CONSOLE=['host_cpu_busy','submission_interval.p50_ms','submission_interval.p95_ms','submission_interval.p99_ms','submission_interval.over_50ms','submission_interval.over_100ms','raf_interval.p95_ms','raf_interval.over_50ms','new_snapshot_interval.p95_ms','dropped_steps','input_latency.p50_ms','input_latency.p95_ms','input_delivery.p50_ms','long_tasks.count','long_tasks.max_ms','long_tasks.max_tick_ms','tick.p95_ms','tick.max_ms','completed_submissions'];
const CONSOLE_METRICS=['images.decoded.resident.entries','images.decoded.resident.bytes','gpu.textures.entries','gpu.geometries.entries','luau.heap.bytes','js_heap.used_bytes','os.largest_renderer.private_bytes','os.gpu_process.gpu_dedicated_bytes'];
export function scenarioConsole(scenario){
 const traces=scenario.runs.filter(r=>r.bundle_trace).map(r=>{
  const counts={};for(const finding of r.bundle_trace.findings)counts[finding.code]=(counts[finding.code]??0)+1;
  return {run:r.index,ok:r.bundle_trace.ok,findings:counts};
 });
 const traced=traces.length?{bundle_traces:traces}:{};
 const run=scenario.runs.find(r=>r.ok&&!r.profiling);if(!run)return {ok:0,runs:scenario.runs.length,...traced};
 const median=name=>scenario.summary?.[name]?.median??null;
 const frames=prefix=>Object.fromEntries(FRAME_CONSOLE.map(name=>[name,median(`${prefix}.${name}`)]).filter(([,v])=>v!==null));
 return {ok:scenario.runs.filter(r=>r.ok&&!r.profiling).length,runs:scenario.runs.length,...traced,
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
