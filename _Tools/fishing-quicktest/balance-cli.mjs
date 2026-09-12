// Actual exported WASM simulation. No state edits, cheats or mock combat.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../_Games/ashen-legion'),out=join(root,'dist/web');
const runtime=JSON.parse(readFileSync(join(out,'runtime/runtime.json'))),js=join(out,'runtime',runtime.javascript);
const module=await new Promise((done,reject)=>{
 const options={wasmBinary:new Uint8Array(readFileSync(join(out,'runtime',runtime.wasm))),noInitialRun:true,print:()=>{},printErr:console.error,onAbort:reject};
 const context={Module:options,crypto:webcrypto,window:{},document:{currentScript:{src:pathToFileURL(js).href}},location:{href:pathToFileURL(js).href},console,TextDecoder,TextEncoder,WebAssembly,setTimeout,clearTimeout,performance};
 options.onRuntimeInitialized=()=>done(context.Module);vm.runInNewContext(readFileSync(js,'utf8'),context);
});
const {loadProject,readObservation}=await import(pathToFileURL(join(out,'web/shared/load-project.js')));
const payload=JSON.parse(readFileSync(join(out,'content/project.json')));
function runtimeTick(input){const data=new TextEncoder().encode(JSON.stringify(input)),p=module._unone_web_alloc(data.length);module.HEAPU8.set(data,p);assert.equal(module._unone_web_set_input_frame(p,data.length),0);assert.equal(module._unone_web_tick(),0);const r=readObservation(module);for(const key of ['economy_conserved','deployment_cost_conserved','troop_count_conserved','troops_in_bounds'])assert.equal(r.world.observations[key],true,key);return r.world.observations.game}

const {createHash}=await import('node:crypto');
const {policies,simulate,summarize}=await import('./balance.mjs');
const policyHash=createHash('sha256').update(readFileSync(new URL('./build-policy.mjs',import.meta.url))).update(readFileSync(new URL('./balance.mjs',import.meta.url))).digest('hex');
const count=Number(process.argv[2]??3),start=Number(process.argv[3]??1);
assert.ok(Number.isInteger(count)&&count>=1&&count<=100);assert.ok(Number.isInteger(start)&&start>=1&&start+count-1<=2147483647);
const runs=[],campaign=process.argv[6]==='campaign',saves={},starts={};
const selected=process.argv[4]?policies.filter(p=>process.argv[4].split(',').includes(p.id)):policies.filter(p=>p.build);
assert.ok(selected.length);
for(let n=0;n<count;n++)for(const policy of selected){
 const run=await simulate({seed:start+n,policy,load:seed=>{
  loadProject(module,campaign&&saves[policy.id]?{...payload,restored_save:saves[policy.id]}:payload,BigInt(seed));
  if(campaign){for(const building of (readObservation(module).world.observations.game.town.levels[0]<3?[1]:[1,4,2,3]))for(let n=0;n<5;n++){
   const state=readObservation(module).world.observations.game,level=state.town.levels[building-1],price=[60,100,160,240,360][level];
   if(price===undefined||state.town.gold<price)break;runtimeTick({actions:{['Town'+building]:true}});runtimeTick({actions:{}});
  }}
  starts[policy.id]=JSON.parse(JSON.stringify(readObservation(module).world.observations.game.town));
 },tick:runtimeTick,observe:()=>readObservation(module).world.observations});
 run.townStart=starts[policy.id];run.campaignIndex=n+1;if(campaign)saves[policy.id]=readObservation(module).save_payload??run.town;runs.push(run);console.log(`${policy.name} seed ${run.seed}: ${run.status}, cleared ${run.roundsCleared}, coins ${run.finalCoins}, frames ${run.frames}`);
}
const source=readFileSync(join(root,'main.luau'),'utf8'),scriptHash=createHash('sha256').update(payload.script).digest('hex');
const report={format:'unone.fishing.balance.v1',scriptHash,sourceMatchesExport:source===payload.script,policyVersion:5,campaign,policyHash,scope:campaign?'Real native-input campaign with persisted town saves and purchased town upgrades':'Real native-input shopping, split gold/crystal budgets, build equipment and research; fresh town; no injected state',policy:'Manual hold; retarget nearest small every 12 frames, rank-5 boss when present; build-aware shop/gear/tech; affordable sword fallback; no state edits',runs,summary:summarize(runs)};
writeFileSync(new URL('./evidence/'+(process.argv[5]??'balance-latest')+'.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report.summary,null,2));
