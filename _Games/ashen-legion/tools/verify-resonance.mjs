import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {module,payload,loadProject,readObservation,tick} from './runtime-harness.mjs';
const fixture=readFileSync(new URL('resonance-fixtures.luau',import.meta.url),'utf8');
loadProject(module,{...payload,script:payload.script.replace('return Game',fixture+'\nreturn Game')},42n);
const checks=readObservation(module).world.observations.resonance_checks;assert.ok(checks>=55);console.log('PASS',checks,'actual WASM delayed-skill assertions');
const results=[];
for(const skills of [['cinder_seal','chain_fuse','pierce'],['thunder_fan','rain_strike','starfall'],['echo_blade','soul_return','firstborn']]){
 const trials=[];
 for(const seed of [11n,42n,83n]){
  const script=payload.script.replace('local function beginBattle()',`local function beginBattle()\nS.selected=3;S.skillSources[3]={${skills.map(id=>`{id="${id}"}`).join(',')}}`);
  loadProject(module,{...payload,script},seed);tick({actions:{Start:true}});for(let i=0;i<92;i++)tick({});tick({actions:{Choice1:true}});tick({});tick({actions:{LeaveShop:true}});tick({});tick({actions:{Mode_auto:true}});tick({});tick({actions:{Auto_apply:true}});
  let s;for(let i=0;i<1200;i++)s=tick({});assert.ok(s.fired>0);
  const counts=s.skillRuntime.resonance.counts;for(const id of skills.filter(id=>!['pierce','rain_strike','firstborn'].includes(id)))assert.ok(counts[id]>0,id);
  tick({actions:{Pause:true}});const paused=tick({});for(let i=0;i<30;i++)s=tick({});assert.deepEqual(s.skillRuntime,paused.skillRuntime);assert.equal(s.coins,paused.coins);
  trials.push({seed:Number(seed),fired:s.fired,spent:s.spent,earned:s.earned,coins:s.coins,kills:s.kills,counts,phase:s.phase});
 }
 results.push({skills,trials});console.log('PASS 3-seed 20s production trial',skills.join('+'));
}
const out=new URL('../tests/resonance/',import.meta.url);mkdirSync(out,{recursive:true});writeFileSync(new URL('runtime-report.json',out),JSON.stringify({checks,scope:'Actual WASM assertions plus 9 short 20-second production simulations with in-memory starting loadouts. Not a full-run balance conclusion.',results},null,2));
