import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {module,payload,loadProject,readObservation,tick} from './runtime-harness.mjs';
const fixture=readFileSync(new URL('trigger-fixtures.luau',import.meta.url),'utf8');
loadProject(module,{...payload,script:payload.script.replace('return Game',fixture+'\nreturn Game')},42n);
const checks=readObservation(module).world.observations.trigger_checks;assert.ok(checks>=50);console.log('PASS',checks,'trigger and economy assertions in actual WASM');
const results=[];
for(const skills of [[],['plunder'],['plunder','firstborn'],['plunder','firstborn','momentum'],['march_capacitor','third_pulse'],['battle_elegy','grave_bloom','delayed_bloom'],['last_echo','longlife']]){
 const trials=[];
 for(const seed of [11n,42n,83n]){
  const script=payload.script.replace('local function beginBattle()',`local function beginBattle()\nS.selected=3;S.skillSources[3]={${skills.map(id=>`{id="${id}"}`).join(',')}}`);
  loadProject(module,{...payload,script},seed);tick({actions:{Start:true}});tick({actions:{LaunchExpedition:true}});for(let i=0;i<92;i++)tick({});tick({actions:{VisitLocation:true}});tick({actions:{Choice1:true}});tick({});tick({actions:{LeaveShop:true}});tick({});tick({actions:{Deploy:true}});tick({});tick({actions:{Mode_auto:true}});tick({});tick({actions:{Auto_apply:true}});
  let s;for(let i=0;i<900;i++)s=tick({});
  assert.ok(s.fired>0);if(skills.includes('plunder'))assert.ok(s.plunderEarned>0);else assert.equal(s.plunderEarned,0);
  if(skills.includes('firstborn'))assert.ok(s.skillRuntime.triggers.counts.firstborn>0);
  tick({actions:{Pause:true}});const paused=tick({});for(let i=0;i<15;i++)s=tick({});assert.deepEqual(s.skillRuntime,paused.skillRuntime);assert.equal(s.coins,paused.coins);
  trials.push({seed:Number(seed),fired:s.fired,spent:s.spent,earned:s.earned,plunder:s.plunderEarned,coins:s.coins,kills:s.kills,triggers:s.skillRuntime.triggers.counts,phase:s.phase});
 }
 results.push({skills,trials});console.log('PASS 3-seed 15 second run:',skills.join('+')||'base',trials.map(t=>({fired:t.fired,plunder:t.plunder,coins:t.coins})));
}
const out=new URL('../tests/triggers/',import.meta.url);mkdirSync(out,{recursive:true});writeFileSync(new URL('runtime-report.json',out),JSON.stringify({checks,scope:'Actual WASM fixtures and 3-seed short production simulations per build. Test loadouts injected at beginBattle; unmodified combat/lottery. Short samples are not full-run balance proof.',results},null,2));
