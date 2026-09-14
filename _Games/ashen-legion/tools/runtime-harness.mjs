// Actual exported WASM simulation. No state edits, cheats or mock combat.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=join(root,'dist/web');
const runtime=JSON.parse(readFileSync(join(out,'runtime/runtime.json'))),js=join(out,'runtime',runtime.javascript);
const module=await new Promise((done,reject)=>{
 const options={wasmBinary:new Uint8Array(readFileSync(join(out,'runtime',runtime.wasm))),noInitialRun:true,print:()=>{},printErr:console.error,onAbort:reject};
 const context={Module:options,crypto:webcrypto,window:{},document:{currentScript:{src:pathToFileURL(js).href}},location:{href:pathToFileURL(js).href},console,TextDecoder,TextEncoder,WebAssembly,setTimeout,clearTimeout,performance};
 options.onRuntimeInitialized=()=>done(context.Module);vm.runInNewContext(readFileSync(js,'utf8'),context);
});
const {loadProject,readObservation}=await import(pathToFileURL(join(out,'web/shared/load-project.js')));
const payload=JSON.parse(readFileSync(join(out,'content/project.json')));
function tick(input){const data=new TextEncoder().encode(JSON.stringify(input)),p=module._unone_web_alloc(data.length);module.HEAPU8.set(data,p);assert.equal(module._unone_web_set_input_frame(p,data.length),0);assert.equal(module._unone_web_tick(),0);const r=readObservation(module);for(const key of ['economy_conserved','deployment_cost_conserved','troop_count_conserved','troops_in_bounds'])assert.equal(r.world.observations[key],true,key);if(r.world.observations.crystal_conserved!==undefined)assert.equal(r.world.observations.crystal_conserved,true,'crystal_conserved');return r.world.observations.game}

export {module,payload,tick,loadProject,readObservation};
