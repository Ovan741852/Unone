import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {module,payload,loadProject,readObservation,tick} from './runtime-harness.mjs';
const fixture=readFileSync(new URL('bequest-fixtures.luau',import.meta.url),'utf8');
loadProject(module,{...payload,script:payload.script.replace('return Game',fixture+'\nreturn Game')},42n);
const checks=readObservation(module).world.observations.bequest_checks;assert.ok(checks>=35);console.log('PASS',checks,'bequest assertions in actual Unone WASM');
const results=[];
for(const seed of [11n,42n,83n]){
 const script=payload.script.replace('local function beginBattle()',`local function beginBattle()\nS.selected=1;S.skillSources[1]={{id="legacy_gift"},{id="guard_bequest"},{id="short_fuse"}}`);
 loadProject(module,{...payload,script},seed);tick({actions:{Start:true}});for(let i=0;i<92;i++)tick({});tick({actions:{Choice1:true}});tick({});tick({actions:{LeaveShop:true}});tick({});tick({actions:{Mode_auto:true}});tick({});tick({actions:{Auto_apply:true}});
 let s,peakStacks=0,burstHits=0;const seen=new Set();
 for(let i=0;i<1200;i++){
  s=tick(i%240===0?{actions:{[i%480===0?'Unit3':'Unit1']:true}}:{});
  for(const b of Object.values(s.skillRuntime.triggers.buffs))if(b.kind==='legacy_gift')peakStacks=Math.max(peakStacks,b.stacks);
  for(const d of Object.values(s.damageEvents))if(d.damageType==='guard_bequest'&&!seen.has(d.id)){seen.add(d.id);burstHits++;}
 }
 assert.ok(s.fired>0&&s.skillRuntime.triggers.counts.legacy_gift>0&&s.skillRuntime.triggers.counts.guard_bequest>0&&burstHits>0);assert.ok(peakStacks>0&&peakStacks<=3);
 tick({actions:{Pause:true}});const paused=tick({});for(let i=0;i<15;i++)s=tick({});assert.deepEqual(s.skillRuntime,paused.skillRuntime);assert.equal(s.coins,paused.coins);
 results.push({seed:Number(seed),fired:s.fired,spent:s.spent,earned:s.earned,coins:s.coins,kills:s.kills,counts:s.skillRuntime.triggers.counts,peakStacks,burstHits});console.log('PASS mixed sword/cavalry 20-second run',String(seed));
}
const out=new URL('../tests/bequests/',import.meta.url);mkdirSync(out,{recursive:true});writeFileSync(new URL('runtime-report.json',out),JSON.stringify({checks,scope:'Actual WASM fixtures and three 20-second mixed-army trials. Starting skills injected in memory only; normal lotteries and economy. Not full-run balance evidence.',results},null,2));
