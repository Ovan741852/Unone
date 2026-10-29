// Exact old shipped WASM, not an ABI mock or a rebuilt runtime.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {createRuntimeCore} from '../web/shared/runtime-core.mjs';
const root=path.resolve(import.meta.dirname,'..'),sdk=path.resolve(process.argv[2]??path.join(root,'artifacts/core-sdk'));
const out=path.resolve(process.argv[3]??path.join(root,'.cache/legacy-viewport-runtime.json'));
const checks=[],runs=[];function check(value,label){assert.ok(value,label);checks.push(label);}
for(const variant of ['web-production-0','web-development-1']){
 const folder=path.join(sdk,'runtimes',variant),[loader,wasm]=await Promise.all([fs.readFile(folder+'/unone-player.js','utf8'),fs.readFile(folder+'/unone_player.wasm')]);
 let module;await new Promise((resolve,reject)=>{const context=vm.createContext({console,TextEncoder,TextDecoder,URL,setTimeout,clearTimeout,performance,crypto:webcrypto,
  window:{},document:{currentScript:{src:'file:///unone-player.js'}},Module:{noInitialRun:true,wasmBinary:wasm,print(){},printErr:console.error,onAbort:reject,onRuntimeInitialized(){module=context.Module;resolve();}}});vm.runInContext(loader,context);});
 check(typeof module._unone_web_set_viewport_size!=='function',variant+': exact shipped runtime lacks the new physical-size ABI');
 const core=createRuntimeCore(module,{requirePhysicalViewport:false});
 const payload={config:{name:'legacy viewport',entry_script:'main.luau',systems:{physics2d:false,physics3d:false,spine:false,effekseer:false,jobs:false,audio:false,particle:false,save:false}},
  script:"return {start=function(api) api.observation.set('startAspect',api.ui.getViewport().aspect) end,update=function(api) api.observation.set('tickAspect',api.ui.getViewport().aspect) end}",
  scene:null,viewport_size:[800,600],viewport_aspect:9};
 const original=JSON.stringify(payload),loaded=await core.execute({kind:'load',payload,seed:'42'});
 check(Math.abs(loaded.world.observations.startAspect-4/3)<1e-6,variant+': ordinary load derives a legal aspect before Game.start');
 check(JSON.stringify(payload)===original,variant+': adaptation preserves the caller payload including physical dimensions');
 const resized=await core.execute({kind:'viewport',width:360,height:900});
 check(resized.world.frame===loaded.world.frame,variant+': aspect resize does not tick the simulation');
 const after=await core.execute({kind:'tick',input:{actions:{}}});
 check(Math.abs(after.world.observations.tickAspect-.4)<1e-6,variant+': normal next tick sees the actual resized aspect');
 check(core.report().viewport.mode==='aspect-only'&&!core.report().viewport.physical_api,variant+': metrics explicitly report the limited aspect-only mode');
 const strict=createRuntimeCore(module,{requirePhysicalViewport:true});
 await assert.rejects(strict.execute({kind:'load',payload}),/PROJECTED_VIEWPORT_ABI_UNAVAILABLE/);
 check(true,variant+': explicit physical requirements still reject before a legacy runtime can start');
 strict.close();core.close();runs.push({variant,wasmSha256:createHash('sha256').update(wasm).digest('hex'),loadedFrame:loaded.world.frame,afterFrame:after.world.frame,startAspect:loaded.world.observations.startAspect,tickAspect:after.world.observations.tickAspect,mode:core.report().viewport});
}
const report={ok:true,passed:checks.length,checks,runs,scope:'Actual unchanged official WASM load/resize/tick and strict capability gate; no GPU or physical coordinate support claim',inputs:{}};
for(const file of ['web/shared/runtime-core.mjs','web/shared/runtime-backend.mjs','web/shared/runtime-worker.js','web/player/main.js'])report.inputs[file]=createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex');
await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:true,passed:checks.length,out}));
