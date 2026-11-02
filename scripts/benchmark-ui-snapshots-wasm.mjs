// Actual emitted production Core benchmark. The fixture uses the bundled UI
// package and real setRoot; no replacement Lua API or renderer is installed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {instantiateEmittedRuntime,within} from './immutable-bytes-emitted-runtime.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),self=fileURLToPath(import.meta.url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const valueHash=value=>value===undefined?null:sha(JSON.stringify(stable(value)));
const digestPattern=/^sha256:[a-f0-9]{64}$/;
const usage=`node scripts/benchmark-ui-snapshots-wasm.mjs --before <runtime-dir> --before-pins <JSON> --after <runtime-dir> --after-pins <JSON> --out <fresh-directory>
Pins JSON requires {manifest,source,javascript,wasm} (SHA256 except source=40hex commit).
[--sizes 0,256,2048,8192] [--modes static,changing] [--ticks 120] [--warmup 30] [--rounds 1]
[--diagnostic-ticks 30] [--timeout-ms 120000] [--functional-only]
Primary: fresh process/VM per variant in ABBA+reverse order, host profiling OFF.
Secondary: existing host profiling for unsplit tick ABI/restore, never isolated clone.
--functional-only permits one identical artifact pair and makes NO A/B improvement claim.
No Native executable, build, browser, forced GC, substituted API or fake host receipt.`;
const number=(value,label,min,max)=>{assert(/^(0|[1-9][0-9]*)$/.test(value),`Invalid ${label}`);const n=Number(value);assert(Number.isSafeInteger(n)&&n>=min&&n<=max,`Invalid ${label}`);return n;};
const sameList=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
function pin(file,expected){const bytes=fs.readFileSync(file);assert.equal(sha(bytes),expected,`Pin mismatch: ${file}`);return bytes;}
function pinFile(file){const bytes=fs.readFileSync(file);return {path:file,bytes:bytes.length,sha256:sha(bytes)};}
function json(file,limit=1024*1024){const stat=fs.statSync(file);assert(stat.isFile()&&stat.size<=limit,'JSON byte bound exceeded');const bytes=fs.readFileSync(file);assert(bytes.length<=limit,'JSON byte bound exceeded');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
function stats(values){if(!values.length)return null;assert(values.every(value=>Number.isFinite(value)&&value>=0),'Invalid timing sample');const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,total_ms:values.reduce((a,b)=>a+b,0),median_ms:sorted[Math.floor(sorted.length/2)],p95_ms:sorted[Math.ceil(sorted.length*.95)-1],max_ms:sorted.at(-1)};}
export function settings(values){
 const sizes=(values.sizes??'0,256,2048,8192').split(',').map(value=>number(value,'size',0,8192)),modes=(values.modes??'static,changing').split(',');
 assert(sizes.length<=4&&new Set(sizes).size===sizes.length&&sizes.every(n=>[0,256,2048,8192].includes(n)),'Unsupported/duplicate sizes');
 assert(modes.length&&new Set(modes).size===modes.length&&modes.every(mode=>['static','changing'].includes(mode)),'Unsupported/duplicate modes');
 return {sizes,modes,ticks:number(values.ticks??'120','ticks',1,2000),warmup:number(values.warmup??'30','warmup',0,1000),rounds:number(values.rounds??'1','rounds',1,3),diagnosticTicks:number(values['diagnostic-ticks']??'30','diagnostic-ticks',0,2000),timeoutMs:number(values['timeout-ms']??'120000','timeout-ms',1000,600000),functionalOnly:values['functional-only']===true};
}
export function validatePair(before,after,functionalOnly=false){
 for(const metadata of [before,after]){
  assert.equal(metadata.source_dirty,false);assert.equal(metadata.profile,'release');assert.equal(metadata.bytecode_optimization_level,2);
  for(const key of ['dev_tools','preview_tools','phase_profile','sampling_profile'])assert.equal(metadata[key],false,`Production required: ${key}`);
  assert.equal(metadata.runtime_packages?.['@unone/ui'],'0.6.0','Exact UI0.6 required');
 }
 assert(sameList(before.compiled_systems,after.compiled_systems),'Compiled systems differ');assert(sameList(before.cargo_features,after.cargo_features),'Cargo feature sets differ');
 assert.deepEqual(before.runtime_packages,after.runtime_packages,'Runtime package contracts differ');
 assert(before.compiled_systems.includes('ui'),'UI must be compiled');
 if(!functionalOnly){assert.notEqual(before.source_commit,after.source_commit,'Different pinned sources required for A/B');assert.notEqual(before.wasm_sha256,after.wasm_sha256,'One artifact cannot establish improvement');}
}
export function scheduleVariants(functionalOnly=false){return functionalOnly?['before','after']:['before','after','after','before','after','before','before','after'];}
function admitRuntime(directory,pins){
 const selected=fs.realpathSync(directory);assert(pins&&Object.keys(pins).length===4&&['manifest','source','javascript','wasm'].every(key=>Object.hasOwn(pins,key)),'Exact runtime pins required');
 for(const key of ['manifest','javascript','wasm'])assert(/^[a-f0-9]{64}$/.test(pins[key]),`Invalid ${key} pin`);assert(/^[a-f0-9]{40}$/.test(pins.source),'Invalid source pin');
 const metadata=JSON.parse(pin(path.join(selected,'runtime.json'),pins.manifest));assert.equal(metadata.source_commit,pins.source);
 function file(name){assert(typeof name==='string'&&name&&!path.isAbsolute(name));const value=fs.realpathSync(path.resolve(selected,name));assert(within(selected,value),'Runtime file escapes artifact');return value;}
 const javascriptFile=file(metadata.javascript),wasmFile=file(metadata.wasm),javascript=pin(javascriptFile,pins.javascript),wasm=pin(wasmFile,pins.wasm);
 assert.equal(metadata.javascript_sha256,pins.javascript);assert.equal(metadata.wasm_sha256,pins.wasm);assert.equal(metadata.wasm_bytes,wasm.length);
 const exports=new Set(WebAssembly.Module.exports(new WebAssembly.Module(wasm)).map(value=>value.name));
 for(const key of ['alloc','load_project','unload_project','set_input_frame','set_viewport_size','set_instance_transport','set_ui_transport','tick','observation_ptr','observation_len'])assert(exports.has('unone_web_'+key),`Missing actual ABI: ${key}`);
 assert(!exports.has('unone_web_developer_request'),'Production must not contain developer ABI');
 return {directory:selected,pins,metadata,javascriptFile,javascript,wasmFile,wasm};
}
function hostGraph(entry){
 const pending=[entry],seen=new Set(),files=[];
 while(pending.length){const file=fs.realpathSync(pending.pop());if(seen.has(file))continue;seen.add(file);assert(seen.size<=128&&within(path.join(root,'web'),file));const bytes=fs.readFileSync(file);files.push({path:file,bytes:bytes.length,sha256:sha(bytes)});
  for(const match of bytes.toString('utf8').matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?['"](\.[^'"]+)['"]/g))pending.push(path.resolve(path.dirname(file),match[1]));
 }return files.sort((a,b)=>a.path.localeCompare(b.path));
}
function recheck(files){for(const file of files){const bytes=fs.readFileSync(file.path);assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256,`Source/input changed: ${file.path}`);}}
export function fixtureSource(size,mode){
 assert([0,256,2048,8192].includes(size)&&['static','changing'].includes(mode));
 return `local Game={};local kit;local batch;local root;local turn=0
local function screen(text)
 local children={}
 if batch then children[#children+1]=batch end
 children[#children+1]=kit.text({id='counter',rect={x=0,y=95,width=100,height=5},text=text})
 return kit.screen({id='bench',node='bench',budget={max_nodes=16384},children=children})
end
function Game.start(api)
 kit=api.ui.components.create()
 local quads={};local count=${size};local rows=math.max(1,math.ceil(count/128))
 for i=1,count do local col=(i-1)%128;local row=math.floor((i-1)/128)
  quads[i]={asset='texture://snapshot-bench',rect={x=col*(100/128),y=row*(90/rows),width=100/128,height=90/rows}}
 end
 if count>0 then batch=kit.imageBatch({id='art',rect={x=0,y=0,width=100,height=90},quads=quads}) end
 root=screen('0');api.ui.setRoot(root)
end
function Game.update(api)
 ${mode==='changing'?"turn+=1;root=screen(tostring(turn%2));api.ui.setRoot(root)":"-- Retained start-built tree; no per-tick kit, conversion or setRoot call."}
end
return Game`;
}
function payloadFor(size,mode){return {config:{name:'UI snapshot benchmark',entry_script:'main.luau',runtime_packages:{'@unone/ui':'0.6.0'},systems:{ui:true,physics2d:false,physics3d:false,camera2d:false,camera3d:false,random:false,save:false,audio:false,spine:false,particle:false,effekseer:false,jobs:false}},script:fixtureSource(size,mode),scene:null,viewport_size:[1600,900],viewport_aspect:16/9,asset_catalog:[{id:'texture://snapshot-bench',kind:'texture2d'}]};}
function counts(tree){let logical=0,quads=0;const pending=[...(tree?.children??[])];while(pending.length){const node=pending.pop();logical++;if(node.kind==='image_batch'){quads+=node.quads?.length??0;logical+=node.quads?.length??0;}for(const child of node.children??[])pending.push(child);}return {logical_nodes:logical,image_quads:quads};}

async function child(configFile,out){
 const config=json(configFile),selected=admitRuntime(config.runtime.directory,config.runtime.pins),report={ok:false,variant:config.variant,size:config.size,mode:config.mode,profile:config.profile,environment:{node:process.version,platform:process.platform,arch:process.arch,clock:'performance.now'},stderr:[],stderr_overflow:0,aborts:[]};let core,module;
 assert(!fs.existsSync(out));fs.mkdirSync(out);
 try{
  recheck(config.host);const {createRuntimeCore}=await import(pathToFileURL(path.join(root,'web/shared/runtime-core.mjs'))),{uiTreeGeneration}=await import(pathToFileURL(path.join(root,'web/shared/ui-tree-publication.mjs')));recheck(config.host);
  module=await instantiateEmittedRuntime({...selected,timeoutMs:30000,diagnostics:report});core=createRuntimeCore(module,{profile:config.profile});
  const payload=payloadFor(config.size,config.mode);report.fixture_sha256=sha(payload.script);report.payload_sha256=valueHash(payload);report.host_pins=config.host;
  let snapshot=await core.execute({kind:'load',payload,seed:'42'});assert.equal(snapshot.world.frame,0);assert.equal(snapshot.world.ui.children.at(-1).text,'0');const digests=[];
  const recordDigest=()=>{const digest=snapshot.observation_digest;assert(typeof digest==='string'&&digestPattern.test(digest),'Actual Core digest missing');digests.push(digest);};recordDigest();
  const initialGeneration=uiTreeGeneration(snapshot.world.ui);assert(initialGeneration,'Official UI publication grant missing');
  report.initial_counts=counts(snapshot.world.ui);assert.equal(report.initial_counts.image_quads,config.size);assert.equal(report.initial_counts.logical_nodes,config.size?config.size+2:1);
  for(let i=0;i<config.warmup;i++){snapshot=await core.execute({kind:'tick',input:{}});recordDigest();}
  const samples=[],abi=[],stages={};let previous=uiTreeGeneration(snapshot.world.ui),preserved=0,changed=0;
  report.capacity_before_bytes=module.HEAPU8.buffer.byteLength;
  for(let tick=0;tick<config.ticks;tick++){
   const start=performance.now();snapshot=await core.execute({kind:'tick',input:{}});const end=performance.now();samples.push(end-start);recordDigest();
   const generation=uiTreeGeneration(snapshot.world.ui);assert(generation);if(generation===previous)preserved++;else changed++;previous=generation;
   if(config.profile){let at=core.trace().start_ms;for(const [name,time]of core.trace().marks){const duration=time-at;if(name==='tick_abi_atomic')abi.push(duration);if(['ui_tree_restore','world_fields_restore'].includes(name))(stages[name]??=[]).push(duration);at=time;}}
  }
  if(config.mode==='static'){assert.equal(previous,initialGeneration);assert.equal(preserved,config.ticks);assert.equal(changed,0);}else{assert.equal(changed,config.ticks);}
  report.final_counts=counts(snapshot.world.ui);assert.deepEqual(report.final_counts,report.initial_counts);assert(Object.isFrozen(snapshot.world.ui));
  assert.equal(snapshot.world.frame,config.warmup+config.ticks);assert.equal(snapshot.world.ui.children.at(-1).text,config.mode==='static'?'0':String((config.warmup+config.ticks)%2));
  if(config.profile){assert.equal(abi.length,config.ticks,'Host tick ABI mark missing');for(const name of ['ui_tree_restore','world_fields_restore'])assert.equal(stages[name]?.length,config.ticks,`Host restore mark missing: ${name}`);}
  report.capacity_after_bytes=module.HEAPU8.buffer.byteLength;report.ui_generations={preserved,changed};report.command=stats(samples);report.command_samples_ms=samples;report.tick_abi_atomic=config.profile?stats(abi):null;report.restore=Object.fromEntries(Object.entries(stages).map(([key,values])=>[key,stats(values)]));
  report.digests=digests;report.digest_checkpoints=digests.length;assert.equal(digests.length,1+config.warmup+config.ticks);
  report.final={frame:snapshot.world.frame,core_digest:snapshot.observation_digest,world_sha256:valueHash(snapshot.world),ui_sha256:valueHash(snapshot.world.ui),save_sha256:valueHash(snapshot.save_payload)};
  report.final_world_canonical=JSON.stringify(stable(snapshot.world));report.final_save_canonical=snapshot.save_payload===undefined?null:JSON.stringify(stable(snapshot.save_payload));
  recheck(config.host);pin(path.join(selected.directory,'runtime.json'),selected.pins.manifest);pin(selected.javascriptFile,selected.pins.javascript);pin(selected.wasmFile,selected.pins.wasm);assert.equal(report.aborts.length,0);assert.equal(report.stderr.length,0);report.ok=true;
 }catch(error){report.error=String(error.stack??error);process.exitCode=1;}
 finally{try{closeRuntime(core,module,report);}catch(error){report.cleanup_error=String(error);report.ok=false;process.exitCode=1;}fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,variant:report.variant,size:report.size,mode:report.mode,error:report.error??null}));}
}
export function closeRuntime(core,module,report){
 if(core){core.close();report.closed=true;report.cleanup_via='runtime-core.close';}
 else if(module){assert.equal(typeof module._unone_web_unload_project,'function');assert.equal(module._unone_web_unload_project(),0,'Emitted unload failed');report.closed=true;report.cleanup_via='emitted-unload-after-core-construction-failure';}
 else{report.closed=false;report.cleanup_via='not-initialized';}
}
export function compareRuns(run,reference){assert.deepEqual(run.digests,reference.digests,'Every Core digest must match');assert.equal(run.final_world_canonical,reference.final_world_canonical,'Full final World differs');assert.equal(run.final_save_canonical,reference.final_save_canonical,'Final save differs');assert.deepEqual(run.final,reference.final,'Final UI/World/digest hashes differ');assert.deepEqual(run.final_counts,reference.final_counts);}

export async function main(args=process.argv.slice(2)){
 const keys=['before','after','before-pins','after-pins','out','sizes','modes','ticks','warmup','rounds','diagnostic-ticks','timeout-ms'];
 const {values}=parseArgs({args,options:Object.fromEntries(keys.map(key=>[key,{type:'string'}]).concat([['help',{type:'boolean'}],['functional-only',{type:'boolean'}]]))});if(values.help){console.log(usage);return;}
 for(const key of ['before','after','before-pins','after-pins','out'])assert(values[key],`Missing --${key}\n${usage}`);const options=settings(values),beforeDir=fs.realpathSync(values.before),afterDir=fs.realpathSync(values.after),requested=path.resolve(values.out);
 assert(!fs.existsSync(requested),'Refuse overwrite');const out=path.join(fs.realpathSync(path.dirname(requested)),path.basename(requested));for(const directory of [beforeDir,afterDir])assert(!within(directory,out),'Output must be outside immutable runtimes');
 const before=admitRuntime(beforeDir,json(values['before-pins'])),after=admitRuntime(afterDir,json(values['after-pins']));validatePair(before.metadata,after.metadata,options.functionalOnly);
 const host=hostGraph(path.join(root,'web/shared/runtime-core.mjs'));host.push(pinFile(path.join(root,'scripts/immutable-bytes-emitted-runtime.mjs')),pinFile(self));
 const report={version:1,ok:false,options,performance_comparison:!options.functionalOnly,before:{pins:before.pins,metadata:before.metadata},after:{pins:after.pins,metadata:after.metadata},host,runs:[],fixtures:[],scope:'Actual production WASM +bundled UI0.6, fresh child process/VM. No renderer/GPU/FPS/isolated-clone claim.',limits:['Primary host profiler is disabled; secondary tick_abi_atomic includes update, observe/capture, canonical serialization and publication.','Only matching actual phase-profile runtimes can expose ui_clone_ms; no such per-clone timing is fabricated here.','WASM linear memory capacity is not live memory, allocator growth, Luau allocation or GC frequency. No forced GC.','Hashing full final state occurs after timing. Static fixture does not setRoot/update UI during measured ticks. Changing fixture includes actual UI kit/conversion/validation.','Other chats/system activity may be concurrent; ABBA+reverse does not create an exclusive-machine benchmark.']};
 fs.mkdirSync(out);fs.writeFileSync(path.join(out,'benchmark-script.mjs'),fs.readFileSync(self));
 try{
  const references=new Map();let serial=0;
  for(const size of options.sizes)for(const mode of options.modes){
   const fixture=fixtureSource(size,mode);report.fixtures.push({size,mode,sha256:sha(fixture)});fs.writeFileSync(path.join(out,`fixture-${size}-${mode}.luau`),fixture);
   const schedules=[];for(let round=0;round<options.rounds;round++)for(const variant of scheduleVariants(options.functionalOnly))schedules.push({variant,round,profile:false,ticks:options.ticks});
   if(options.diagnosticTicks)for(const variant of ['before','after'])schedules.push({variant,round:null,profile:true,ticks:options.diagnosticTicks});
   for(const schedule of schedules){
    const name=String(serial++).padStart(3,'0'),config={...schedule,size,mode,warmup:options.warmup,host,runtime:{directory:schedule.variant==='before'?beforeDir:afterDir,pins:schedule.variant==='before'?before.pins:after.pins}},configFile=path.join(out,name+'-input.json'),childOut=path.join(out,name+'-run');fs.writeFileSync(configFile,JSON.stringify(config));
    const argv=[self,'--worker',configFile,childOut],result=spawnSync(process.execPath,argv,{cwd:root,encoding:'utf8',timeout:options.timeoutMs,maxBuffer:4*1024*1024});fs.writeFileSync(path.join(out,name+'-stdout.log'),result.stdout??'');fs.writeFileSync(path.join(out,name+'-stderr.log'),result.stderr??'');
    assert.equal(result.status,0,`Child failed ${name}: ${result.stderr||result.stdout||result.error}`);const run=json(path.join(childOut,'result.json'),32*1024*1024);assert(run.ok&&run.closed);const key=`${size}/${mode}/${schedule.profile}`;
    if(references.has(key))compareRuns(run,references.get(key));else references.set(key,run);
    const {digests,command_samples_ms,final_world_canonical,final_save_canonical,...summary}=run;report.runs.push({name,...summary});recheck(host);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');
   }
  }
  report.comparisons=options.sizes.flatMap(size=>options.modes.map(mode=>{
   const variants=Object.fromEntries(['before','after'].map(variant=>{const runs=report.runs.filter(run=>run.size===size&&run.mode===mode&&!run.profile&&run.variant===variant);return [variant,{runs:runs.length,command_run_medians:stats(runs.map(run=>run.command.median_ms)),command_run_p95s:stats(runs.map(run=>run.command.p95_ms)),measured_ticks:runs.reduce((n,run)=>n+run.command.samples,0)}];}));
   const before=variants.before.command_run_medians.median_ms,after=variants.after.command_run_medians.median_ms;
   return {size,mode,...variants,run_median_delta_ms:after-before,run_median_delta_percent:before?(after/before-1)*100:null,interpretation:options.functionalOnly?'Same-artifact functional diagnostic only; no A/B improvement claim.':'Descriptive full-command timings, no isolated-clone/FPS conclusion or timing pass gate.'};
  }));
  report.parity='Every matched run: load +warmup +measured Core digests and full final World/UI/save exact';report.ok=true;
 }catch(error){report.error=String(error.stack??error);process.exitCode=1;}
 finally{fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,out,runs:report.runs.length,performance_comparison:report.performance_comparison,error:report.error??null}));}
}
if(process.argv[1]&&path.resolve(process.argv[1])===self){if(process.argv[2]==='--worker')await child(process.argv[3],process.argv[4]);else await main();}
