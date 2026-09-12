// LEGACY 90-second policy; use _Tools/fishing-quicktest/balance-cli.mjs for the current game.
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
const report=[];
for(const [seed,unit]of [[42,1],[7,2],[99,3]]){
 let s=loadProject(module,payload,BigInt(seed)).world.observations.game,previous={},inputs=[],rounds=[],lastRound=0;
 for(let frame=0;frame<42000;frame++){
  let input={actions:{}};
  if(s.phase==='menu')input.actions.Start=true;
  else if(s.phase==='choice'){
   if(s.selected!==unit)input.actions['Unit'+unit]=true;
   else {const cs=Object.values(s.cards);const priority=['edge',['sword','spear','cavalry'][unit-1],'purse','oath','fortune','ember','storm','march','echo','frost'];let best=0;cs.forEach((c,i)=>{if(priority.indexOf(c.id)<priority.indexOf(cs[best].id))best=i});input.actions['Choice'+(best+1)]=true}
  }else if(s.phase==='clear'){if(lastRound!==s.round){rounds.push({round:s.round,coins:s.coins,seconds:Math.round(90-s.time)});lastRound=s.round;}if(s.presentationDelay<=0)input.actions.Next=true;previous={}}
  else if(s.phase==='victory'||s.phase==='defeat')break;
  else if(s.phase==='battle'){
   if(s.fireMode!=='auto')input.actions.Mode_auto=true;
   if(s.targetFilter!=='boss')input.actions.Filter_boss=true;
   // Do not stall with an unaffordable specialist; cheaper units remain valid.
   if(s.coins<s.costs[s.selected-1])input.actions.Unit1=true;
  }
  inputs.push(input);s=tick(input);
 }
 const r={seed,unit,phase:s.phase,round:s.round,coins:s.coins,fired:s.fired,breaks:s.breaks,kills:s.kills,choices:Object.values(s.inventory).length,rounds};report.push(r);console.log(JSON.stringify(r));
 if(seed===42){assert.equal(s.phase,'victory','seven-round run must be winnable');assert.equal(Object.values(s.inventory).length,7);assert.equal(s.round,7);
  const spec={name:'seven-round-victory-real-input',seed,frames:inputs.length,input_sequence:inputs,assertions:[['phase','victory'],['round',7],['choices',7],['economy_conserved',true]].map(([key,equals])=>({observation:{key,equals}}))};writeFileSync(join(root,'tests/seven-round-victory.test.json'),JSON.stringify(spec));
 }
}
writeFileSync(join(root,'tests/playtest-report.json'),JSON.stringify(report,null,2));
assert.ok(report.every(r=>r.phase==='victory'),'each troop-focused strategy must complete all seven rounds');
console.log('PASS: three troop strategies, 21 stages, actual Unone WASM; economy conserved every tick.');
// Verify discounted deployment refunds its historical paid price exactly once.
for(let seed=1;seed<=80;seed++){
 loadProject(module,payload,BigInt(seed));const inputs=[];
 const step=input=>{inputs.push(input);return tick(input)};
 step({actions:{Start:true}});let s=step({actions:{}});
 const choice=Object.values(s.cards).findIndex(c=>c.id==='oath');if(choice<0)continue;
 step({actions:{['Choice'+(choice+1)]:true}});s=step({actions:{}});
 while(s.time>1)s=step({actions:{}});
 const before=s.coins,paid=s.costs[0];assert.ok(paid<8);
 step({pointer:{position:{x:-9.7,y:6},down:true}});s=step({pointer:{position:{x:-9.7,y:6},down:false}});
 while(s.phase==='battle')s=step({actions:{}});
 for(let i=0;i<120;i++)s=step({actions:{}});
 assert.equal(s.phase,'defeat');assert.equal(s.returnedUnits,1);assert.equal(s.roundRefund,paid);assert.equal(s.refunded,paid);assert.equal(s.coins,before);assert.equal(s.troops,0);
 writeFileSync(join(root,'tests/discount-refund.test.json'),JSON.stringify({name:'discounted-survivor-refunded-once',seed,frames:inputs.length,input_sequence:inputs,assertions:[['refunded',paid],['troops',0],['economy_conserved',true],['deployment_cost_conserved',true],['troop_count_conserved',true]].map(([key,equals])=>({observation:{key,equals}}))}));
 console.log(`PASS: discounted survivor refund ${paid}, no repeat payment, seed ${seed}.`);break;
}

// LOCK must never damage bystanders, including spear area damage.
for(const unit of [1,2,3]){
 loadProject(module,payload,42n);tick({actions:{Start:true}});tick({});tick({actions:{Choice1:true}});
 let s=tick({actions:{['Unit'+unit]:true,Mode_lock:true}});
 const target=Object.values(s.monsters).find(m=>m.rank===3);const id=target.id;
 s=tick({pointer:{position:{x:target.x,y:target.z},down:true}});
 let hadCoins=false,hadParticles=false;
 for(let frame=0;frame<500;frame++){
  s=tick({});hadCoins ||= s.coinParticles>0;hadParticles ||=s.particles>0;
  assert.ok(s.targetId===id||s.targetId===0,'LOCK does not switch targets');
  assert.ok(Object.values(s.monsters).filter(m=>m.id!==id).every(m=>m.damage===0&&m.breaks===0),'no bystander damage');
 }
 assert.ok(hadCoins&&hadParticles,'real awards emit coins and particles');
 console.log(`PASS: LOCK unit ${unit}, exclusive hits and reward particles.`);
}
for(const filter of ['small','boss']){
 loadProject(module,payload,42n);tick({actions:{Start:true}});tick({});tick({actions:{Choice1:true}});
 let s=tick({actions:{Mode_auto:true,['Filter_'+filter]:true}});
 for(let frame=0;frame<600;frame++){
  s=tick({});const target=Object.values(s.monsters).find(m=>m.id===s.targetId);
  if(target)assert.ok(filter==='small'?target.rank<=2:target.rank>=3,'AUTO target filter');
 }
 console.log(`PASS: AUTO ${filter} target filter.`);
}
// Seeded optional hordes: one simultaneous wave, pause-safe and bounded.
let sawSurge=false,sawQuiet=false;
for(let seed=1;seed<=20&&!(sawSurge&&sawQuiet);seed++){
 loadProject(module,payload,BigInt(seed));const inputs=[];const step=i=>{inputs.push(i);return tick(i)};
 step({actions:{Start:true}});step({});let s=step({actions:{Choice1:true}});s=step({});
 const scheduled=s.hordeAt;
 if(scheduled>=0&&sawSurge||scheduled<0&&sawQuiet)continue;
 if(scheduled>=0){
  while(90-s.time<scheduled-.15)s=step({});
  s=step({actions:{Pause:true}});const before=s.time;
  for(let i=0;i<120;i++)s=step({});
  assert.equal(s.time,before);assert.equal(s.hordeCount,0);
  step({actions:{Pause:true}});
 }
 while(s.time>40)s=step({});
 const small=Object.values(s.monsters).filter(m=>m.rank<=2).length;
 assert.equal(s.hordeCount,scheduled>=0?1:0);assert.equal(small,scheduled>=0?87:15);
 assert.equal(s.bossSpawned,false);
 const name=scheduled>=0?'horde-paused-single-surge':'horde-optional-quiet-round';
 writeFileSync(join(root,`tests/${name}.test.json`),JSON.stringify({name,seed,frames:inputs.length,input_sequence:inputs,assertions:[['horde_count',scheduled>=0?1:0],['small_count',small],['boss_present',false],['economy_conserved',true]].map(([key,equals])=>({observation:{key,equals}}))}));
 if(scheduled>=0)sawSurge=true;else sawQuiet=true;
 console.log(`PASS: ${name}, seed ${seed}, small monsters ${small}.`);
}
assert.ok(sawSurge&&sawQuiet);
