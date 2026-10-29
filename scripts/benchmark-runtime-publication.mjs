// Fixed-source production WASM CPU/heap-capacity measurement. No display claim.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {webcrypto,createHash} from 'node:crypto';

const {values:o}=parseArgs({options:Object.fromEntries([
  'runtime','payload','source','save','out','enter-action','frames','warmup','runs','seed'
].map(k=>[k,{type:'string'}]))});
for(const k of ['runtime','payload','out']) assert.ok(o[k],`--${k} required`);
const frames=Number(o.frames??300),warmup=Number(o.warmup??30),runs=Number(o.runs??3);
assert.ok(Number.isInteger(frames)&&frames>0&&frames<=60000);
assert.ok(Number.isInteger(warmup)&&warmup>=0&&warmup<=6000);
assert.ok(Number.isInteger(runs)&&runs>=3&&runs<=31);
const runtime=resolve(o.runtime),manifest=JSON.parse(fs.readFileSync(join(runtime,'runtime.json'),'utf8'));
assert.equal(manifest.profile,'release');assert.equal(manifest.preview_tools,false);
const loader=fs.readFileSync(join(runtime,manifest.javascript),'utf8');
const wasm=fs.readFileSync(join(runtime,manifest.wasm));
const payload=JSON.parse(fs.readFileSync(o.payload,'utf8'));
if(o.source) payload.script=fs.readFileSync(o.source,'utf8');
payload.viewport_aspect=16/9;payload.viewport_size=[1600,900];
payload.restored_save=o.save?JSON.parse(fs.readFileSync(o.save,'utf8')):null;
const hash=v=>createHash('sha256').update(v).digest('hex');
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'
  ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const valueHash=v=>hash(JSON.stringify(stable(v)));
const distribution=values=>{const a=values.toSorted((a,b)=>a-b);return {n:a.length,min:a[0],p50:a[Math.floor(a.length*.5)],p95:a[Math.ceil(a.length*.95)-1],max:a.at(-1)};};
let engine;
await new Promise((ready,reject)=>{
  const context=vm.createContext({console,TextEncoder,TextDecoder,URL,WebAssembly,setTimeout,clearTimeout,performance,crypto:webcrypto,
    window:{},document:{currentScript:{src:pathToFileURL(join(runtime,manifest.javascript)).href}},
    Module:{noInitialRun:true,wasmBinary:wasm,print(){},printErr:console.error,onAbort:reject,
      onRuntimeInitialized(){engine=context.Module;ready();}}});
  vm.runInContext(loader,context,{filename:'official-production-player.js'});
});
const encoder=new TextEncoder(),decoder=new TextDecoder();
function read(){const p=engine._unone_web_observation_ptr(),n=engine._unone_web_observation_len();return JSON.parse(decoder.decode(engine.HEAPU8.subarray(p,p+n)));}
function send(name,value,...args){const bytes=encoder.encode(JSON.stringify(value)),p=engine._unone_web_alloc(bytes.length);engine.HEAPU8.set(bytes,p);assert.equal(engine[name](p,bytes.length,...args),0,()=>JSON.stringify(read()));}
const report={schema:'unone.publication.benchmark.v1',scope:'Node V8 production WASM CPU, no renderer/display; WASM capacity plateau is not proof of no leak or low GC.',
  identity:{runtime,wasm_sha256:hash(wasm),source_sha256:hash(payload.script),payload_sha256:valueHash(payload),node:process.version,platform:process.platform,arch:process.arch},
  configuration:{frames,warmup,runs,seed:o.seed??'42',viewport:[1600,900],enter_action:o['enter-action']??null},runs:[]};
for(let run=0;run<runs;run++){
  send('_unone_web_load_project',payload,BigInt(o.seed??42));
  if(o['enter-action']){send('_unone_web_set_input_frame',{actions:{[o['enter-action']]:true}});assert.equal(engine._unone_web_tick(),0);read();}
  send('_unone_web_set_input_frame',{actions:{}});
  for(let i=0;i<warmup;i++){assert.equal(engine._unone_web_tick(),0);read();}
  const tick=[],decode=[],total=[],sizes=[],capacities=[];
  const capacityBefore=engine.HEAPU8.buffer.byteLength;
  for(let i=0;i<frames;i++){
    const begin=performance.now();assert.equal(engine._unone_web_tick(),0);
    const tickEnd=performance.now();tick.push(tickEnd-begin);
    sizes.push(engine._unone_web_observation_len());read();
    decode.push(performance.now()-tickEnd);total.push(performance.now()-begin);
    capacities.push(engine.HEAPU8.buffer.byteLength);
  }
  const snapshot=read(),world=structuredClone(snapshot.world);
  // Pre-fix players serialized the inactive default application state. The
  // engine now omits it to preserve the pre-application replay contract.
  if(world.application?.escape_behavior==='quit'&&world.application.quit_requested===false)delete world.application;
  const row={run:run+1,frame:snapshot.world.frame,screen:snapshot.world.observations?.screen,
    tick_ms:distribution(tick),decode_ms:distribution(decode),cpu_total_ms:distribution(total),output_bytes:distribution(sizes),
    wasm_capacity:{before:capacityBefore,after:engine.HEAPU8.buffer.byteLength,min:Math.min(...capacities),max:Math.max(...capacities)},
    equivalence:{world_without_default_application:valueHash(world),ui:valueHash(world.ui),entities:valueHash(world.entities),observations:valueHash(world.observations),save:valueHash(snapshot.save_payload)},
    observation_digest:snapshot.observation_digest};
  report.runs.push(row);fs.writeFileSync(o.out,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(row));
}
