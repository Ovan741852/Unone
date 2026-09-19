import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {module,payload,loadProject,readObservation,tick} from './runtime-harness.mjs';
const fixture=readFileSync(new URL('composition-fixtures.luau',import.meta.url),'utf8');
loadProject(module,{...payload,script:payload.script.replace('return Game',fixture+'\nreturn Game')},42n);
const checks=readObservation(module).world.observations.composition_checks;assert.ok(checks>=48);console.log('PASS',checks,'composition assertions in actual Unone WASM');
const results=[];
for(const skills of [['gravity_law','contact_mine','quick_chant'],['step_orb','overload_script','firstborn'],['comrade_oath','resonant_debt','phoenix_fire'],['storm_payload','step_orb','rain_strike']]){
 const trials=[];
 for(const seed of [11n,42n,83n]){
  const script=payload.script.replace('local function beginBattle()',`local function beginBattle()\nS.selected=3;S.skillSources[3]={${skills.map(id=>`{id="${id}"}`).join(',')}}`);
  loadProject(module,{...payload,script},seed);tick({actions:{Start:true}});for(let i=0;i<92;i++)tick({});tick({actions:{Choice1:true}});tick({});tick({actions:{LeaveShop:true}});tick({});tick({actions:{Mode_auto:true}});tick({});tick({actions:{Auto_apply:true}});
  let s,peakNodes=0,peakMarks=0;const times=[];
  for(let i=0;i<1500;i++){const at=performance.now();s=tick({});times.push(performance.now()-at);peakNodes=Math.max(peakNodes,Object.keys(s.skillRuntime.composition.nodes).length);peakMarks=Math.max(peakMarks,Object.keys(s.skillRuntime.composition.marks).length);}
  assert.ok(s.fired>0);const counts=s.skillRuntime.composition.counts;
  for(const id of skills.filter(id=>['gravity_law','contact_mine','step_orb','comrade_oath','resonant_debt'].includes(id)))assert.ok(counts[id]>0,id);
  const offensive=skills.includes("contact_mine")?"contact_mine":skills.includes("step_orb")?"step_orb":"resonant_debt";assert.ok(counts[offensive+"_hits"]>0,offensive+" must cause damage, not only spawn visuals");
  tick({actions:{Pause:true}});const paused=tick({});for(let i=0;i<30;i++)s=tick({});assert.deepEqual(s.skillRuntime,paused.skillRuntime);assert.equal(s.coins,paused.coins);
  times.sort((a,b)=>a-b);trials.push({seed:Number(seed),fired:s.fired,spent:s.spent,earned:s.earned,coins:s.coins,kills:s.kills,counts,peakNodes,peakMarks,tickP95ms:times[Math.floor(times.length*.95)],phase:s.phase});
 }
 results.push({skills,trials});console.log('PASS 3-seed 25-second production trials',skills.join('+'));
}
const out=new URL('../tests/composition/',import.meta.url);mkdirSync(out,{recursive:true});writeFileSync(new URL('runtime-report.json',out),JSON.stringify({checks,scope:'Actual WASM fixtures; 12 short production trials with in-memory starting loadouts and unmodified economy/lotteries. Not proof of full-run balance.',results},null,2));
