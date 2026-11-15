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
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';

export const SCENARIO_SCHEMA='unone.web-scenario.v1';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const round=n=>finite(n)?Math.round(n*1000)/1000:null;
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
const PHASE_KEYS=['name','warmup_rounds','rounds','steps'];
const STEP_KINDS=['key','tap','wait_mark','wait_ms'];
const STEP_KEYS={key:['key','hold_ms'],tap:['tap','hold_ms'],wait_mark:['wait_mark','timeout_ms'],wait_ms:['wait_ms']};

/** Parse and check a scenario file's text; every problem is MEASURE_SCENARIO_INVALID with where it is. */
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
 const phases=s.phases.map((phase,p)=>{
  const at=`phases[${p}]`;
  if(!phase||typeof phase!=='object'||Array.isArray(phase))fail(at,'must be an object');
  for(const key of Object.keys(phase))if(!PHASE_KEYS.includes(key))fail(`${at}.${key}`,`unknown field (allowed: ${PHASE_KEYS.join(', ')})`);
  if(!printable(phase.name)||phase.name==='settle')fail(`${at}.name`,'1-64 printable characters, not "settle"');
  if(names.has(phase.name))fail(`${at}.name`,`"${phase.name}" is used twice`);names.add(phase.name);
  const warmup=whole(phase.warmup_rounds,`${at}.warmup_rounds`,0,100,0),rounds=whole(phase.rounds,`${at}.rounds`,1,1000,undefined);
  if(rounds===undefined)fail(`${at}.rounds`,'required');
  if(!Array.isArray(phase.steps)||phase.steps.length<1||phase.steps.length>64)fail(`${at}.steps`,'1-64 steps');
  const steps=phase.steps.map((step,i)=>{
   const where=`${at}.steps[${i}]`;
   if(!step||typeof step!=='object'||Array.isArray(step))fail(where,'must be an object');
   const kinds=STEP_KINDS.filter(kind=>Object.hasOwn(step,kind));
   if(kinds.length!==1)fail(where,`exactly one of ${STEP_KINDS.join(', ')}`);
   const kind=kinds[0];
   for(const key of Object.keys(step))if(!STEP_KEYS[kind].includes(key))fail(`${where}.${key}`,`not allowed on a ${kind} step (allowed: ${STEP_KEYS[kind].join(', ')})`);
   if(kind==='key'){if(!keyFields(step.key))fail(`${where}.key`,'a KeyboardEvent.code such as KeyT, Digit1, Escape, Enter, Space, ArrowLeft or F1');return Object.freeze({kind,key:step.key,hold_ms:whole(step.hold_ms,`${where}.hold_ms`,0,10000,50)});}
   if(kind==='tap'){const t=step.tap;if(!Array.isArray(t)||t.length!==2||!t.every(n=>finite(n)&&n>=0&&n<=100000))fail(`${where}.tap`,'[x, y] in CSS pixels from the top-left of the viewport');return Object.freeze({kind,tap:Object.freeze([...t]),hold_ms:whole(step.hold_ms,`${where}.hold_ms`,0,10000,50)});}
   if(kind==='wait_mark'){if(!printable(step.wait_mark))fail(`${where}.wait_mark`,'the name the game passes to api.profile.mark');markWaits+=warmup+rounds;return Object.freeze({kind,wait_mark:step.wait_mark,timeout_ms:whole(step.timeout_ms,`${where}.timeout_ms`,100,600000,stepTimeoutMs)});}
   return Object.freeze({kind,wait_ms:whole(step.wait_ms,`${where}.wait_ms`,0,600000,undefined)});
  });
  return Object.freeze({name:phase.name,warmup_rounds:warmup,rounds,steps:Object.freeze(steps)});
 });
 // The engine keeps a run's first 256 marks and the player's milestone table holds 256 rows.
 if(markWaits+(s.start_mark?1:0)>256)fail('phases',`waits for ${markWaits} milestones across all rounds; a run records at most 256 api.profile.mark calls, so use fewer rounds or fewer waits`);
 return Object.freeze({schema:SCENARIO_SCHEMA,name:s.name,...(s.description!==undefined?{description:s.description}:{}),start_mark:s.start_mark??null,phases:Object.freeze(phases),settle_ms:settleMs,sample_ms:sampleMs,step_timeout_ms:stepTimeoutMs});
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

function runProcess(command,args,{timeoutMs=30000,input=null}={}){
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

// ---------------------------------------------------------------- running a scenario

// One read of the player's memory owners and milestone rows; kept small, it runs every sample_ms.
const SAMPLE_SOURCE=`JSON.stringify((()=>{const d=document.body?.dataset??{};let s=null;
try{s=window.unonePlayerPerformance?.snapshot({windowMs:1000,includeMemory:true})??null;}catch(e){return {error:String(e.message??e)};}
const m=s?.milestones;return {error:d.playerError??null,memory:s?.memory?{owners:s.memory.owners,failures:s.memory.failures}:null,
milestones:m?{rows:m.rows.map(r=>[r.name,r.sequence,r.accepted_at_ms,r.presented_at_ms]),engine_dropped:m.engine_dropped,host_dropped:m.host_dropped}:null};})())`;
const MARK_SOURCE=`JSON.stringify((()=>{const d=document.body?.dataset??{};let m=null;try{m=window.unonePlayerPerformance?.snapshot({windowMs:1000})?.milestones??null;}catch{}
return {error:d.playerError??null,now:performance.now(),milestones:m?{rows:m.rows.map(r=>[r.name,r.sequence,r.accepted_at_ms,r.presented_at_ms]),engine_dropped:m.engine_dropped,host_dropped:m.host_dropped}:null};})())`;

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
export async function runScenario(page,scenario,{readOs=null,log=()=>{},clock=()=>performance.now(),pollMs=50}={}){
 const t0=clock(),at=()=>round(clock()-t0),samples=[];
 let where={phase:null,round:null},seen=0,stop=false,samplerError=null;
 const markState=state=>{if(state?.error)throw Error(`MEASURE_PLAYER_ERROR: ${state.error}`);return state?.milestones??null;};
 async function sample(checkpoint=false){
  const t=at(),tag=where;
  const [state,heap,dom]=await Promise.all([page.evaluate(SAMPLE_SOURCE,15000).then(JSON.parse),page.send('Runtime.getHeapUsage').catch(()=>null),page.send('Memory.getDOMCounters').catch(()=>null)]);
  markState(state);
  const metrics={...flattenMemory(state?.memory),...flattenHeap(heap,dom)};
  const row={t_ms:t,phase:tag.phase,round:tag.round,checkpoint,metrics};samples.push(row);return row;
 }
 async function checkpoint(){const row=await sample(true);const os=readOs?await readOs():null;Object.assign(row.metrics,flattenProcesses(os));return {row,os};}
 const sampler=(async()=>{while(!stop){const began=clock();try{await sample();}catch(error){samplerError??=String(error.message??error);}
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
 async function step(s){
  const began=clock();
  if(s.kind==='key'){const fields=keyFields(s.key),input_at_ms=await pageNow();
   await page.send('Input.dispatchKeyEvent',{type:'keyDown',...fields});await sleep(s.hold_ms);
   const {text,...up}=fields;await page.send('Input.dispatchKeyEvent',{type:'keyUp',...up});
   return {kind:'key',key:s.key,input_at_ms,ms:round(clock()-began)};}
  if(s.kind==='tap'){const [x,y]=s.tap,input_at_ms=await pageNow();
   await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'none',buttons:0});
   await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});await sleep(s.hold_ms);
   await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});
   return {kind:'tap',tap:s.tap,input_at_ms,ms:round(clock()-began)};}
  if(s.kind==='wait_mark'){const mark=await waitMark(s.wait_mark,s.timeout_ms);return {kind:'wait_mark',mark:s.wait_mark,...mark,ms:round(clock()-began)};}
  await sleep(s.wait_ms);return {kind:'wait_ms',ms:round(clock()-began)};
 }
 const result={ok:true,error:null,started_after_mark:scenario.start_mark,phases:[],settled:null,os_supported:null};
 try{
  if(readOs){const warm=await readOs();result.os_supported=warm?.supported??false;}
  if(scenario.start_mark)await waitMark(scenario.start_mark,scenario.step_timeout_ms,0);
  seen=highestSequence(markState(JSON.parse(await page.evaluate(MARK_SOURCE,5000))));
  const baseline=await checkpoint();result.baseline={at_ms:baseline.row.t_ms,metrics:baseline.row.metrics,os:baseline.os};
  for(const phase of scenario.phases){
   const rounds=[];result.phases.push({name:phase.name,rounds});
   for(let r=1;r<=phase.warmup_rounds+phase.rounds;r++){
    const warmup=r<=phase.warmup_rounds,index=warmup?r:r-phase.warmup_rounds;
    where={phase:warmup?`${phase.name}:warmup`:phase.name,round:index};
    const started=at(),from=samples.length,steps=[];
    for(const s of phase.steps)steps.push(await step(s));
    // Milestone presentation relative to the input that preceded it, both on the page clock.
    let lastInput=null;for(const s of steps){if(s.input_at_ms!==undefined)lastInput=s.input_at_ms;else if(s.kind==='wait_mark'&&finite(lastInput)&&finite(s.presented_at_ms))s.presented_after_input_ms=round(s.presented_at_ms-lastInput);}
    const ended=at(),{row,os}=await checkpoint();
    rounds.push({index,warmup,started_ms:started,duration_ms:round(ended-started),steps,end:row.metrics,peak:maxMetrics(samples.slice(from)),os});
    if(!warmup&&(index===1||index%5===0||index===phase.rounds))log(`${phase.name} round ${index}/${phase.rounds}: ${round(ended-started)} ms`);
   }
  }
  where={phase:'settle',round:null};
  const settleFrom=samples.length;
  await sleep(scenario.settle_ms);
  const {row,os}=await checkpoint();
  result.settled={after_ms:scenario.settle_ms,metrics:row.metrics,peak:maxMetrics(samples.slice(settleFrom)),os};
 }catch(error){result.ok=false;result.error=String(error.message??error);}
 finally{stop=true;await sampler;}
 for(const phase of result.phases)phase.trend=phaseTrends(phase.rounds);
 result.sampler_error=samplerError;
 result.samples=columns(samples);
 return result;
}
