// Game-owned acceptance for split work: reset/cancellation/pause must not publish partial armies.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
const folder=resolve(process.argv[2]??'_Games/legion-fall/dist/round2-final');
const manifest=JSON.parse(readFileSync(join(folder,'runtime/runtime.json')));
const payload=JSON.parse(readFileSync(join(folder,'content/project.json')));
const js=join(folder,'runtime',manifest.javascript);
const {loadProject,readObservation}=await import(pathToFileURL(join(folder,'web/shared/load-project.js')).href);
const module=await new Promise((ready,reject)=>{
 const options={wasmBinary:new Uint8Array(readFileSync(join(folder,'runtime',manifest.wasm))),noInitialRun:true,onAbort:reject,print:()=>{},printErr:console.error};
 const context={Module:options,crypto:webcrypto,window:{},document:{currentScript:{src:pathToFileURL(js).href}},location:{href:pathToFileURL(js).href},console,TextDecoder,TextEncoder,WebAssembly,setTimeout,clearTimeout,performance};
 options.onRuntimeInitialized=()=>ready(context.Module);vm.runInNewContext(readFileSync(js,'utf8'),context,{filename:js});
});
function request(r){const b=new TextEncoder().encode(JSON.stringify(r)),p=module._unone_web_alloc(b.length);module.HEAPU8.set(b,p);assert.equal(module._unone_web_developer_request(p,b.length),0);const result=readObservation(module);assert.equal(result.ok,true);return result.value;}
function invoke(id,value){const r=request({method:'tools'});return request({method:'invoke',id,revision:r.tools.revision,...(value===undefined?{}:{value})});}
function tick(){assert.equal(module._unone_web_tick(),0);return readObservation(module).world;}
function gameWorld(){const w=request({method:'snapshot'}).observation.world;delete w.frame;delete w.time_seconds;return w;}
function fresh(){loadProject(module,payload,42n);return gameWorld();}
const initial=fresh();const golden=[];for(let i=0;i<6;i++){tick();golden.push(gameWorld());}
assert.deepEqual(golden[0],initial);assert.deepEqual(golden[1],initial);
assert.equal(golden[2].observations.battle.step,1);
for(const pending of [1,2]){
 fresh();for(let i=0;i<pending;i++)tick();invoke('battle.reset10000');assert.deepEqual(gameWorld(),initial);
 for(let i=0;i<6;i++){tick();assert.deepEqual(gameWorld(),golden[i]);}
 fresh();for(let i=0;i<pending;i++)tick();invoke('battle.running',false);const frozen=gameWorld();
 for(let i=0;i<5;i++){tick();assert.deepEqual(gameWorld(),frozen);}
 invoke('battle.running',true);for(let i=pending;i<6;i++){tick();assert.deepEqual(gameWorld(),golden[i]);}
}
console.log(JSON.stringify({ok:true,partial_work_not_published:true,reset_discards_pending_work:true,pause_resumes_same_phase:true,phases_tested:[1,2]}));
