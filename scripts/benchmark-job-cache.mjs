// Real shipped WASM ABI comparison. This does not measure game FPS.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {jobRequest} from '../web/shared/job-pool.mjs';
import {createBinaryJobTransport,encodeJobPacket} from '../web/shared/job-binary.mjs';
const [before,after,output]=process.argv.slice(2);
if(!before||!after)throw Error('Usage: node scripts/benchmark-job-cache.mjs BEFORE AFTER [REPORT]');
async function load(directory){
const root=resolve(directory),manifest=JSON.parse(readFileSync(join(root,'runtime.json'),'utf8')),js=join(root,manifest.javascript);
const module=await new Promise((resolveReady,reject)=>{
 const options={wasmBinary:new Uint8Array(readFileSync(join(root,manifest.wasm))),noInitialRun:true,onAbort:e=>reject(Error(String(e))),print:()=>{},printErr:()=>{}};
 const context={Module:options,crypto:webcrypto,window:{},document:{currentScript:{src:pathToFileURL(js).href}},location:{href:pathToFileURL(js).href},console,TextDecoder,TextEncoder,WebAssembly,setTimeout,clearTimeout,performance};
 options.onRuntimeInitialized=()=>resolveReady(context.Module);vm.runInNewContext(readFileSync(js,'utf8'),context,{filename:js});
});
return {manifest,binary:createBinaryJobTransport(module)};
}
const runtimes={before:await load(before),after:await load(after)},cases=[];
assert.equal(runtimes.before.manifest.profile,'release');
assert.equal(runtimes.after.manifest.profile,'release');
assert.deepEqual(runtimes.before.manifest.cargo_features,runtimes.after.manifest.cargo_features);
for(const complexity of [0,128]){
 const source='return function(b) local x=buffer.readu32(b,0); '+Array.from({length:complexity},(_,i)=>'x=(x+'+(i+1)+')%65536;').join('')+' buffer.writeu32(b,0,x); return b end';
 const work={id:'cache-benchmark',path:'cache-benchmark.luau',source,input:new Uint8Array(4096).buffer};
 let reference;const run=kind=>{const t=performance.now(),r=runtimes[kind].binary.execute(work),ms=performance.now()-t;assert.equal(r.error,null);const bytes=new Uint8Array(r.output);if(!reference)reference=bytes;else assert.deepEqual(bytes,reference);return {ms,profile:r.profile??null};};
 const cold={before:run('before'),after:run('after')};
 for(let i=0;i<10;i++){run('before');run('after');}
 const rounds=[];for(let i=0;i<3;i++){const order=i%2?['after','before']:['before','after'],values={};for(const k of order){const samples=Array.from({length:40},()=>run(k));values[k]={mean_ms:samples.reduce((n,v)=>n+v.ms,0)/samples.length,samples};}rounds.push({order,values});}
 cases.push({complexity,source_bytes:source.length,input_bytes:4096,cold,rounds});
}
const report={runtimes:Object.fromEntries(Object.entries(runtimes).map(([k,v])=>[k,v.manifest])),cases,note:'Real release WASM. Alternating three pairs of 40 calls after warmup. Same input/source and byte-exact outputs. Timings include fresh VM and binary ABI; no renderer or Worker scheduling. Not FPS.'};
if(output)writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(cases.map(c=>({complexity:c.complexity,cold:c.cold,means:c.rounds.map(r=>Object.fromEntries(Object.entries(r.values).map(([k,v])=>[k,v.mean_ms])))}))));
