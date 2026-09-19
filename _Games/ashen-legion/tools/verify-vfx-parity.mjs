import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {module,payload,loadProject,tick,readObservation} from './runtime-harness.mjs';
// The source differs only in presentation metadata. Identical inputs must retain identical outcomes.
const baseline=readFileSync(new URL('../tests/vfx-polish/main-before.luau',import.meta.url),'utf8');
const keys=['phase','round','coins','earned','spent','kills','breaks','time','fired','contactHits','spinHits','piercesUsed','criticalHits','troops','crystals','monsters'];
function run(script,unit){
 // Compare the simulation from a shared battle fixture. The current formal UI
 // has a profile/map route that did not exist in the presentation baseline, so
 // parity must start after that route rather than comparing menu navigation.
 const battleFixture=`
function Game.start(api:any)
 apiRef=api;reset();beginBattle();publish(api)
end
`;
 loadProject(module,{...payload,script:script.replace('return Game',battleFixture+'\nreturn Game')},42n);
 tick({});
 tick({actions:{['Unit'+unit]:true,Mode_auto:true}});
 tick({});
 tick({actions:{Auto_apply:true}});
 const states=[];
 for(let n=0;n<700;n++){const s=tick({});if(n%35===0)states.push(Object.fromEntries(keys.map(k=>[k,s[k]])));}
 return states;
}
for(const unit of [1,2,3])assert.deepEqual(run(payload.script,unit),run(baseline,unit));
const fixture=`
function Game.start(api:any)
 apiRef=api;reset();beginBattle();S.skillSources[2]={{id="wide_blade"}};S.selected=2;fire()
 local t=troops[#troops];t.state="spin";t.spin=.2;effect(0,0,"renew",.6);publish(api)
 assert(S.visualTroops[1].spinRadius==t.skills.spinRadius,"authored spin radius")
 assert(S.visualTroops[1].spinProgress==t.spin/t.skills.spinDuration,"authored spin phase")
 assert(S.visualEffects[1].time==S.rewardClock,"effect clock")
end
`;
loadProject(module,{...payload,script:payload.script.replace('return Game',fixture+'\nreturn Game')},42n);readObservation(module);
writeFileSync(new URL('../tests/vfx-polish/gameplay-parity.json',import.meta.url),JSON.stringify({ok:true,scope:'3 classes × 700 unchanged production ticks; 60 sampled complete gameplay outcomes equal before/after; actual Luau visual receipt assertions',units:3,ticksPerUnit:700},null,2));
console.log('PASS unchanged gameplay outcomes for 3 classes; authoritative spin radius/phase/effect clock');
