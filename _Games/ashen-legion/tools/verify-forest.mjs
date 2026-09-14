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
function tick(input){const data=new TextEncoder().encode(JSON.stringify(input)),p=module._unone_web_alloc(data.length);module.HEAPU8.set(data,p);assert.equal(module._unone_web_set_input_frame(p,data.length),0);assert.equal(module._unone_web_tick(),0);const r=readObservation(module);for(const key of ['economy_conserved','deployment_cost_conserved','troop_count_conserved','troops_in_bounds'])assert.equal(r.world.observations[key],true,key);return r.world.observations.game}
for(const [seat,x,z] of [[1,0,7.1],[2,7.1,0],[3,0,-7.1],[4,-7.1,0]]){
 loadProject(module,payload,42n);tick({actions:{['Seat'+seat]:true}});tick({actions:{Start:true}});tick({actions:{}});tick({actions:{Choice1:true}});tick({actions:{}});tick({actions:{LeaveShop:true}});tick({actions:{}});
 tick({pointer:{position:{x:0,y:0},down:true}});tick({pointer:{position:{x:0,y:0},down:false}});tick({actions:{}});
 const o=readObservation(module).world.observations;
 assert.equal(o.field_width,14.8);assert.equal(o.field_depth,14.8);assert.equal(o.deployment_origin_x,x);assert.equal(o.deployment_origin_z,z);assert.equal(o.last_spawn_x,x);assert.equal(o.last_spawn_z,z);assert.equal(o.fired,1);
 for(let i=0;i<320;i++)tick({actions:{}});
 console.log(`PASS seat ${seat}: square 14.8 x 14.8, deploy (${x}, ${z}), conservation and bounds maintained`);
}
