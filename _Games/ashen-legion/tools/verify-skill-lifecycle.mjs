import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {module,payload,loadProject,readObservation,tick} from './runtime-harness.mjs';
const fixture=readFileSync(new URL('skill-lifecycle-fixtures.luau',import.meta.url),'utf8');
loadProject(module,{...payload,script:payload.script.replace('return Game',fixture+'\nreturn Game')},42n);
const count=readObservation(module).world.observations.skill_lifecycle_checks;
assert.ok(count>=35);console.log(`PASS ${count} lifecycle, DoT, ownership, travel and lottery assertions in Unone WASM`);
// Three production classes with acquired skill sources, otherwise normal update/fire/collision.
const results=[];
for(const unit of [1,2,3]){
 const equipped=payload.script.replace('local function beginBattle()','local function beginBattle()\n'+`S.skillSources[${unit}]={{id="flame_cloak"},{id="phoenix_fire"},{id="plague_vial"}}`);
 loadProject(module,{...payload,script:equipped},42n);
 tick({actions:{Start:true}});for(let i=0;i<92;i++)tick({});tick({actions:{Choice1:true}});tick({});tick({actions:{LeaveShop:true}});tick({});tick({actions:{['Unit'+unit]:true,Mode_auto:true}});tick({});tick({actions:{Auto_apply:true}});
 let s,peak=0,dot=0;
 for(let i=0;i<900;i++){s=tick({});peak=Math.max(peak,Object.keys(s.skillRuntime.entities??{}).length);dot=Math.max(dot,s.procHits);}
 assert.ok(s.fired>0&&dot>0&&peak>0);results.push({unit,fired:s.fired,secondaryHits:dot,peakEntities:peak,phase:s.phase});
 tick({actions:{Pause:true}});const a=tick({});for(let i=0;i<30;i++)s=tick({});assert.equal(s.skillRuntime.clock,a.skillRuntime.clock,'pause freezes lifecycle');
 console.log('PASS production update + loadout',results.at(-1));
}
const dir=new URL('../tests/skill-lifecycle/',import.meta.url);mkdirSync(dir,{recursive:true});writeFileSync(new URL('runtime-report.json',dir),JSON.stringify({checks:count,results},null,2));
