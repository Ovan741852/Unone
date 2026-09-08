// Raw exported-WASM timing. Includes publication and JSON decode; no renderer.
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
const {values}=parseArgs({options:{export:{type:'string'},counts:{type:'string',default:'250,1000'}}});
if(!values.export)throw new Error('Use --export <actual exported player directory> [--counts 250,1000]');
const counts=values.counts.split(',').map(Number);
if(counts.some(n=>!Number.isInteger(n)||n<1||n>4000))throw new Error('Counts must be integers 1..4000');
const folder=resolve(values.export),manifest=JSON.parse(readFileSync(join(folder,'runtime/runtime.json'),'utf8'));
const js=join(folder,'runtime',manifest.javascript);
const {loadProject,readObservation}=await import(pathToFileURL(join(folder,'web/shared/load-project.js')).href);
const module=await new Promise((ready,reject)=>{
  const options={wasmBinary:new Uint8Array(readFileSync(join(folder,'runtime',manifest.wasm))),noInitialRun:true,onAbort:reason=>reject(new Error(String(reason))),print:()=>{},printErr:console.error};
  const context={Module:options,crypto:webcrypto,window:{},document:{currentScript:{src:pathToFileURL(js).href}},location:{href:pathToFileURL(js).href},console,TextDecoder,TextEncoder,WebAssembly,setTimeout,clearTimeout,performance};
  options.onRuntimeInitialized=()=>ready(context.Module);vm.runInNewContext(readFileSync(js,'utf8'),context,{filename:js});
});
const v=(x,y,z)=>({x,y,z});
for(const count of counts){
  const entities=[],bodies={};
  for(let i=0;i<count;i++){
    const id=`body${String(i).padStart(5,'0')}`;
    entities.push({id,transform3d:{position:v(i%100*3,3,Math.floor(i/100)*3)}});
    bodies[id]={body_type:'dynamic',shape:{kind:'sphere',radius:0.5},gravity_scale:0,velocity:v(0.1,0,0),can_sleep:false};
  }
  loadProject(module,{config:{name:'Physics3D measured probe',entry_script:'main.luau',systems:{physics3d:true,physics2d:false}},script:'return {start=function(api) end,update=function(api,dt) end}',scene:{entities,physics3d:{gravity:v(0,-9.81,0),bodies}}},42n);
  const abi=[],decode=[];
  for(let i=0;i<70;i++){
    const start=performance.now();if(module._unone_web_tick()!==0)throw new Error(JSON.stringify(readObservation(module)));
    const middle=performance.now();readObservation(module);const end=performance.now();
    if(i>=10){abi.push(middle-start);decode.push(end-middle);}
  }
  abi.sort((a,b)=>a-b);decode.sort((a,b)=>a-b);
  console.log(JSON.stringify({backend:'exported-wasm',variant:manifest.preview_tools?'development':'production',bodies:count,layout:'free-flight, no contacts, no sleep',samples:60,tick_and_publish_median_ms:abi[30],tick_and_publish_p95_ms:abi[57],json_decode_median_ms:decode[30],json_decode_p95_ms:decode[57],wasm_capacity_bytes:module.HEAPU8.byteLength,excluded:['renderer','GPU','input transport','human panel polling']}));
}
