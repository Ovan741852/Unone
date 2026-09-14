// Current population regression: production inputs and authoritative WASM only.
import {module,payload,tick,loadProject} from './runtime-harness.mjs';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const results=[];let quiet=false,surge=false;
for(let seed=1;seed<=20&&!(quiet&&surge);seed++){
 loadProject(module,payload,BigInt(seed));const inputs=[];
 const step=input=>{inputs.push(input);return tick(input)};
 step({actions:{Start:true}});for(let i=0;i<91;i++)step({});step({actions:{Choice1:true}});step({});let s=step({actions:{LeaveShop:true}});s=step({});
 assert.equal(s.monsters.length,35);const scheduled=s.hordeAt;
 if(scheduled<0&&quiet||scheduled>=0&&surge)continue;
 if(scheduled>=0){
  while(s.roundDuration-s.time<scheduled-.2)s=step({});
  s=step({actions:{Pause:true}});const time=s.time;
  for(let i=0;i<120;i++)s=step({});assert.equal(s.time,time);assert.equal(s.hordeCount,0);
  s=step({actions:{Pause:true}});
 }
 const end=scheduled>=0?scheduled+1:50;
 while(s.roundDuration-s.time<end){
  s=step({});
  assert.ok(s.monsters.every(m=>Math.abs(m.x)+.4+m.scale*.5<=11.851&&Math.abs(m.z)+.4+m.scale*.5<=11.851),'room between monster contact footprint and stonework');
  assert.ok(s.monsters.filter(m=>m.rank<=2).length<=110,'bounded crowd');
 }
 const count=scheduled>=0?1:0,small=scheduled>=0?110:32;
 assert.equal(s.hordeCount,count);assert.equal(s.monsters.filter(m=>m.rank<=2).length,small);assert.equal(s.bossSpawned,false);
 const name=scheduled>=0?'horde-paused-single-surge':'horde-optional-quiet-round';
 const spec={name,seed,frames:inputs.length,input_sequence:inputs,assertions:[['horde_count',count],['small_count',small],['boss_present',false],['economy_conserved',true]].map(([key,equals])=>({observation:{key,equals}}))};
 writeFileSync(new URL('../tests/'+name+'.test.json',import.meta.url),JSON.stringify(spec,null,2));
 results.push({name,seed,scheduled,small,frames:inputs.length});console.log('PASS',results.at(-1));if(scheduled>=0)surge=true;else quiet=true;
}
assert.ok(quiet&&surge);
writeFileSync(new URL('../tests/crowd-v2.json',import.meta.url),JSON.stringify({ok:true,results},null,2));
