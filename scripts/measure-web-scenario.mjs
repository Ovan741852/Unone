// Scripted scenarios for measure-web-export: the game's own screens driven by real browser input,
// with the player's memory owners, the JS heap and the browser's processes sampled as it goes.
//
// A scenario file names its steps (a key, a tap, a milestone to wait for, a pause), groups them into
// phases that repeat a round N times after unreported warmup rounds, and ends with an idle settle.
// Every round ends with a checkpoint: one player memory read, DevTools heap counters and, where the
// OS allows, each browser process's working set, peak and private bytes plus its GPU memory. Between
// checkpoints a sampler reads the player and the heap every sample_ms, so a round's peak is the
// largest sampled value, not a continuous high-water mark (the OS peak working set is one).
// Nothing forces a garbage collection and nothing is added across owners or processes.
//
// Taps and drags are mouse input unless they say pointer:"touch"; a pinch is two touch points. A
// scenario with any touch step runs with touch emulation from before the game loads.
//
// A frame window phase runs its setup once, then repeats a loop (keys, taps, drags, wheel) through a
// warmup and a measured window while it reads the player's own draw and input rows and stitches them
// by sequence: submission and RAF intervals, gaps over 50/100 ms, dropped steps, input-to-presentation.
// A blank page measured first in the same browser gives the browser's own cadence.
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import os from 'node:os';

export const SCENARIO_SCHEMA='unone.web-scenario.v1';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const round=n=>finite(n)?Math.round(n*1000)/1000:null;

/** This machine's CPU time so far, summed over its logical CPUs (os.cpus(), milliseconds). */
export function cpuTimes(cpus=os.cpus()){
 let idle=0,total=0;for(const {times:t} of cpus){idle+=t.idle;total+=t.user+t.nice+t.sys+t.idle+t.irq;}
 return {idle,total,logical_cpus:cpus.length};
}

/**
 * The busy share of this machine's CPU time between two cpuTimes readings, 0..1 over all logical CPUs
 * and every process (the browser included); null when no time passed. An emulator's CPU is this
 * machine's, and so is a headless browser's: another job here slows what is measured.
 */
export function hostCpuBusy(before,after){
 if(!before||!after)return null;const total=after.total-before.total,idle=after.idle-before.idle;
 return total>0?round(Math.min(1,Math.max(0,(total-idle)/total))):null;
}
const printable=(value,max=64)=>typeof value==='string'&&value.length>=1&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);

// ---------------------------------------------------------------- keys

const NAMED_KEYS={Escape:['Escape',27],Enter:['Enter',13],Space:[' ',32],Tab:['Tab',9],Backspace:['Backspace',8],Delete:['Delete',46],
 ArrowLeft:['ArrowLeft',37],ArrowUp:['ArrowUp',38],ArrowRight:['ArrowRight',39],ArrowDown:['ArrowDown',40],
 ShiftLeft:['Shift',16],ShiftRight:['Shift',16],ControlLeft:['Control',17],ControlRight:['Control',17],AltLeft:['Alt',18],AltRight:['Alt',18],
 Home:['Home',36],End:['End',35],PageUp:['PageUp',33],PageDown:['PageDown',34],Minus:['-',189],Equal:['=',187],Comma:[',',188],Period:['.',190],Slash:['/',191]};

/** A KeyboardEvent.code the scenario may press, as DevTools key event fields; null when unknown. */
export function keyFields(code){
 let key,keyCode;
 if(/^Key[A-Z]$/.test(code)){key=code.slice(3).toLowerCase();keyCode=code.charCodeAt(3);}
 else if(/^Digit[0-9]$/.test(code)){key=code.slice(5);keyCode=code.charCodeAt(5);}
 else if(/^F([1-9]|1[0-2])$/.test(code)){key=code;keyCode=111+Number(code.slice(1));}
 else if(Object.hasOwn(NAMED_KEYS,code))[key,keyCode]=NAMED_KEYS[code];
 else return null;
 const text=key.length===1?key:undefined;
 return {code,key,windowsVirtualKeyCode:keyCode,nativeVirtualKeyCode:keyCode,...(text?{text}:{})};
}

// ---------------------------------------------------------------- scenario file

const TOP_KEYS=['schema','name','description','start_mark','phases','settle_ms','sample_ms','step_timeout_ms'];
const ROUND_KEYS=['name','warmup_rounds','rounds','steps'];
const FRAME_KEYS=['name','setup','loop','warmup_ms','window_ms'];
const STEP_KINDS=['key','tap','drag','pinch','wheel','wait_mark','wait_ms'];
const STEP_KEYS={key:['key','hold_ms'],tap:['tap','hold_ms','pointer'],drag:['drag','pointer'],pinch:['pinch'],wheel:['wheel'],wait_mark:['wait_mark','timeout_ms'],wait_ms:['wait_ms']};
const point=value=>Array.isArray(value)&&value.length===2&&value.every(n=>finite(n)&&n>=0&&n<=100000);

/**
 * Parse and check a scenario file's text; every problem is MEASURE_SCENARIO_INVALID with where it is.
 * A phase either repeats `steps` for warmup_rounds + rounds (memory rounds), or runs `setup` once and
 * then repeats `loop` through warmup_ms and a measured window_ms (a frame window).
 */
export function parseScenario(text){
 const fail=(where,why)=>{throw Error(`MEASURE_SCENARIO_INVALID: ${where}: ${why}`);};
 let s;try{s=JSON.parse(text);}catch(error){fail('file',`not JSON (${error.message})`);}
 if(!s||typeof s!=='object'||Array.isArray(s))fail('file','must be a JSON object');
 for(const key of Object.keys(s))if(!TOP_KEYS.includes(key))fail(key,`unknown field (allowed: ${TOP_KEYS.join(', ')})`);
 if(s.schema!==SCENARIO_SCHEMA)fail('schema',`must be "${SCENARIO_SCHEMA}"`);
 if(!printable(s.name))fail('name','1-64 printable characters');
 if(s.description!==undefined&&!printable(s.description,1000))fail('description','up to 1000 printable characters');
 if(s.start_mark!==undefined&&!printable(s.start_mark))fail('start_mark','the name the game passes to api.profile.mark');
 const whole=(value,where,min,max,fallback)=>{if(value===undefined)return fallback;if(!Number.isInteger(value)||value<min||value>max)fail(where,`whole number ${min}..${max}`);return value;};
 const settleMs=whole(s.settle_ms,'settle_ms',0,600000,10000),sampleMs=whole(s.sample_ms,'sample_ms',50,60000,250),stepTimeoutMs=whole(s.step_timeout_ms,'step_timeout_ms',100,600000,15000);
 if(!Array.isArray(s.phases)||s.phases.length<1||s.phases.length>16)fail('phases','1-16 phases');
 const names=new Set();let markWaits=0;
 const parseStep=(step,where,{marks,repeats})=>{
  if(!step||typeof step!=='object'||Array.isArray(step))fail(where,'must be an object');
  const kinds=STEP_KINDS.filter(kind=>Object.hasOwn(step,kind));
  if(kinds.length!==1)fail(where,`exactly one of ${STEP_KINDS.join(', ')}`);
  const kind=kinds[0];
  for(const key of Object.keys(step))if(!STEP_KEYS[kind].includes(key))fail(`${where}.${key}`,`not allowed on a ${kind} step (allowed: ${STEP_KEYS[kind].join(', ')})`);
  if(kind==='key'){if(!keyFields(step.key))fail(`${where}.key`,'a KeyboardEvent.code such as KeyT, Digit1, Escape, Enter, Space, ArrowLeft or F1');return Object.freeze({kind,key:step.key,hold_ms:whole(step.hold_ms,`${where}.hold_ms`,0,10000,50)});}
  const pointer=()=>{if(step.pointer===undefined)return 'mouse';if(step.pointer!=='mouse'&&step.pointer!=='touch')fail(`${where}.pointer`,'"mouse" (the default) or "touch"');return step.pointer;};
  if(kind==='tap'){if(!point(step.tap))fail(`${where}.tap`,'[x, y] in CSS pixels from the top-left of the player (its iframe, with --url)');return Object.freeze({kind,tap:Object.freeze([...step.tap]),hold_ms:whole(step.hold_ms,`${where}.hold_ms`,0,10000,50),pointer:pointer()});}
  if(kind==='drag'){
   const d=step.drag;
   if(!d||typeof d!=='object'||Array.isArray(d))fail(`${where}.drag`,'{from:[x,y], to:[x,y], ms?, moves?}');
   for(const key of Object.keys(d))if(!['from','to','ms','moves'].includes(key))fail(`${where}.drag.${key}`,'unknown field (allowed: from, to, ms, moves)');
   if(!point(d.from)||!point(d.to))fail(`${where}.drag`,'from and to are [x, y] in CSS pixels');
   const ms=whole(d.ms,`${where}.drag.ms`,1,60000,500);
   return Object.freeze({kind,from:Object.freeze([...d.from]),to:Object.freeze([...d.to]),ms,moves:whole(d.moves,`${where}.drag.moves`,1,10000,Math.max(2,Math.round(ms/16))),pointer:pointer()});
  }
  if(kind==='pinch'){
   // Two touch points level with each other, at distance from, moving to distance to around one midpoint.
   const p=step.pinch;
   if(!p||typeof p!=='object'||Array.isArray(p))fail(`${where}.pinch`,'{at:[x,y], from, to, ms?, moves?}');
   for(const key of Object.keys(p))if(!['at','from','to','ms','moves'].includes(key))fail(`${where}.pinch.${key}`,'unknown field (allowed: at, from, to, ms, moves)');
   if(!point(p.at))fail(`${where}.pinch.at`,'[x, y] in CSS pixels: the midpoint between the two fingers');
   for(const key of ['from','to'])if(!finite(p[key])||p[key]<1||p[key]>100000)fail(`${where}.pinch.${key}`,'the distance between the two fingers in CSS pixels, 1..100000');
   if(p.at[0]-Math.max(p.from,p.to)/2<0)fail(`${where}.pinch`,'the left finger would start or end left of the player; move at or shorten the distance');
   const ms=whole(p.ms,`${where}.pinch.ms`,1,60000,500);
   return Object.freeze({kind,at:Object.freeze([...p.at]),from:p.from,to:p.to,ms,moves:whole(p.moves,`${where}.pinch.moves`,1,10000,Math.max(2,Math.round(ms/16)))});
  }
  if(kind==='wheel'){
   const w=step.wheel;
   if(!w||typeof w!=='object'||Array.isArray(w))fail(`${where}.wheel`,'{at:[x,y], dy?, dx?, count?, interval_ms?}');
   for(const key of Object.keys(w))if(!['at','dx','dy','count','interval_ms'].includes(key))fail(`${where}.wheel.${key}`,'unknown field (allowed: at, dx, dy, count, interval_ms)');
   if(!point(w.at))fail(`${where}.wheel.at`,'[x, y] in CSS pixels');
   for(const axis of ['dx','dy'])if(w[axis]!==undefined&&(!finite(w[axis])||Math.abs(w[axis])>10000))fail(`${where}.wheel.${axis}`,'a pixel delta within ±10000');
   return Object.freeze({kind,at:Object.freeze([...w.at]),dx:w.dx??0,dy:w.dy??0,count:whole(w.count,`${where}.wheel.count`,1,1000,1),interval_ms:whole(w.interval_ms,`${where}.wheel.interval_ms`,0,10000,16)});
  }
  if(kind==='wait_mark'){
   if(!marks)fail(where,'a frame window loop repeats an unknown number of times, so it cannot wait for milestones; wait in setup');
   if(!printable(step.wait_mark))fail(`${where}.wait_mark`,'the name the game passes to api.profile.mark');
   markWaits+=repeats;return Object.freeze({kind,wait_mark:step.wait_mark,timeout_ms:whole(step.timeout_ms,`${where}.timeout_ms`,100,600000,stepTimeoutMs)});
  }
  return Object.freeze({kind,wait_ms:whole(step.wait_ms,`${where}.wait_ms`,0,600000,undefined)});
 };
 const steps=(list,where,limits,min=1)=>{if(!Array.isArray(list)||list.length<min||list.length>64)fail(where,`${min}-64 steps`);return Object.freeze(list.map((step,i)=>parseStep(step,`${where}[${i}]`,limits)));};
 const phases=s.phases.map((phase,p)=>{
  const at=`phases[${p}]`;
  if(!phase||typeof phase!=='object'||Array.isArray(phase))fail(at,'must be an object');
  const frames=Object.hasOwn(phase,'window_ms'),allowed=frames?FRAME_KEYS:ROUND_KEYS;
  for(const key of Object.keys(phase))if(!allowed.includes(key))fail(`${at}.${key}`,`unknown field for a ${frames?'frame window':'round'} phase (allowed: ${allowed.join(', ')})`);
  if(!printable(phase.name)||phase.name==='settle')fail(`${at}.name`,'1-64 printable characters, not "settle"');
  if(names.has(phase.name))fail(`${at}.name`,`"${phase.name}" is used twice`);names.add(phase.name);
  if(frames){
   const windowMs=whole(phase.window_ms,`${at}.window_ms`,1000,600000,undefined);
   return Object.freeze({name:phase.name,kind:'frames',setup:phase.setup===undefined?Object.freeze([]):steps(phase.setup,`${at}.setup`,{marks:true,repeats:1},0),
    loop:steps(phase.loop,`${at}.loop`,{marks:false}),warmup_ms:whole(phase.warmup_ms,`${at}.warmup_ms`,0,600000,3000),window_ms:windowMs});
  }
  const warmup=whole(phase.warmup_rounds,`${at}.warmup_rounds`,0,100,0),rounds=whole(phase.rounds,`${at}.rounds`,1,1000,undefined);
  if(rounds===undefined)fail(`${at}.rounds`,'required');
  return Object.freeze({name:phase.name,kind:'rounds',warmup_rounds:warmup,rounds,steps:steps(phase.steps,`${at}.steps`,{marks:true,repeats:warmup+rounds})});
 });
 // The engine keeps a run's first 256 marks and the player's milestone table holds 256 rows.
 if(markWaits+(s.start_mark?1:0)>256)fail('phases',`waits for ${markWaits} milestones across all rounds; a run records at most 256 api.profile.mark calls, so use fewer rounds or fewer waits`);
 return Object.freeze({schema:SCENARIO_SCHEMA,name:s.name,...(s.description!==undefined?{description:s.description}:{}),start_mark:s.start_mark??null,phases:Object.freeze(phases),settle_ms:settleMs,sample_ms:sampleMs,step_timeout_ms:stepTimeoutMs});
}

/** Whether any step touches the screen: such a scenario needs touch emulation from the first load. */
export function usesTouch(scenario){
 return scenario.phases.some(phase=>[...(phase.steps??[]),...(phase.setup??[]),...(phase.loop??[])].some(s=>s.kind==='pinch'||s.pointer==='touch'));
}

// ---------------------------------------------------------------- what one sample holds

const OWNER_FIELDS=['bytes','entries','pinned_bytes','image_leases','geometries','meshes','materials','buffer_capacity_quads'];

/** The player's memory snapshot as flat metrics: <owner>.<field> for every number the owner reported. */
export function flattenMemory(memory){
 const out={};
 for(const row of memory?.owners??[])for(const field of OWNER_FIELDS)if(finite(row[field]))out[`${row.id}.${field}`]=row[field];
 for(const [name,value] of Object.entries(memory?.failures??{}))if(finite(value))out[`failures.${name}`]=value;
 return out;
}

/** DevTools heap and DOM counters as flat metrics; a counter the browser does not return is left out. */
export function flattenHeap(heap,dom){
 const out={};
 const put=(name,value)=>{if(finite(value))out[name]=value;};
 put('js_heap.used_bytes',heap?.usedSize);put('js_heap.total_bytes',heap?.totalSize);
 put('js_heap.embedder_used_bytes',heap?.embedderHeapUsedSize);put('js_heap.backing_storage_bytes',heap?.backingStorageSize);
 put('dom.documents',dom?.documents);put('dom.nodes',dom?.nodes);put('dom.listeners',dom?.jsEventListeners);
 return out;
}

// ---------------------------------------------------------------- browser processes

const OS_FIELDS=['working_set_bytes','peak_working_set_bytes','private_bytes','gpu_dedicated_bytes','gpu_shared_bytes'];

/** Per-process OS rows as flat metrics: the browser and GPU processes, and the largest renderer. */
export function flattenProcesses(os){
 const out={};if(!os?.processes?.length)return out;
 const put=(prefix,row)=>{if(!row)return;for(const field of OS_FIELDS)if(finite(row[field]))out[`os.${prefix}.${field}`]=row[field];};
 put('browser_process',os.processes.find(row=>row.type==='browser'));
 put('gpu_process',os.processes.find(row=>row.type==='gpu'));
 const renderers=os.processes.filter(row=>row.type==='renderer');
 out['os.renderer_processes']=renderers.length;
 // The page's renderer is not identified by DevTools; with one page open it is the largest one.
 put('largest_renderer',renderers.filter(row=>finite(row.working_set_bytes)).sort((a,b)=>b.working_set_bytes-a.working_set_bytes)[0]);
 return out;
}

export function runProcess(command,args,{timeoutMs=30000,input=null}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{stdio:[input===null?'ignore':'pipe','pipe','pipe'],windowsHide:true});
  let stdout='',stderr='';child.stdout.on('data',d=>{stdout+=d;});child.stderr.on('data',d=>{stderr+=d;});
  const timer=setTimeout(()=>{child.kill();reject(Error(`timed out after ${timeoutMs} ms`));},timeoutMs);
  child.on('error',error=>{clearTimeout(timer);reject(error);});
  child.on('close',code=>{clearTimeout(timer);code===0?resolve(stdout):reject(Error(`exit ${code}: ${stderr.trim().slice(0,500)}`));});
  if(input!==null)child.stdin.end(input);
 });
}

/** The PowerShell that reads Windows process memory and per-process GPU memory for some PIDs. */
export function windowsMemoryScript(pids){
 const ids=pids.filter(Number.isSafeInteger);
 const filter=ids.map(pid=>`Name LIKE 'pid_${pid}_%'`).join(' OR ');
 return `$ErrorActionPreference='Stop';$ids=@(${ids.join(',')})
$p=@(Get-Process -Id $ids -ErrorAction SilentlyContinue|ForEach-Object{[pscustomobject]@{pid=$_.Id;working_set=$_.WorkingSet64;peak_working_set=$_.PeakWorkingSet64;private=$_.PrivateMemorySize64}})
$g=@();$gpuError=$null
try{$g=@(Get-CimInstance Win32_PerfRawData_GPUPerformanceCounters_GPUProcessMemory -Filter "${filter}"|ForEach-Object{[pscustomobject]@{name=$_.Name;dedicated=[uint64]$_.DedicatedUsage;shared=[uint64]$_.SharedUsage}})}catch{$gpuError=$_.Exception.Message}
[pscustomobject]@{processes=$p;gpu=$g;gpu_error=$gpuError}|ConvertTo-Json -Depth 4 -Compress`;
}

/** Windows script output as process rows; GPU memory is summed per process over its adapters. */
export function parseWindowsMemory(text,processes){
 const raw=JSON.parse(text),list=value=>value==null?[]:Array.isArray(value)?value:[value];
 const gpu=new Map();
 for(const row of list(raw.gpu)){const pid=Number(/^pid_(\d+)_/.exec(String(row.name))?.[1]);if(!Number.isSafeInteger(pid))continue;
  const sum=gpu.get(pid)??{dedicated:0,shared:0,adapters:0};sum.dedicated+=Number(row.dedicated)||0;sum.shared+=Number(row.shared)||0;sum.adapters++;gpu.set(pid,sum);}
 const os=new Map(list(raw.processes).map(row=>[Number(row.pid),row]));
 const gpuReadable=!raw.gpu_error;
 return {processes:processes.map(({id,type})=>{const row=os.get(id),g=gpu.get(id);
  return {pid:id,type,alive:Boolean(row),working_set_bytes:row?Number(row.working_set):null,peak_working_set_bytes:row?Number(row.peak_working_set):null,private_bytes:row?Number(row.private):null,
   gpu_dedicated_bytes:gpuReadable&&row?g?.dedicated??0:null,gpu_shared_bytes:gpuReadable&&row?g?.shared??0:null,gpu_adapters:g?.adapters??0};}),
  gpu_error:raw.gpu_error??null};
}

/** Linux /proc/<pid>/status as one process row (VmRSS, VmHWM, RssAnon; no GPU memory). */
export function parseProcStatus(text,{id,type}){
 const kb=name=>{const match=new RegExp(`^${name}:\\s+(\\d+)\\s+kB`,'m').exec(text);return match?Number(match[1])*1024:null;};
 return {pid:id,type,alive:true,working_set_bytes:kb('VmRSS'),peak_working_set_bytes:kb('VmHWM'),private_bytes:kb('RssAnon'),gpu_dedicated_bytes:null,gpu_shared_bytes:null,gpu_adapters:0};
}

const CDP_TYPES={browser:'browser',renderer:'renderer',GPU:'gpu',gpu:'gpu'};

/**
 * Read OS memory for the browser's processes (from DevTools SystemInfo.getProcessInfo). Windows reads
 * working set, peak working set, private bytes and per-process GPU memory; Linux reads /proc; other
 * platforms report supported:false. A failure is reported, never turned into zeros.
 */
export async function readProcessMemory(processInfo,{platform=process.platform,run=runProcess,readText=file=>readFile(file,'utf8')}={}){
 const processes=(processInfo??[]).filter(p=>Number.isSafeInteger(p?.id)).map(p=>({id:p.id,type:CDP_TYPES[p.type]??String(p.type)}));
 const base={platform,source:null,processes:[],error:null};
 if(platform==='win32'){
  base.source='Get-Process (WorkingSet64, PeakWorkingSet64, PrivateMemorySize64); Win32_PerfRawData_GPUPerformanceCounters_GPUProcessMemory (DedicatedUsage, SharedUsage)';
  try{const script=windowsMemoryScript(processes.map(p=>p.id));
   const text=await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')]);
   const parsed=parseWindowsMemory(text,processes);return {...base,supported:true,processes:parsed.processes,gpu_error:parsed.gpu_error};}
  catch(error){return {...base,supported:true,error:String(error.message??error)};}
 }
 if(platform==='linux'){
  base.source='/proc/<pid>/status (VmRSS, VmHWM, RssAnon)';
  const rows=[];for(const p of processes){try{rows.push(parseProcStatus(await readText(`/proc/${p.id}/status`),p));}catch{rows.push({pid:p.id,type:p.type,alive:false,working_set_bytes:null,peak_working_set_bytes:null,private_bytes:null,gpu_dedicated_bytes:null,gpu_shared_bytes:null,gpu_adapters:0});}}
  return {...base,supported:true,processes:rows};
 }
 return {...base,supported:false,error:`process memory is not read on ${platform}`};
}

// ---------------------------------------------------------------- trends

/**
 * How one metric moved across a phase's measured rounds (one value per round, in order). The two
 * halves are compared by maximum: second_half_not_higher is a fact about this window, not proof
 * that nothing leaks, and a garbage-collected heap can rise in it without leaking.
 */
export function trend(values){
 const points=values.map((value,index)=>[index,value]).filter(([,value])=>finite(value)),n=points.length;
 if(!n)return {n:0,nulls:values.length,first:null,last:null,min:null,max:null,first_half_max:null,second_half_max:null,second_half_not_higher:null,slope_per_round:null,rounds_increased:null,increased_every_round:null};
 const ys=points.map(([,y])=>y),half=Math.floor(values.length/2);
 const maxOf=list=>{const xs=list.filter(finite);return xs.length?Math.max(...xs):null;};
 const firstHalf=maxOf(values.slice(0,half)),secondHalf=maxOf(values.slice(half));
 let slope=null;if(n>=2){const mx=points.reduce((s,[x])=>s+x,0)/n,my=ys.reduce((s,y)=>s+y,0)/n,spread=points.reduce((s,[x])=>s+(x-mx)**2,0);slope=spread>0?points.reduce((s,[x,y])=>s+(x-mx)*(y-my),0)/spread:null;}
 let increased=0;for(let i=1;i<points.length;i++)if(points[i][1]>points[i-1][1])increased++;
 return {n,nulls:values.length-n,first:ys[0],last:ys[n-1],min:Math.min(...ys),max:Math.max(...ys),first_half_max:firstHalf,second_half_max:secondHalf,
  second_half_not_higher:n>=4&&firstHalf!==null&&secondHalf!==null?secondHalf<=firstHalf:null,slope_per_round:round(slope),rounds_increased:increased,increased_every_round:n>=3?increased===n-1:null};
}

export function phaseTrends(rounds){
 const measured=rounds.filter(r=>!r.warmup),names=new Set();
 for(const r of measured)for(const name of Object.keys(r.end??{}))names.add(name);
 const end={},peak={};
 for(const name of [...names].sort()){end[name]=trend(measured.map(r=>r.end?.[name]??null));peak[name]=trend(measured.map(r=>r.peak?.[name]??null));}
 return {rounds:measured.length,end,peak};
}

// ---------------------------------------------------------------- frame windows

const quantile=(sorted,p)=>sorted.length?sorted[Math.ceil(sorted.length*p)-1]:null;

/** Nearest-rank p50/p95/p99 and max over one window's values; with gaps, how many exceed 50 and 100 ms. */
export function distributionOf(values,{gaps=false}={}){
 const xs=values.filter(finite).sort((a,b)=>a-b);
 return {n:xs.length,p50_ms:round(quantile(xs,.5)),p95_ms:round(quantile(xs,.95)),p99_ms:round(quantile(xs,.99)),max_ms:round(xs.length?xs[xs.length-1]:null),
  ...(gaps?{over_50ms:xs.filter(x=>x>50).length,over_100ms:xs.filter(x=>x>100).length}:{})};
}

/**
 * One frame window from the player's own draw and input rows (stitched across polls by sequence),
 * on the page clock between `start` and `end`. Submission intervals are completed scheduler draws'
 * end times; RAF and new-snapshot intervals use those draws' RAF timestamps, as the player does.
 */
export function frameWindowMetrics({rows,inputs=[],start,end,droppedStart=null,droppedEnd=null}){
 const at=r=>finite(r.end)?r.end:r.callback;
 const inWindow=rows.filter(r=>finite(at(r))&&at(r)>=start&&at(r)<=end);
 const completed=inWindow.filter(r=>r.source==='scheduler_raf'&&r.outcome==='completed').sort((a,b)=>a.end-b.end);
 const diffs=(list,key)=>{const out=[];for(let i=1;i<list.length;i++){const a=list[i-1][key],b=list[i][key];if(finite(a)&&finite(b)&&b>=a)out.push(b-a);}return out;};
 const outcomes={};for(const r of inWindow)outcomes[r.outcome]=(outcomes[r.outcome]??0)+1;
 const sequences=inWindow.map(r=>r.sequence).filter(Number.isSafeInteger);
 const missing=sequences.length?Math.max(...sequences)-Math.min(...sequences)+1-new Set(sequences).size:null;
 const shown=inputs.filter(x=>finite(x.presented)&&x.presented>=start&&x.presented<=end);
 return {window_ms:round(end-start),completed_submissions:completed.length,
  coverage:completed.length>=2?round((completed[completed.length-1].end-completed[0].end)/(end-start)):0,
  rows:inWindow.length,rows_missing:missing,outcomes,
  submission_interval:distributionOf(diffs(completed,'end'),{gaps:true}),
  raf_interval:distributionOf(diffs(completed,'raf'),{gaps:true}),
  new_snapshot_interval:distributionOf(diffs(completed.filter(r=>r.fresh),'raf'),{gaps:true}),
  draw_sync:distributionOf(completed.map(r=>finite(r.callback)&&finite(r.start)?r.callback-r.start:null)),
  dropped_steps:finite(droppedEnd)&&finite(droppedStart)?droppedEnd-droppedStart:null,
  input_latency:distributionOf(shown.map(x=>x.presented-x.at)),
  // From the event's own timestamp to the page receiving it: time the browser held the event.
  input_delivery:distributionOf(shown.map(x=>finite(x.delivered)?x.delivered-x.at:null))};
}

/** Frame metrics as flat names (submission_interval.p95_ms, outcomes.skipped, ...) for summaries. */
export function flattenFrames(metrics){
 const out={};
 for(const [name,value] of Object.entries(metrics??{})){
  if(finite(value))out[name]=value;
  else if(value&&typeof value==='object')for(const [field,inner] of Object.entries(value))if(finite(inner))out[`${name}.${field}`]=inner;
 }
 return out;
}

/** Profiler events of one window, per event kind and per span (with its parent), largest total first. */
export function profileWindowSummary(events,windowMs){
 const groups=new Map(),add=(key,ms)=>{if(!finite(ms))return;let list=groups.get(key);if(!list)groups.set(key,list=[]);list.push(ms);};
 for(const e of events){add(e.kind,e.wall);for(const [name,parent,ms] of e.spans??[])add(`${e.kind} > ${parent?`${parent} > `:''}${name}`,ms);}
 return [...groups].map(([key,values])=>{const xs=values.sort((a,b)=>a-b),total=xs.reduce((a,b)=>a+b,0);
  return {key,count:xs.length,total_ms:round(total),share_of_window:round(total/windowMs),p50_ms:round(quantile(xs,.5)),p95_ms:round(quantile(xs,.95)),max_ms:round(xs[xs.length-1])};})
  .sort((a,b)=>b.total_ms-a.total_ms);
}

// The player's draw and input rows over the last windowMs, plus the profiler's events when asked.
// Reading the profiler clears it, so consecutive reads never repeat an event.
const frameSource=(windowMs,profiling)=>`JSON.stringify((()=>{const d=document.body?.dataset??{};let s=null;
try{s=window.unonePlayerPerformance?.snapshot({windowMs:${Number(windowMs)},includeRafSamples:true})??null;}catch(e){return {error:String(e.message??e)};}
if(!s)return {error:d.playerError??null,missing:true,now:performance.now()};
const r=s.raf_diagnostics,i=s.input_latency;let profile=null;
${profiling?`try{const p=window.unonePlayerProfile;if(p){const rep=p.report();p.clear();profile={events:rep.events.map(e=>[e.id,e.kind,e.status,e.start_ms,e.wall_ms,e.spans.map(x=>[x.name,x.parent,x.ms])]),overwritten:rep.counts.overwritten??0,abandoned:rep.counts.abandoned??0};}}catch(e){profile={error:String(e.message??e)};}`:''}
return {error:d.playerError??null,now:performance.now(),visibility:document.visibilityState,focused:document.hasFocus(),dropped_steps_total:s.dropped_steps_total,recorded_total:r.recorded_total,
rows:(r.samples??[]).map(x=>[x.sequence??null,x.source,x.raf_time_ms,x.start_ms,x.end_ms,x.callback_end_ms,x.snapshot_frame,x.outcome,x.new_snapshot?1:0]),
inputs:i?.samples?i.samples.map(x=>[x.sequence,x.input_at_ms,x.tick_frame,x.presented_at_ms,x.delivered_at_ms??null]):null,input_admitted:i?.admitted??null,profile};})())`;

// ---------------------------------------------------------------- blank-page control

export const BLANK_PATH='/__unone_measure/blank.html';
// An empty page that only records requestAnimationFrame timestamps: the browser's own cadence.
export const BLANK_HTML=`<!doctype html><html><head><meta charset="utf-8"><title>blank</title><style>html,body{margin:0;height:100%;background:#000}</style></head><body><script>
(()=>{const t=[];window.__unoneBlank={now:()=>performance.now(),take:(a,b)=>t.filter(x=>x>=a&&x<=b)};
const f=ts=>{t.push(ts);if(t.length>400000)t.splice(0,200000);requestAnimationFrame(f);};requestAnimationFrame(f);})();
</script></body></html>`;

/** RAF intervals of the blank page in the same browser and viewport, after warmupMs, over windowMs. */
export async function measureBlank(page,url,{warmupMs=3000,windowMs}){
 await page.send('Page.navigate',{url});
 let ready=false;for(let i=0;i<200&&!ready;i++){try{ready=await page.evaluate('Boolean(window.__unoneBlank)',2000);}catch{}if(!ready)await sleep(50);}
 if(!ready)throw Error('MEASURE_BLANK_NOT_READY: the blank control page did not load');
 await sleep(warmupMs);
 const start=await page.evaluate('window.__unoneBlank.now()'),cpu=cpuTimes();
 await sleep(windowMs);
 const end=await page.evaluate('window.__unoneBlank.now()'),hostCpu=hostCpuBusy(cpu,cpuTimes());
 const stamps=JSON.parse(await page.evaluate(`JSON.stringify(window.__unoneBlank.take(${start},${end}))`,15000));
 const state=JSON.parse(await page.evaluate('JSON.stringify({visibility:document.visibilityState,focused:document.hasFocus()})'));
 const intervals=[];for(let i=1;i<stamps.length;i++)intervals.push(stamps[i]-stamps[i-1]);
 return {path:BLANK_PATH,warmup_ms:warmupMs,window_ms:round(end-start),frames:stamps.length,raf_interval:distributionOf(intervals,{gaps:true}),host_cpu_busy:hostCpu,foreground:state};
}

/**
 * One DevTools finger tap on the blank page: does it reach the page as a pointer event? A browser can
 * acknowledge touch commands and still deliver nothing (Chrome 150 on Android, to every new page for
 * about 10 minutes after a two-finger sequence); a scenario would then fail later on a milestone that
 * never comes. Returns {delivered, events, ack_ms}.
 */
export async function probeTouch(page,url,{timeoutMs=2000}={}){
 await page.send('Page.navigate',{url});
 let ready=false;for(let i=0;i<200&&!ready;i++){try{ready=await page.evaluate('Boolean(window.__unoneBlank)',2000);}catch{}if(!ready)await sleep(50);}
 if(!ready)throw Error('MEASURE_BLANK_NOT_READY: the blank control page did not load');
 await page.evaluate("document.documentElement.style.touchAction='none';window.__unoneTouchProbe=[];for(const t of ['pointerdown','pointerup','touchstart','touchend'])addEventListener(t,e=>window.__unoneTouchProbe.push(t),{capture:true});true");
 const began=performance.now();
 await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:10,y:10,id:0}]});
 await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 const ack=round(performance.now()-began);
 let events=[];for(const until=performance.now()+timeoutMs;performance.now()<until;){events=JSON.parse(await page.evaluate('JSON.stringify(window.__unoneTouchProbe)'));if(events.includes('pointerup'))break;await sleep(50);}
 return {delivered:events.includes('pointerdown'),events,ack_ms:ack};
}

// ---------------------------------------------------------------- running a scenario

// One read of the player's memory owners and milestone rows; kept small, it runs every sample_ms.
const SAMPLE_SOURCE=`JSON.stringify((()=>{const d=document.body?.dataset??{};let s=null;
try{s=window.unonePlayerPerformance?.snapshot({windowMs:1000,includeMemory:true})??null;}catch(e){return {error:String(e.message??e)};}
const m=s?.milestones;return {error:d.playerError??null,gone:!window.unonePlayerPerformance,href:location.href,memory:s?.memory?{owners:s.memory.owners,failures:s.memory.failures}:null,
milestones:m?{rows:m.rows.map(r=>[r.name,r.sequence,r.accepted_at_ms,r.presented_at_ms]),engine_dropped:m.engine_dropped,host_dropped:m.host_dropped}:null};})())`;
const MARK_SOURCE=`JSON.stringify((()=>{const d=document.body?.dataset??{};let m=null;try{m=window.unonePlayerPerformance?.snapshot({windowMs:1000})?.milestones??null;}catch{}
return {error:d.playerError??null,gone:!window.unonePlayerPerformance,href:location.href,now:performance.now(),milestones:m?{rows:m.rows.map(r=>[r.name,r.sequence,r.accepted_at_ms,r.presented_at_ms]),engine_dropped:m.engine_dropped,host_dropped:m.host_dropped}:null};})())`;

/** Columnar raw samples: one column list, one row per sample, null where a sample lacked a metric. */
export function columns(samples){
 const names=new Set();for(const s of samples)for(const name of Object.keys(s.metrics))names.add(name);
 const metricNames=[...names].sort();
 return {columns:['t_ms','phase','round','checkpoint',...metricNames],rows:samples.map(s=>[s.t_ms,s.phase,s.round,s.checkpoint,...metricNames.map(name=>s.metrics[name]??null)])};
}

const maxMetrics=samples=>{const out={};for(const s of samples)for(const [name,value] of Object.entries(s.metrics))if(finite(value)&&(out[name]===undefined||value>out[name]))out[name]=value;return out;};

/**
 * Run a parsed scenario on a page whose game is already presented. page: {send, evaluate};
 * readOs(): OS process memory or null. Returns the run's rounds, checkpoints, trends and raw samples;
 * a step that fails ends the run with ok:false and keeps what was measured.
 */
export async function runScenario(page,scenario,{readOs=null,log=()=>{},clock=()=>performance.now(),pollMs=50,framePollMs=2000,profiling=false}={}){
 const t0=clock(),at=()=>round(clock()-t0),samples=[];
 // The memory sampler pauses during frame windows: its player reads would land in the frames measured.
 let where={phase:null,round:null},seen=0,stop=false,samplerError=null,samplerPaused=false;
 // A page that left the player (navigated or reloaded) is not a player without milestones.
 const markState=state=>{if(state?.error)throw Error(`MEASURE_PLAYER_ERROR: ${state.error}`);
  if(state?.gone)throw Error(`MEASURE_PLAYER_GONE: the page no longer runs the player (now ${state.href}): it navigated or reloaded. A touch swipe does this when the game canvas lets the browser take touch gestures (CSS touch-action is not none) and the tab can go back`);
  return state?.milestones??null;};
 async function sample(checkpoint=false){
  const t=at(),tag=where;
  const [state,heap,dom]=await Promise.all([page.evaluate(SAMPLE_SOURCE,15000).then(JSON.parse),page.send('Runtime.getHeapUsage').catch(()=>null),page.send('Memory.getDOMCounters').catch(()=>null)]);
  markState(state);
  const metrics={...flattenMemory(state?.memory),...flattenHeap(heap,dom)};
  const row={t_ms:t,phase:tag.phase,round:tag.round,checkpoint,metrics};samples.push(row);return row;
 }
 async function checkpoint(){const row=await sample(true);const os=readOs?await readOs():null;Object.assign(row.metrics,flattenProcesses(os));return {row,os};}
 const sampler=(async()=>{while(!stop){const began=clock();if(!samplerPaused)try{await sample();}catch(error){samplerError??=String(error.message??error);}
  const rest=scenario.sample_ms-(clock()-began);for(let waited=0;!stop&&waited<rest;waited+=50)await sleep(Math.min(50,rest-waited));}})();
 const highestSequence=milestones=>Math.max(0,...(milestones?.rows??[]).map(r=>r[1]??0));
 // The next presented row with this name after sequence `after` (default: the last one a step saw).
 async function waitMark(name,timeoutMs,after=seen){
  const began=clock();
  for(;;){
   const state=JSON.parse(await page.evaluate(MARK_SOURCE,5000)),milestones=markState(state);
   if(!milestones)throw Error('MEASURE_SCENARIO_NO_MILESTONES: this player publishes no milestones; rebuild the runtime and export with an engine that has api.profile.mark');
   const row=milestones.rows.find(r=>r[0]===name&&r[1]>after&&r[3]!==null);
   if(row){seen=Math.max(seen,row[1]);return {sequence:row[1],accepted_at_ms:row[2],presented_at_ms:row[3]};}
   if(clock()-began>timeoutMs){const full=milestones.rows.length>=256||milestones.host_dropped>0||milestones.engine_dropped>0;
    throw Error(`MEASURE_SCENARIO_MARK_TIMEOUT: ${name} was not presented within ${timeoutMs} ms${full?' (the run already recorded 256 marks; later marks are dropped)':''}`);}
   await sleep(pollMs);
  }
 }
 async function pageNow(){return JSON.parse(await page.evaluate(MARK_SOURCE,5000)).now;}
 // Touch points carry their index as id; a touchEnd lists no points (all fingers lift).
 const touch=(type,points)=>page.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([x,y],id)=>({x,y,id}))});
 // moves evenly spaced in time over s.ms, each at fraction t of the way.
 async function glide(s,move){const began=clock();for(let i=1;i<=s.moves;i++){const t=i/s.moves;await move(t);const wait=began+s.ms*t-clock();if(wait>0)await sleep(wait);}}
 // timed: read the page clock before a key or tap, for presented_after_input_ms; frame loops skip it.
 async function step(s,{timed=true}={}){
  const began=clock();
  if(s.kind==='key'){const fields=keyFields(s.key),input_at_ms=timed?await pageNow():undefined;
   await page.send('Input.dispatchKeyEvent',{type:'keyDown',...fields});await sleep(s.hold_ms);
   const {text,...up}=fields;await page.send('Input.dispatchKeyEvent',{type:'keyUp',...up});
   return {kind:'key',key:s.key,input_at_ms,ms:round(clock()-began)};}
  if(s.kind==='tap'&&s.pointer==='touch'){const [x,y]=s.tap,input_at_ms=timed?await pageNow():undefined;
   await touch('touchStart',[[x,y]]);await sleep(s.hold_ms);await touch('touchEnd',[]);
   return {kind:'tap',pointer:'touch',tap:s.tap,input_at_ms,ms:round(clock()-began)};}
  if(s.kind==='drag'&&s.pointer==='touch'){
   const [x0,y0]=s.from,[x1,y1]=s.to;
   await touch('touchStart',[[x0,y0]]);
   await glide(s,t=>touch('touchMove',[[x0+(x1-x0)*t,y0+(y1-y0)*t]]));
   await touch('touchEnd',[]);
   return {kind:'drag',pointer:'touch',ms:round(clock()-began)};}
  if(s.kind==='pinch'){
   const [x,y]=s.at,fingers=d=>[[x-d/2,y],[x+d/2,y]];
   await touch('touchStart',fingers(s.from));
   await glide(s,t=>touch('touchMove',fingers(s.from+(s.to-s.from)*t)));
   await touch('touchEnd',[]);
   return {kind:'pinch',ms:round(clock()-began)};}
  if(s.kind==='tap'){const [x,y]=s.tap,input_at_ms=timed?await pageNow():undefined;
   await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'none',buttons:0});
   await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});await sleep(s.hold_ms);
   await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});
   return {kind:'tap',tap:s.tap,input_at_ms,ms:round(clock()-began)};}
  if(s.kind==='drag'){
   const [x0,y0]=s.from,[x1,y1]=s.to;
   await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x0,y:y0,button:'none',buttons:0});
   await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:x0,y:y0,button:'left',buttons:1,clickCount:1});
   await glide(s,t=>page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x0+(x1-x0)*t,y:y0+(y1-y0)*t,button:'left',buttons:1}));
   await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x1,y:y1,button:'left',buttons:0,clickCount:1});
   return {kind:'drag',ms:round(clock()-began)};}
  if(s.kind==='wheel'){
   const [x,y]=s.at;
   for(let i=0;i<s.count;i++){await page.send('Input.dispatchMouseEvent',{type:'mouseWheel',x,y,deltaX:s.dx,deltaY:s.dy});if(s.interval_ms>0)await sleep(s.interval_ms);}
   return {kind:'wheel',ms:round(clock()-began)};}
  if(s.kind==='wait_mark'){const mark=await waitMark(s.wait_mark,s.timeout_ms);return {kind:'wait_mark',mark:s.wait_mark,...mark,ms:round(clock()-began)};}
  await sleep(s.wait_ms);return {kind:'wait_ms',ms:round(clock()-began)};
 }
 // A frame window: setup once, then the loop repeats through warmup and the measured window while the
 // player's draw and input rows are read every framePollMs and stitched by sequence. Then a checkpoint.
 async function framePhase(phase){
  where={phase:phase.name,round:null};
  for(const s of phase.setup)await step(s);
  samplerPaused=true;
  let stopLoop=false,iterations=0,loopError=null;
  const looping=(async()=>{try{while(!stopLoop){for(const s of phase.loop){if(stopLoop)break;await step(s,{timed:false});}iterations++;}}catch(failure){loopError=String(failure.message??failure);}})();
  const rows=new Map(),inputs=new Map(),events=new Map(),foreground={polls:0,hidden:0,unfocused:0};
  let profileFirst=null,profileLast=null,profileError=null,inputsReported=true;
  const poll=async()=>{
   const state=JSON.parse(await page.evaluate(frameSource(framePollMs*2,profiling),15000));
   if(state.error)throw Error(`MEASURE_PLAYER_ERROR: ${state.error}`);
   if(state.missing)throw Error('MEASURE_SCENARIO_NO_FRAMES: this player has no unonePlayerPerformance accessor');
   for(const r of state.rows)rows.set(r[0]??`${r[2]}|${r[3]}|${r[4]}|${r[7]}`,{sequence:r[0],source:r[1],raf:r[2],start:r[3],end:r[4],callback:r[5],frame:r[6],outcome:r[7],fresh:r[8]===1});
   if(state.inputs===null)inputsReported=false;else for(const x of state.inputs)inputs.set(x[0],{sequence:x[0],at:x[1],frame:x[2],presented:x[3],delivered:x[4]});
   if(state.profile?.error)profileError??=state.profile.error;
   else if(state.profile){profileFirst??=state.profile;profileLast=state.profile;for(const e of state.profile.events)events.set(e[0],{id:e[0],kind:e[1],status:e[2],start:e[3],wall:e[4],spans:e[5]});}
   foreground.polls++;if(state.visibility!=='visible')foreground.hidden++;if(state.focused!==true)foreground.unfocused++;
   return state;
  };
  let first=null,last=null,error=null,cpu=null;
  try{
   await sleep(phase.warmup_ms);
   first=await poll();events.clear();cpu=cpuTimes();
   const until=clock()+phase.window_ms;
   while(clock()<until&&!loopError){await sleep(Math.min(framePollMs,Math.max(0,until-clock())));last=await poll();}
  }catch(failure){error=String(failure.message??failure);}
  const hostCpu=hostCpuBusy(cpu,cpuTimes());
  stopLoop=true;await looping;samplerPaused=false;
  error??=loopError;
  let longTasks=null;
  if(first&&last)try{longTasks=JSON.parse(await page.evaluate(`JSON.stringify(window.__unoneMeasure?(window.__unoneMeasure.long_tasks??[]).filter(t=>t.start_ms+t.duration_ms>=${first.now}&&t.start_ms<=${last.now}):null)`,10000));if(!Array.isArray(longTasks))longTasks=null;}catch{}
  const window={name:phase.name,kind:'frames',warmup_ms:phase.warmup_ms,window_ms:phase.window_ms,loop_iterations:iterations,foreground,error};
  if(first&&last){
   window.window={start_ms:first.now,end_ms:last.now};
   window.metrics=frameWindowMetrics({rows:[...rows.values()],inputs:[...inputs.values()],start:first.now,end:last.now,droppedStart:first.dropped_steps_total,droppedEnd:last.dropped_steps_total});
   if(!inputsReported){window.metrics.input_latency=null;window.metrics.input_delivery=null;}
   window.metrics.host_cpu_busy=hostCpu;
   window.metrics.long_tasks=longTasks?{count:longTasks.length,total_ms:round(longTasks.reduce((sum,t)=>sum+t.duration_ms,0)),max_ms:round(longTasks.reduce((max,t)=>Math.max(max,t.duration_ms),0))}:null;
   if(longTasks?.length)window.long_tasks=longTasks.slice(0,100).map(t=>({start_ms:round(t.start_ms),duration_ms:round(t.duration_ms)}));
   if(profiling)window.profile=profileError?{error:profileError}:{events:events.size,overwritten:(profileLast?.overwritten??0)-(profileFirst?.overwritten??0),abandoned:(profileLast?.abandoned??0)-(profileFirst?.abandoned??0),spans:profileWindowSummary([...events.values()],last.now-first.now)};
  }
  if(!error){const {row,os}=await checkpoint();window.end=row.metrics;window.os=os;}
  log(error?`${phase.name}: ${error}`:`${phase.name}: ${window.metrics.completed_submissions} submissions, p95 ${window.metrics.submission_interval.p95_ms} ms, over 50 ms ${window.metrics.submission_interval.over_50ms}, host CPU busy ${window.metrics.host_cpu_busy}`);
  return window;
 }
 const result={ok:true,error:null,started_after_mark:scenario.start_mark,profiling,phases:[],settled:null,os_supported:null};
 try{
  if(readOs){const warm=await readOs();result.os_supported=warm?.supported??false;}
  if(scenario.start_mark)await waitMark(scenario.start_mark,scenario.step_timeout_ms,0);
  seen=highestSequence(markState(JSON.parse(await page.evaluate(MARK_SOURCE,5000))));
  const baseline=await checkpoint();result.baseline={at_ms:baseline.row.t_ms,metrics:baseline.row.metrics,os:baseline.os};
  for(const phase of scenario.phases){
   if(phase.kind==='frames'){const window=await framePhase(phase);result.phases.push(window);if(window.error)throw Error(window.error);continue;}
   const rounds=[];result.phases.push({name:phase.name,kind:'rounds',rounds});
   for(let r=1;r<=phase.warmup_rounds+phase.rounds;r++){
    const warmup=r<=phase.warmup_rounds,index=warmup?r:r-phase.warmup_rounds;
    where={phase:warmup?`${phase.name}:warmup`:phase.name,round:index};
    const started=at(),from=samples.length,steps=[];
    for(const s of phase.steps)steps.push(await step(s));
    // Milestone presentation relative to the input that preceded it, both on the page clock.
    let lastInput=null;for(const s of steps){if(s.input_at_ms!==undefined)lastInput=s.input_at_ms;else if(s.kind==='wait_mark'&&finite(lastInput)&&finite(s.presented_at_ms))s.presented_after_input_ms=round(s.presented_at_ms-lastInput);}
    const ended=at(),{row,os}=await checkpoint();
    // Only this round's samples: a background read that began in the previous round keeps its tag.
    const own=samples.slice(from).filter(s=>s.phase===where.phase&&s.round===where.round);
    rounds.push({index,warmup,started_ms:started,duration_ms:round(ended-started),steps,end:row.metrics,peak:maxMetrics(own),samples:own.length,os});
    if(!warmup&&(index===1||index%5===0||index===phase.rounds))log(`${phase.name} round ${index}/${phase.rounds}: ${round(ended-started)} ms`);
   }
  }
  where={phase:'settle',round:null};
  const settleFrom=samples.length;
  await sleep(scenario.settle_ms);
  const {row,os}=await checkpoint();
  result.settled={after_ms:scenario.settle_ms,metrics:row.metrics,peak:maxMetrics(samples.slice(settleFrom).filter(s=>s.phase==='settle')),os};
 }catch(error){result.ok=false;result.error=String(error.message??error);}
 finally{stop=true;await sampler;}
 for(const phase of result.phases)if(phase.kind==='rounds')phase.trend=phaseTrends(phase.rounds);
 result.sampler_error=samplerError;
 result.samples=columns(samples);
 return result;
}
