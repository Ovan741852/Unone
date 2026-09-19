import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {module,payload,loadProject,readObservation,tick} from './runtime-harness.mjs';
const fixture=readFileSync(new URL('element-fixtures.luau',import.meta.url),'utf8');
loadProject(module,{...payload,script:payload.script.replace('return Game',fixture+'\nreturn Game')},42n);
const checks=readObservation(module).world.observations.element_checks;assert.ok(checks>=45);console.log('PASS',checks,'element reaction/trigger assertions in actual WASM');
const reports=[];
for(const build of [['ember_trail','slick_oil','oil_legacy'],['rain_strike','storm_touch','pierce']]){
 const script=payload.script.replace('local function beginBattle()',`local function beginBattle()\nS.selected=3;S.skillSources[3]={${build.map(id=>`{id="${id}"}`).join(',')}}`);
 loadProject(module,{...payload,script},42n);tick({actions:{Start:true}});for(let i=0;i<92;i++)tick({});tick({actions:{Choice1:true}});tick({});tick({actions:{LeaveShop:true}});tick({});tick({actions:{Mode_auto:true}});tick({});tick({actions:{Auto_apply:true}});
 let s,peak=0;const times=[];for(let i=0;i<900;i++){const before=performance.now();s=tick({});times.push(performance.now()-before);peak=Math.max(peak,Object.values(s.skillRuntime.elements.fields??{}).length);}
 assert.ok(s.fired>0&&s.skillRuntime.elements.reactions>0&&peak>0);tick({actions:{Pause:true}});const frozen=tick({}).skillRuntime;for(let i=0;i<20;i++)s=tick({});assert.deepEqual(s.skillRuntime,frozen);
 times.sort((a,b)=>a-b);const result={build,fired:s.fired,reactions:s.skillRuntime.elements.reactions,triggers:s.skillRuntime.elements.triggers,peakFields:peak,tickP95ms:times[Math.floor(times.length*.95)]};reports.push(result);console.log('PASS normal update with test loadout',result);
}
const out=new URL('../tests/elements/',import.meta.url);mkdirSync(out,{recursive:true});writeFileSync(new URL('runtime-report.json',out),JSON.stringify({checks,reports,scope:'Actual WASM with disclosed in-memory fixtures/loadouts. Timing includes observation serialization; not a device frame-rate guarantee.'},null,2));
