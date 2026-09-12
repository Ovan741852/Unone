import {module,payload,tick,loadProject,readObservation} from './runtime-harness.mjs';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
// Compare today's rules with/without receipt instrumentation, so intentional
// economy changes do not masquerade as visual regressions.
const baseline={...payload,script:payload.script.replace(/\n S\.damageEvent\+=1[\s\S]*?if #S\.damageEvents>128 then table\.remove\(S\.damageEvents,1\)end\n/,'\n')};
assert.notEqual(baseline.script,payload.script,'receipt control must remove the instrumentation');
const keys=['coins','earned','spent','kills','breaks','criticalHits','contactHits','piercesUsed','spinHits','lotteryMisses','rankEconomy','refunded','crystals','phase','time'];
const stats=s=>Object.fromEntries(keys.map(k=>[k,s[k]]));
const input=i=>({actions:i===0?{Start:true}:i===95?{Choice1:true}:i===98?{LeaveShop:true}:i===102?{Mode_auto:true}:i===106?{Auto_apply:true}:i===510?{Unit2:true}:i===850?{Unit3:true}:{}});
const reports=[];
for(const seed of [1,42]){
 loadProject(module,baseline,BigInt(seed));const expected=[];for(let i=0;i<1300;i++){const s=tick(input(i));if(i%10===0||i===1299)expected.push(stats(s));}
 loadProject(module,payload,BigInt(seed));let last=0,critical=0,total=0,shots=0,index=0;const amounts=[0,0,0,0,0];
 for(let i=0;i<1300;i++){
  const s=tick(input(i));if(i%10===0||i===1299)assert.deepEqual(stats(s),expected[index++],`parity seed ${seed} frame ${i}`);
  for(const e of Object.values(s.damageEvents??{}))if(e.id>last){assert.equal(e.id,last+1,'no duplicate or missing receipt');last=e.id;assert.ok(Number.isFinite(e.amount)&&e.amount>0);assert.equal(typeof e.critical,'boolean');assert.equal(typeof e.secondary,'boolean');assert.ok(e.time<=s.rewardClock);amounts[e.rank-1]+=e.amount;total+=e.amount;if(e.critical)critical++;}
  assert.ok(Object.values(s.damageEvents??{}).length<=128);shots=s.fired;
 }
 const s=readObservation(module).world.observations.game;assert.equal(critical,s.criticalHits);assert.ok(critical>0);assert.ok(s.lotteryMisses>0);
 amounts.forEach((n,i)=>assert.ok(Math.abs(n-s.rankEconomy[i].damage)<1e-6));
 reports.push({seed,hits:last,criticals:critical,totalDamage:total,fired:shots,lotteryMisses:s.lotteryMisses,parity:true});console.log('PASS damage receipts / economy parity '+JSON.stringify(reports.at(-1)));
 tick({actions:{Pause:true}});for(let i=0;i<5;i++)tick({});const paused=readObservation(module).world.observations.game;for(let i=0;i<30;i++)tick({});assert.deepEqual(readObservation(module).world.observations.game.damageEvents,paused.damageEvents);
 tick({actions:{Home:true}});tick({});tick({});assert.equal(readObservation(module).world.observations.game.damageEvent,0);assert.equal(Object.values(readObservation(module).world.observations.game.damageEvents).length,0);
}
writeFileSync(new URL('../tests/hit-receipts.json',import.meta.url),JSON.stringify({ok:true,scope:'Current production rules with/without observational hit receipts; identical inputs; conservation each frame; receipt amounts equal actual applied damage, with lottery misses',reports},null,2));
