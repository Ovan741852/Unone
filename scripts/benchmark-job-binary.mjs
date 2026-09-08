// Real shipped WASM ABI comparison. This does not measure game FPS.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {jobRequest} from '../web/shared/job-pool.mjs';
import {createBinaryJobTransport,encodeJobPacket} from '../web/shared/job-binary.mjs';
const [directory,output]=process.argv.slice(2);if(!directory)throw Error('Usage: node scripts/benchmark-job-binary.mjs RUNTIME [report.json]');
const root=resolve(directory),manifest=JSON.parse(readFileSync(join(root,'runtime.json'),'utf8')),js=join(root,manifest.javascript);
const module=await new Promise((resolveReady,reject)=>{
 const options={wasmBinary:new Uint8Array(readFileSync(join(root,manifest.wasm))),noInitialRun:true,onAbort:e=>reject(Error(String(e))),print:()=>{},printErr:()=>{}};
 const context={Module:options,crypto:webcrypto,window:{},document:{currentScript:{src:pathToFileURL(js).href}},location:{href:pathToFileURL(js).href},console,TextDecoder,TextEncoder,WebAssembly,setTimeout,clearTimeout,performance};
 options.onRuntimeInitialized=()=>resolveReady(context.Module);vm.runInNewContext(readFileSync(js,'utf8'),context,{filename:js});
});
const binary=createBinaryJobTransport(module),cases=[];
for(const length of [0,4096,262144]){
 const input=Uint8Array.from({length},(_,i)=>i%256),meta={kind:'execute',id:'copy',path:'copy.luau',source:'return function(input)return input end'};
 const legacy={...meta,input:Array.from(input)},work={id:meta.id,path:meta.path,source:meta.source,input:input.buffer};
 const run=kind=>{const at=performance.now(),result=kind==='binary'?binary.execute(work):jobRequest(module,legacy);const elapsed=performance.now()-at;assert.equal(result.error,null);assert.deepEqual(kind==='binary'?new Uint8Array(result.output):Uint8Array.from(result.output),input);return {elapsed_ms:elapsed,response_bytes:module._unone_web_observation_len()};};
 for(let i=0;i<3;i++){run('json');run('binary');}
 const rounds=[];for(let round=0;round<3;round++){
  const order=round%2?['binary','json']:['json','binary'],runs={};
  for(const kind of order){const samples=Array.from({length:10},()=>run(kind));runs[kind]={mean_ms:samples.reduce((s,r)=>s+r.elapsed_ms,0)/samples.length,response_bytes_mean:samples.reduce((s,r)=>s+r.response_bytes,0)/samples.length,samples};}
  rounds.push({order,runs});
 }
 cases.push({payload_bytes:length,request_bytes:{json:new TextEncoder().encode(JSON.stringify(legacy)).length,binary:encodeJobPacket(meta,input.buffer).length},rounds,all_output_bytes_equal:true});
}
const report={profile:manifest.profile,runtime:manifest,host:{node:process.version,platform:process.platform,arch:process.arch},cases,binary_transport:binary.report(),note:'Three alternating pairs of ten executions after warmup. Complete JS->WASM->JS isolated-copy jobs, including VM creation and compilation; excludes Worker scheduling and renderer. Input preparation and assertions excluded from timing. Not a game FPS claim.'};
if(output)writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const summary={profile:report.profile,cases:cases.map(c=>({
 payload_bytes:c.payload_bytes,request_bytes:c.request_bytes,
 means:c.rounds.map(r=>Object.fromEntries(Object.entries(r.runs).map(([k,v])=>[k,v.mean_ms])))
}))};
console.log(JSON.stringify(summary));
