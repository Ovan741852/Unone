// Cache-only actual emitted sampler diagnostic. No Game source is embedded.
// Written during a quiet window; execution requires a later coordinated grant.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {instantiateEmittedRuntime,within} from '../scripts/immutable-bytes-emitted-runtime.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),self=fileURLToPath(import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const hash=value=>value===undefined?null:sha(JSON.stringify(stable(value)));
const digestPattern=/^sha256:[a-f0-9]{64}$/;
const modes=['off','probes','sampling'];
const help=`node .cache/profile-core-sampler-wasm-20261103-r1.mjs --runtime <sampling-profile/runtime> --pins <runtime-pins.json> --payload <payload.json> --input-sequence <InputFrame[].json> --out <fresh-directory>
Runtime pins JSON EXACT {manifest,source,javascript,wasm}, with SHA256 hashes and 40hex source commit.
[--expected-payload <sha256>] [--expected-inputs <sha256>] [--data-dir <directory>]
[--warmup 66] [--frames 300] [--seed 42] [--timeout-ms 180000]
Default input hashes pin frozen JYR2 battle; other fixtures require explicit expected hashes.
Three fresh child processes/VMs: off, unsampled VM probes, then function sampling+VM probes.
No production/FPS/phase-only/GC-cause claim, no API shim, forced GC or Native executable.`;

function requireHash(value,label){assert(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),`Invalid ${label}`);return value;}
function integer(value,label,min,max){assert(/^(0|[1-9][0-9]*)$/.test(String(value)),`Invalid ${label}`);const n=Number(value);assert(Number.isSafeInteger(n)&&n>=min&&n<=max,`Invalid ${label}`);return n;}
function pinned(file,expected,pins,label){const bytes=fs.readFileSync(file),digest=sha(bytes);if(expected)assert.equal(digest,expected,label);pins.push({label,path:file,bytes:bytes.length,sha256:digest});return bytes;}
function json(file,limit=1024*1024){const stat=fs.statSync(file);assert(stat.isFile()&&stat.size<=limit,'JSON byte bound');const bytes=fs.readFileSync(file);assert(bytes.length<=limit);return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
function unchanged(pins){for(const pin of pins){const bytes=fs.readFileSync(pin.path);assert.equal(bytes.length,pin.bytes);assert.equal(sha(bytes),pin.sha256,pin.path);}}
function hostSources(){
 const pending=[path.join(root,'web/shared/runtime-core.mjs')],seen=new Set(),pins=[];
 while(pending.length){const file=fs.realpathSync(pending.pop());if(seen.has(file))continue;seen.add(file);assert(seen.size<=128&&within(path.join(root,'web'),file));const bytes=pinned(file,null,pins,'host_source');for(const match of bytes.toString('utf8').matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?['"](\.[^'"]+)['"]/g))pending.push(path.resolve(path.dirname(file),match[1]));}
 return pins;
}
function admit(directory,expected,pins){
 const runtime=fs.realpathSync(directory);assert(expected&&Object.keys(expected).length===4&&['manifest','source','javascript','wasm'].every(key=>Object.hasOwn(expected,key)),'Exact runtime pins required');
 for(const key of ['manifest','javascript','wasm'])requireHash(expected[key],key);assert(/^[a-f0-9]{40}$/.test(expected.source),'Source commit pin required');
 const metadata=JSON.parse(pinned(path.join(runtime,'runtime.json'),expected.manifest,pins,'runtime_manifest'));
 assert.equal(metadata.source_commit,expected.source);assert.equal(metadata.source_dirty,false);assert.equal(metadata.profile,'release');assert.equal(metadata.bytecode_optimization_level,2);assert.equal(metadata.dev_tools,false);assert.equal(metadata.preview_tools,true);assert.equal(metadata.phase_profile,false);assert.equal(metadata.sampling_profile,true);assert.equal(metadata.profile_mode,'opt2-sampling');
 assert(Array.isArray(metadata.cargo_features)&&metadata.cargo_features.includes('sampling-profile')&&!metadata.cargo_features.includes('phase-profile'));
 const file=name=>{assert(typeof name==='string'&&name&&!path.isAbsolute(name));const resolved=fs.realpathSync(path.resolve(runtime,name));assert(within(runtime,resolved),'Runtime file escapes artifact');return resolved;};
 const javascriptFile=file(metadata.javascript),wasmFile=file(metadata.wasm),javascript=pinned(javascriptFile,expected.javascript,pins,'runtime_javascript'),wasm=pinned(wasmFile,expected.wasm,pins,'runtime_wasm');
 assert.equal(metadata.javascript_sha256,expected.javascript);assert.equal(metadata.wasm_sha256,expected.wasm);assert.equal(metadata.wasm_bytes,wasm.length);
 const exports=WebAssembly.Module.exports(new WebAssembly.Module(wasm)).map(value=>value.name);
 for(const name of ['alloc','load_project','unload_project','set_input_frame','set_viewport_size','set_instance_transport','set_ui_transport','tick','observation_ptr','observation_len','developer_request'])assert(exports.includes('unone_web_'+name),`Actual ABI missing: ${name}`);
 return {runtime,metadata,exports,javascriptFile,javascript,wasm};
}
function admitOutput(value,runtime){const out=path.resolve(value);assert(!fs.existsSync(out),'Refuse overwrite');const result=path.join(fs.realpathSync(path.dirname(out)),path.basename(out));assert(!within(runtime,result),'Output must be outside immutable runtime');return result;}
function dataAssets(payload,directory,payloadDataSources,pins){
 const sources=payloadDataSources(payload);assert(Array.isArray(sources)&&sources.length<=4096);const seen=new Set(),base=fs.realpathSync(directory);let total=0;
 return sources.map(({id,source})=>{assert(typeof id==='string'&&id&&!seen.has(id));seen.add(id);assert(typeof source==='string'&&source&&!path.isAbsolute(source)&&!/[\\:]/.test(source)&&source.split('/').every(part=>part&&part!=='.'&&part!=='..'));const file=fs.realpathSync(path.resolve(base,source));assert(within(base,file));const size=fs.statSync(file).size;total+=size;assert(size<=256*1024*1024&&total<=512*1024*1024);return {id,bytes:new Uint8Array(pinned(file,null,pins,'data:'+id))};});
}
function executionMode(profile){
 const e=profile.execution;assert(e&&e.phase_profile===false&&e.sampling_profile===true&&e.bytecode_optimization_level===2&&e.preview_tools===true&&e.rust_profile==='release'&&e.target_arch==='wasm32'&&e.native_codegen_requested===false);return e;
}
function stats(values){assert(values.length&&values.every(value=>Number.isFinite(value)&&value>=0));const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,total_ms:values.reduce((a,b)=>a+b,0),p50_ms:sorted[Math.floor(sorted.length/2)],p95_ms:sorted[Math.ceil(sorted.length*.95)-1],max_ms:sorted.at(-1)};}
function validateVm(vm,frames){
 assert(vm&&vm.tick_count===frames&&vm.frames.length===frames&&vm.retained_limit>=frames);assert.equal(vm.availability.allocation_growth,'measured');assert.equal(vm.availability.incremental_gc_wall_time,'measured');
 for(const field of ['allocation_growth_bytes','allocation_growth_events','incremental_gc_steps','incremental_gc_ms','incremental_gc_max_step_ms'])assert(typeof vm[field]==='number'&&Number.isFinite(vm[field])&&vm[field]>=0,`Unavailable VM field ${field}`);
 assert.equal(vm.full_gc_ms,null);assert.equal(vm.js_gc_ms,null);assert.equal(vm.rust_allocation_bytes,null);
}


const scenarioPins={"inventory":"64f7acb00c674bdb80a7a053bb56848f8175de419a7ea4858d9ac2a998d09993","battle":"918eb4fc22bafd462f41c58cea5da645af0adb8e6c125ee8f6206a526ef23434"};
const publicFields=['screen','ui_window','in_battle','position','hp','player_hp','battle_wave','battle_result'];
function observeGame(report,last,stage,inputIndex){
 const o=last.world.observations??{},value=Object.fromEntries(publicFields.filter(k=>Object.hasOwn(o,k)).map(k=>[k,o[k]]));
 assert.equal(typeof value.screen,'string');assert.equal(typeof value.ui_window,'string');assert.equal(typeof value.in_battle,'boolean');
 const phase=JSON.stringify([value.screen,value.ui_window,value.in_battle]);
 report.public_phase_counts??={};report.public_phase_counts[stage]??={};report.public_phase_counts[stage][phase]=(report.public_phase_counts[stage][phase]??0)+1;
 report.public_timeline??=[];report.public_timeline.push({frame:last.world.frame,input_index:inputIndex,stage,...value});
 if(stage==='warmup')for(const expected of report.scenario.expectedCheckpoints.filter(v=>v.afterInputIndex===inputIndex))for(const[key,wanted]of Object.entries(expected))if(key!=='afterInputIndex')assert.deepEqual(o[key],wanted,'Actual fixture checkpoint '+inputIndex+'/'+key);
}

async function worker(configFile,out){
 const config=json(configFile),pins=[],artifact=admit(config.runtime,config.runtimePins,pins);assert(modes.includes(config.mode));const target=admitOutput(out,artifact.runtime);fs.mkdirSync(target);
 const report={version:1,ok:false,mode:config.mode,pins,metadata:artifact.metadata,exports:artifact.exports,rows:[],digests:[],stderr:[],stderr_overflow:0,aborts:[],environment:{node:process.version,platform:process.platform,arch:process.arch,started_utc:new Date().toISOString()}};let module,core;
 try{
  pinned(self,config.scriptHash,pins,'harness');pinned(path.join(root,'scripts/immutable-bytes-emitted-runtime.mjs'),null,pins,'emitted_loader');pins.push(...config.host);unchanged(pins);
  const payloadBytes=pinned(config.payload,config.payloadHash,pins,'payload'),sequenceBytes=pinned(config.sequence,config.sequenceHash,pins,'input_sequence');assert(payloadBytes.length<=64*1024*1024&&sequenceBytes.length<=8*1024*1024);const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payloadBytes)),sequence=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(sequenceBytes));assert(payload?.config&&Array.isArray(sequence)&&sequence.length<=10000&&sequence.every(value=>value&&typeof value==='object'&&!Array.isArray(value)));
  const {createRuntimeCore}=await import(pathToFileURL(path.join(root,'web/shared/runtime-core.mjs'))),{payloadDataSources}=await import(pathToFileURL(path.join(root,'web/shared/load-project.js')));unchanged(pins);const data=dataAssets(payload,config.dataDir,payloadDataSources,pins);
  const caseName=path.basename(config.payload).split('.')[0];assert(Object.hasOwn(scenarioPins,caseName));
  report.scenario=JSON.parse(pinned(path.join(path.dirname(config.payload),caseName+'.scenario.json'),scenarioPins[caseName],pins,'scenario'));
  assert.equal(report.scenario.payloadSha256,config.payloadHash);assert.equal(report.scenario.inputsSha256,config.sequenceHash);assert.equal(sha(payload.script),report.scenario.sourceSha256);
  module=await instantiateEmittedRuntime({...artifact,timeoutMs:30000,diagnostics:report});core=createRuntimeCore(module,{profile:false});
  let last=await core.execute({kind:'load',payload,seed:config.seed,data});assert.equal(last.world.frame,0);
  observeGame(report,last,'load',-1);
  const digest=()=>{assert(typeof last.observation_digest==='string'&&digestPattern.test(last.observation_digest));report.digests.push(last.observation_digest);};digest();
  assert.deepEqual([...last.compiled_systems].sort(),[...artifact.metadata.compiled_systems].sort());
  for(let i=0;i<config.warmup;i++){last=await core.execute({kind:'tick',input:sequence[i]??{}});assert.equal(last.world.frame,i+1);digest();observeGame(report,last,'warmup',i);}
  report.heap_samples=[];
  async function sampleHeap(){
   const memory=await core.execute({kind:'developer',request:{method:'memory_sample',label:caseName+'_steady_no_collect',collect:false,warmup:false}});
   const sample=memory.samples?.at(-1);assert(sample&&sample.collected===false&&sample.full_gc_wall_ms===null&&sample.reclaimed_bytes===null);
   assert.equal(sample.lua_used_before_bytes,sample.lua_used_after_bytes);assert.equal(sample.tick,last.world.frame);report.heap_samples.push(sample);
  }
  await sampleHeap();
  const request=config.mode==='off'?{method:'profile'} :{method:'profile_start',sampling:config.mode==='sampling'};
  const start=await core.execute({kind:'developer',request});report.execution=executionMode(start);assert.equal(start.window.core_phases,null);assert.equal(start.window.active,config.mode!=='off');assert.equal(start.window.sampling,config.mode==='sampling');assert.equal(start.window.vm.tick_count,0);
  report.options={warmup:config.warmup,frames:config.frames,seed:config.seed,input_sequence_frames:sequence.length,data_sources:data.length,mode:config.mode,profile_window:config.mode!=='off',function_sampling:config.mode==='sampling'};
  report.capacity_before_bytes=module.HEAPU8.buffer.byteLength;
  for(let i=0;i<config.frames;i++){const begin=performance.now();last=await core.execute({kind:'tick',input:sequence[config.warmup+i]??{}});const end=performance.now();assert.equal(last.world.frame,config.warmup+i+1);digest();report.rows.push({frame:last.world.frame,command_ms:end-begin,vm:null});observeGame(report,last,'measured',config.warmup+i);if((i+1)%60===0)await sampleHeap();}
  report.capacity_after_bytes=module.HEAPU8.buffer.byteLength;
  report.final={frame:last.world.frame,core_digest:last.observation_digest,world_sha256:hash(last.world),ui_sha256:hash(last.world.ui),save_sha256:hash(last.save_payload)};report.final_world=JSON.stringify(stable(last.world));report.final_save=last.save_payload===undefined?null:JSON.stringify(stable(last.save_payload));
  report.profile=await core.execute({kind:'developer',request:{method:config.mode==='off'?'profile':'profile_stop'}});executionMode(report.profile);assert.equal(report.profile.window.active,false);assert.equal(report.profile.window.core_phases,null);assert.equal(report.profile.window.sampling,config.mode==='sampling');
  const vm=report.profile.window.vm;
  if(config.mode==='off'){
   assert.equal(vm.tick_count,0);assert.equal(vm.frames.length,0);assert.equal(report.profile.window.samples,0);report.vm_metrics=null;report.vm_status='Profiling window disabled; zero raw counters do not mean zero allocation/GC.';
  }else{
   validateVm(vm,config.frames);const joined=new Map();for(const row of vm.frames){assert(row.completed&&!joined.has(row.frame));joined.set(row.frame,row);}
   for(const row of report.rows){const counters=joined.get(row.frame);assert(counters,'Exact VM frame join missing');for(const key of ['allocation_growth_bytes','allocation_growth_events','incremental_gc_steps','incremental_gc_ms','incremental_gc_max_step_ms'])assert(typeof counters[key]==='number'&&Number.isFinite(counters[key])&&counters[key]>=0);row.vm=counters;}
   report.vm_metrics={tick_count:vm.tick_count,allocation_growth_bytes:vm.allocation_growth_bytes,allocation_growth_events:vm.allocation_growth_events,incremental_gc_steps:vm.incremental_gc_steps,incremental_gc_ms:vm.incremental_gc_ms,incremental_gc_max_step_ms:vm.incremental_gc_max_step_ms,scope:vm.scope,availability:vm.availability,allocation_method:vm.allocation_method,gc_method:vm.gc_method};
   if(config.mode==='probes')assert.equal(report.profile.window.samples,0);
   if(config.mode==='sampling'){assert(report.profile.window.samples>0,'No actual function samples collected');assert(Object.keys(report.profile.window.functions).length>0);}
  }
  report.command=stats(report.rows.map(row=>row.command_ms));report.digest_checkpoints=report.digests.length;assert.equal(report.digest_checkpoints,1+config.warmup+config.frames);
  report.top_functions=Object.entries(report.profile.window.functions).sort((a,b)=>b[1].self_samples-a[1].self_samples).slice(0,100).map(([key,value])=>({key,...value}));
  report.tail_rows=report.rows.filter(row=>row.command_ms>=report.command.p95_ms).sort((a,b)=>b.command_ms-a.command_ms);assert.equal(report.stderr.length,0);assert.equal(report.stderr_overflow,0);assert.equal(report.aborts.length,0);unchanged(pins);report.ok=true;
 }catch(error){report.error=String(error.stack??error);process.exitCode=1;}
 finally{try{if(core){core.close();report.closed=true;}else if(module){assert.equal(module._unone_web_unload_project(),0);report.closed=true;}}catch(error){report.cleanup_error=String(error);report.ok=false;process.exitCode=1;}try{unchanged(pins);}catch(error){report.pin_error=String(error);report.ok=false;process.exitCode=1;}fs.writeFileSync(path.join(target,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,mode:config.mode,command:report.command??null,vm:report.vm_metrics??null,samples:report.profile?.window?.samples??null,error:report.error??null}));}
}

async function main(){
 const stringKeys=['runtime','pins','payload','input-sequence','expected-payload','expected-inputs','out','warmup','frames','seed','timeout-ms','data-dir'];
 const {values}=parseArgs({options:Object.fromEntries(stringKeys.map(key=>[key,{type:'string'}]).concat([['help',{type:'boolean'}]]))});if(values.help){console.log(help);return;}
 for(const key of ['runtime','pins','payload','input-sequence','out'])assert(values[key],`Missing --${key}\n${help}`);
 const runtime=fs.realpathSync(values.runtime),out=admitOutput(values.out,runtime),runtimePins=json(values.pins),preflightPins=[],artifact=admit(runtime,runtimePins,preflightPins);
 const payload=fs.realpathSync(values.payload),sequence=fs.realpathSync(values['input-sequence']),payloadHash=requireHash(values['expected-payload']??'414f0d19952acc34e0d9ecab392844974fd20a7c0c5a42799ebac4774115480a','payload'),sequenceHash=requireHash(values['expected-inputs']??'0b10d68aaefb6806198b8f38bc13de01256c190981a9d350070f1f3b417b871c','input-sequence');
 assert(fs.statSync(payload).size<=64*1024*1024&&fs.statSync(sequence).size<=8*1024*1024);pinned(payload,payloadHash,preflightPins,'payload');pinned(sequence,sequenceHash,preflightPins,'input_sequence');
 const options={warmup:integer(values.warmup??66,'warmup',0,1000),frames:integer(values.frames??300,'frames',1,1024),seed:values.seed??'42',timeoutMs:integer(values['timeout-ms']??180000,'timeout-ms',1000,600000)};assert(/^(0|[1-9][0-9]{0,19})$/.test(options.seed)&&BigInt(options.seed)<=18446744073709551615n);
 const host=hostSources(),scriptHash=sha(fs.readFileSync(self)),dataDir=fs.realpathSync(values['data-dir']??path.dirname(payload));fs.mkdirSync(out);fs.copyFileSync(self,path.join(out,'harness.mjs'));
 const report={version:1,ok:false,scope:'Current acec Game fixtures: same actual opt2 sampler across three fresh VMs, actual setup/phase validation, collect:false heap reads every60 measured ticks outside command timing. Not production/browser FPS, JS GC, collection-cycle frequency or global leak evidence.',runtime_pins:runtimePins,metadata:artifact.metadata,options,input_pins:preflightPins.filter(pin=>['payload','input_sequence'].includes(pin.label)),host,order:modes,runs:[],limits:[
  'OFF is the same sampling-capable artifact with profiling window inactive; it is not an ordinary production artifact. Raw OFF zero counters are unavailable observations, not zero allocation or GC.',
  'Probes/sampling active VM counters cover Luau update including engine callbacks. Positive allocator growth is cumulative requests, not live heap, frees, Rust allocation or JavaScript allocation.',
  'Incremental GC interrupt timing includes instrumentation/host scheduling overhead and excludes full collections. Per-frame overlap does not establish all GC causes or OS pause time.',
  'Function counts are biased safe-point samples, not exact function milliseconds or call counts. Opt2 inlining, short functions and native bindings are not fully attributed; preserve dropped/truncated/sample metadata.',
  'Three fixed-order runs do not establish causal performance improvement. Concurrent chats/machine work may overlap; no exclusive-window/FPS claim.',
  'Only digest strings and frame scalars are checked after each timed command; full final World/UI/save encoding and profile report happen after timing.',
  'Public phase history records natural battle termination; never force activity, restart, heal or synthesize GPU receipts. All memory_sample calls explicitly use collect:false; raw used heap is not a post-GC retained baseline. Periodic heap diagnostic calls occur outside command timing and can affect the following workload. WASM linear-memory capacity is not live memory, allocation growth, GC frequency or leak proof. No forced collection, replacement API, renderer or Native executable is used.',
 ]};
 try{
  let reference;
  for(const [index,mode]of modes.entries()){
   const config={...options,runtime,runtimePins,payload,sequence,payloadHash,sequenceHash,dataDir,host,scriptHash,mode},configFile=path.join(out,index+'-input.json'),childOut=path.join(out,index+'-'+mode);fs.writeFileSync(configFile,JSON.stringify(config,null,2));const args=[self,'--worker',configFile,childOut],r=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:options.timeoutMs,maxBuffer:4*1024*1024});
   fs.writeFileSync(path.join(out,index+'-command.json'),JSON.stringify({executable:process.execPath,args,cwd:root},null,2));fs.writeFileSync(path.join(out,index+'-stdout.log'),r.stdout??'');fs.writeFileSync(path.join(out,index+'-stderr.log'),r.stderr??'');assert.equal(r.status,0,r.stderr||r.stdout||String(r.error));const result=json(path.join(childOut,'result.json'),32*1024*1024);assert(result.ok&&result.closed);
   if(reference){assert.deepEqual(result.digests,reference.digests,'Every Core digest must match across modes');assert.equal(result.final_world,reference.final_world,'Full final World differs');assert.equal(result.final_save,reference.final_save,'Final save differs');assert.deepEqual(result.final,reference.final);}else reference=result;
   const {rows,digests,final_world,final_save,profile,...summary}=result;report.runs.push({index,...summary,raw_report:path.join(childOut,'result.json'),function_metadata:{samples:profile.window.samples,dropped_samples:profile.window.dropped_samples,truncated_stacks:profile.window.truncated_stacks,limits:profile.window.limits,semantics:profile.window.semantics}});unchanged(host);unchanged(preflightPins);console.log(r.stdout.trim());fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');
  }
  report.parity='Every load/warmup/measured Core digest and full final World/UI/save exact across all three fresh VMs';report.ok=true;
 }catch(error){report.error=String(error.stack??error);process.exitCode=1;}
 finally{fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,out,runs:report.runs.length,error:report.error??null}));}
}
if(process.argv[2]==='--worker')await worker(process.argv[3],process.argv[4]);else await main();
