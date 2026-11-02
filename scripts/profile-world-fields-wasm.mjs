// Actual emitted production WASM + current official host reader. Diagnostic
// clocks/row analysis are opt-in; this is not a renderer or FPS acceptance gate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {instantiateEmittedRuntime,within} from './immutable-bytes-emitted-runtime.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const valueHash=value=>value===undefined?null:sha(JSON.stringify(stable(value)));
const utf8=new TextDecoder('utf-8',{fatal:true});
const usage=`node scripts/profile-world-fields-wasm.mjs --runtime <directory|runtime.json> --payload <project.json> --input-sequence <InputFrame[].json> --out <fresh-directory>
  [--data-dir <content-directory>] [--frames <1..10000>] [--warmup <initial ticks to exclude from summaries>]
  [--seed <u64, default42>] [--expected-runtime <sha256>] [--expected-wasm <sha256>]
  [--expected-javascript <sha256>] [--expected-source <commit>]
The sequence is unmodified; --frames pads its tail with empty input frames.
The first --warmup ticks are still recorded, then excluded from summaries.
Data sources include declared binary assets and exported precompiled scripts.
No GPU/image decode, host-ready injection, forced GC or Core developer profiler.`;

function integer(value,label,min,max){assert(/^(0|[1-9][0-9]*)$/.test(value??''),`Invalid ${label}`);const number=Number(value);assert(Number.isSafeInteger(number)&&number>=min&&number<=max,`Invalid ${label}`);return number;}
function plain(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function readPinnedJSON(file,limit,pin,label,expected){const stat=fs.statSync(file);assert(stat.isFile()&&stat.size<=limit,`JSON input exceeds bound: ${file}`);const bytes=pin(file,label,expected);assert(bytes.length<=limit,`JSON input exceeds bound: ${file}`);return JSON.parse(utf8.decode(bytes));}
function distribution(values){if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return {samples:sorted.length,total_ms:values.reduce((a,b)=>a+b,0),median_ms:sorted[Math.floor(sorted.length/2)],p95_ms:sorted[Math.ceil(sorted.length*.95)-1],max_ms:sorted.at(-1)};}
function cardinality(value){
 if(value===null||typeof value!=='object')return {kind:typeof value,entries:null,container_children:0};
 let count=0,containers=0;for(const key in value)if(Object.hasOwn(value,key)){count++;if(value[key]!==null&&typeof value[key]==='object')containers++;}
 return {kind:Array.isArray(value)?'array':'object',entries:count,container_children:containers};
}
function hostSources(start){
 const pending=[start],seen=new Set(),files=[];
 while(pending.length){const file=fs.realpathSync(pending.pop());if(seen.has(file))continue;seen.add(file);assert(seen.size<=128&&within(path.join(repo,'web'),file),'Host dependency escapes web source');
  const bytes=fs.readFileSync(file);files.push({path:file,bytes:bytes.length,sha256:sha(bytes)});
  const imports=bytes.toString('utf8').matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?['"](\.[^'"]+)['"]/g);
  for(const match of imports)pending.push(path.resolve(path.dirname(file),match[1]));
 }
 return files.sort((a,b)=>a.path.localeCompare(b.path));
}
function unchanged(pins){for(const pin of pins){const bytes=fs.readFileSync(pin.path);assert.equal(bytes.length,pin.bytes,`Input changed: ${pin.path}`);assert.equal(sha(bytes),pin.sha256,`Input changed: ${pin.path}`);}}
function admitOutput(out,runtime){
 assert(!fs.existsSync(out),'Refuse to overwrite diagnostic evidence');
 const parent=fs.realpathSync(path.dirname(out));const resolved=path.join(parent,path.basename(out));
 assert(!within(runtime,resolved),'Diagnostic output must be outside the immutable runtime');return resolved;
}
function runtimeFiles(directory,values,pin){
 const manifest=path.join(directory,'runtime.json'),metadata=readPinnedJSON(manifest,1024*1024,pin,'runtime_manifest',values['expected-runtime']);
 assert.equal(metadata.source_dirty,false,'Use a clean production runtime');assert.equal(metadata.profile,'release');assert.equal(metadata.bytecode_optimization_level,2);
 for(const key of ['dev_tools','preview_tools','phase_profile','sampling_profile'])assert.equal(metadata[key],false,`Production runtime required: ${key}`);
 if(values['expected-source'])assert.equal(metadata.source_commit,values['expected-source']);
 const resolve=name=>{assert(typeof name==='string'&&name&&!path.isAbsolute(name),'Invalid runtime filename');const file=fs.realpathSync(path.resolve(directory,name));assert(within(directory,file),'Runtime filename escapes artifact');return file;};
 const javascriptFile=resolve(metadata.javascript),wasmFile=resolve(metadata.wasm);
 const javascript=pin(javascriptFile,'runtime_javascript',values['expected-javascript']??metadata.javascript_sha256);
 const wasm=pin(wasmFile,'runtime_wasm',values['expected-wasm']??metadata.wasm_sha256);
 assert.equal(sha(javascript),metadata.javascript_sha256);assert.equal(sha(wasm),metadata.wasm_sha256);assert.equal(wasm.length,metadata.wasm_bytes);
 const exports=new Set(WebAssembly.Module.exports(new WebAssembly.Module(wasm)).map(value=>value.name));
 for(const name of ['alloc','load_project','unload_project','set_input_frame','tick','observation_ptr','observation_len'])assert(exports.has('unone_web_'+name),`Missing actual WASM ABI: ${name}`);
 assert(!exports.has('unone_web_developer_request'),'Core developer profiler must be absent');
 return {metadata,javascriptFile,javascript,wasm};
}
function dataAssets(payload,directory,payloadDataSources,pin){
 const sources=payloadDataSources(payload);assert(Array.isArray(sources)&&sources.length<=4096,'Too many data sources');
 const root=fs.realpathSync(directory),seen=new Set();let total=0;
 return sources.map(({id,source})=>{
  assert(typeof id==='string'&&id&&!seen.has(id),'Invalid/duplicate data id');seen.add(id);
  assert(typeof source==='string'&&source&&!path.isAbsolute(source)&&!/[\\:]/.test(source)&&source.split('/').every(part=>part&&part!=='.'&&part!=='..'),'Data source must be content-relative');
  const file=fs.realpathSync(path.resolve(root,source));assert(within(root,file),'Data source escapes content directory');
  const size=fs.statSync(file).size;total+=size;assert(size<=256*1024*1024&&total<=1024*1024*1024,'Diagnostic data byte bound exceeded');
  return {id,bytes:new Uint8Array(pin(file,'data:'+id))};
 });
}
function rowFor(snapshot,trace,start,end,index,warmup){
 assert(trace&&Array.isArray(trace.marks),'Official host profiling trace missing');
 const spans=[];let previous=trace.start_ms;
 for(const [name,at]of trace.marks){assert(Number.isFinite(at)&&at>=previous,'Non-monotonic host mark');spans.push({name,ms:at-previous});previous=at;}
 assert(end>=previous);spans.push({name:'after_last_mark',ms:end-previous});
 const phases=Object.fromEntries(spans.map(span=>[span.name,span.ms]));
 const fields=(trace.world_field_publications??[]).map(publication=>{
  const prefix='world_field/'+publication.field+'/';
  return {...publication,structure:cardinality(snapshot.world?.[publication.field]),
   phases:Object.fromEntries(spans.filter(span=>span.name.startsWith(prefix)).map(span=>[span.name.slice(prefix.length),span.ms]))};
 });
 return {index,frame:snapshot.world?.frame,warmup:index<warmup,command_ms:end-start,observation_bytes:trace.observation_bytes??null,fields,phases};
}
function summarize(rows){
 const measured=rows.filter(row=>!row.warmup),fields=new Map();
 for(const row of measured)for(const field of row.fields){let item=fields.get(field.field);if(!item){item={changed:0,reused:0,changed_bytes:0,max_bytes:0,max_entries:0,stages:{utf8:[],parse:[],freeze:[],reuse:[],descriptor:[]}};fields.set(field.field,item);}
  item[field.changed?'changed':'reused']++;if(field.changed)item.changed_bytes+=field.bytes;item.max_bytes=Math.max(item.max_bytes,field.bytes);item.max_entries=Math.max(item.max_entries,field.structure.entries??0);
  for(const [stage,ms]of Object.entries(field.phases))item.stages[stage]?.push(ms);
 }
 return {measured_frames:measured.length,command:distribution(measured.map(row=>row.command_ms)),fields:Object.fromEntries([...fields].map(([key,value])=>[key,{...value,stages:Object.fromEntries(Object.entries(value.stages).map(([name,samples])=>[name,distribution(samples)]))}]))};
}

export async function main(args=process.argv.slice(2)){
 const {values}=parseArgs({args,options:Object.fromEntries(['runtime','payload','input-sequence','out','data-dir','frames','warmup','seed','expected-runtime','expected-wasm','expected-javascript','expected-source'].map(key=>[key,{type:'string'}]).concat([['help',{type:'boolean'}]]))});
 if(values.help){console.log(usage);return;}
 for(const key of ['runtime','payload','input-sequence','out'])assert(values[key],`Missing --${key}\n${usage}`);
 const selected=fs.realpathSync(values.runtime),runtime=fs.statSync(selected).isDirectory()?selected:path.dirname(selected);
 if(fs.statSync(selected).isFile())assert.equal(path.basename(selected),'runtime.json');
 const out=admitOutput(path.resolve(values.out),runtime),pins=[];
 const pin=(file,label,expected)=>{const bytes=fs.readFileSync(file),digest=sha(bytes);if(expected)assert.equal(digest,expected,label);pins.push({label,path:file,bytes:bytes.length,sha256:digest});return bytes;};
 const report={version:1,ok:false,scope:'Actual production WASM with current official host profiling enabled; Node wall diagnostics, no renderer/GPU/FPS or GC/leak claim.',pins,stderr:[],stderr_overflow:0,aborts:[],rows:[],limitations:[
  'Consecutive marks are host-clock spans, not independent CPU measurements. Descriptor/reuse includes preceding loop work.',
  'Field cardinality/report construction happens after each measured command and can perturb later GC; profile-disabled acceptance is separate.',
  'No presentation readiness is fabricated; only the supplied input sequence can provide host receipts.',
  'The load phase is timed but lacks per-field marks; warmup is recorded and excluded from summaries.']};
 let core,module,created=false;
 try{
  const scriptBytes=pin(fileURLToPath(import.meta.url),'verification_script');pin(path.join(repo,'scripts/immutable-bytes-emitted-runtime.mjs'),'emitted_loader');
  const artifact=runtimeFiles(runtime,values,pin);report.runtime=artifact.metadata;
  const payloadFile=fs.realpathSync(values.payload),sequenceFile=fs.realpathSync(values['input-sequence']);
  const payload=readPinnedJSON(payloadFile,64*1024*1024,pin,'payload'),sequence=readPinnedJSON(sequenceFile,8*1024*1024,pin,'input_sequence');
  assert(plain(payload)&&plain(payload.config),'Project payload required');assert(Array.isArray(sequence)&&sequence.length<=10000&&sequence.every(plain),'InputFrame[] required');
  const frames=values.frames?integer(values.frames,'frames',1,10000):sequence.length;assert(frames>=1,'At least one tick required');
  const warmup=integer(values.warmup??'0','warmup',0,frames-1),seed=values.seed??'42';assert(/^(0|[1-9][0-9]{0,19})$/.test(seed)&&BigInt(seed)<=18446744073709551615n,'Invalid seed');
  const host=hostSources(path.join(repo,'web/shared/runtime-core.mjs'));pins.push(...host.map(value=>({label:'host_source',...value})));
  const {createRuntimeCore}=await import(pathToFileURL(path.join(repo,'web/shared/runtime-core.mjs')));
  const {payloadDataSources,worldFieldPublication}=await import(pathToFileURL(path.join(repo,'web/shared/load-project.js'))).then(async loader=>({...loader,...await import(pathToFileURL(path.join(repo,'web/shared/world-field-publication.mjs')))}));
  unchanged(pins);const data=dataAssets(payload,values['data-dir']??path.dirname(payloadFile),payloadDataSources,pin);
  report.options={frames,warmup,seed,data_sources:data.length,data_dir:fs.realpathSync(values['data-dir']??path.dirname(payloadFile))};
  fs.mkdirSync(out);created=true;fs.writeFileSync(path.join(out,'verification-script.mjs'),scriptBytes);
  module=await instantiateEmittedRuntime({...artifact,timeoutMs:30000,diagnostics:report});
  core=createRuntimeCore(module,{url:pathToFileURL(artifact.javascriptFile).href,profile:true});
  const started=performance.now();let initial=await core.execute({kind:'load',payload,seed,data});
  report.load={command_ms:performance.now()-started,frame:initial.world?.frame,fields:[]};
  for(const [field,value]of Object.entries(initial.world??{})){const publication=worldFieldPublication(value);if(publication)report.load.fields.push({field,bytes:Buffer.byteLength(publication.text),structure:cardinality(value)});}
  initial=null;
  let last;
  for(let index=0;index<frames;index++){const start=performance.now(),snapshot=await core.execute({kind:'tick',input:sequence[index]??{}}),end=performance.now();report.rows.push(rowFor(snapshot,core.trace(),start,end,index,warmup));last=snapshot;}
  // Once after all measured commands, never part of the per-tick profiling loop.
  report.final={frame:last.world?.frame,observation_digest:last.observation_digest,world_fields_sha256:Object.fromEntries(Object.entries(last.world??{}).map(([key,value])=>[key,valueHash(value)])),save_payload_sha256:valueHash(last.save_payload)};
  unchanged(pins);report.inputs_unchanged=true;assert.equal(report.aborts.length,0);report.summary=summarize(report.rows);report.ok=true;
 }catch(cause){report.error=String(cause.stack??cause);process.exitCode=1;}
 finally{
  try{if(core){core.close();report.closed=true;}else if(module){module._unone_web_unload_project?.();report.closed=true;}}catch(cause){report.cleanup_error=String(cause);report.ok=false;process.exitCode=1;}
  try{unchanged(pins);}catch(cause){report.pin_error=String(cause);report.ok=false;process.exitCode=1;}
  if(!created){fs.mkdirSync(out);created=true;}
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({ok:report.ok,out,executed_frames:report.rows.length,summary:report.summary??null,error:report.error?.slice(0,2000)??null}));
 }
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)await main();
