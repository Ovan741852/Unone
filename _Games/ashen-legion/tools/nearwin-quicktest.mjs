import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {module,payload,tick,loadProject,readObservation} from './runtime-harness.mjs';
const before=JSON.parse(readFileSync(new URL('../tests/nearwin-before-project.json',import.meta.url),'utf8'));
const variant=(id,deploy,award)=>({id,project:{...payload,script:payload.script.replace('deployScale=.5,awardScale=.5',`deployScale=${deploy},awardScale=${award}`)}});
const variants=[{id:'before',project:before},variant('survive-only',1,1),variant('half-odds',.5,.5),variant('gentler-odds',.5,.65)];
const report={scope:'24 first-round trials, fresh town, three bare troop policies, seeds 1 and 42. Real production WASM and input, variant source parameters only; no injected money, monsters or forced lotteries. Perfect observation / retarget every 0.2s. This is not player win rate or full 20-minute balance evidence.',runs:[]};
const output=new URL('../tests/nearwin-quicktest.json',import.meta.url);
writeFileSync(output,JSON.stringify(report,null,2));
for(const {id,project}of variants)for(const seed of [1,42])for(const unit of [1,2,3]){
 loadProject(module,project,BigInt(seed));let s=tick({actions:{Start:true}}),frames=0,lastBreaks=0,missRun=0,maxMissRun=0,firstAward=null,lastWin=0,maxGap=0,nearFrames=0,maxMonsters=0,bossReached=false,aim={x:0,y:0},battleFrames=0;
 while(s.phase!=='battle'&&frames++<300){s=tick({actions:s.phase==='choice'?{Choice1:true}:s.phase==='shop'?{LeaveShop:true}:{}});}
 assert.equal(s.phase,'battle');
 for(frames=0;frames<11050&&s.phase==='battle';frames++){
  const all=Object.values(s.monsters??{}),boss=all.filter(m=>m.rank===5),small=all.filter(m=>m.rank<=2),candidates=boss.length?boss:small.length?small:all;
  if(frames%12===0&&candidates.length){candidates.sort((a,b)=>a.x*a.x+(a.z-12.2)**2-(b.x*b.x+(b.z-12.2)**2)||a.id-b.id);aim={x:candidates[0].x,y:candidates[0].z};}
  const actions={['Unit'+unit]:true};if(boss.length){if(!s.lockEnabled)actions.Mode_lock=true;}else if(s.lockEnabled||s.autoEnabled)actions.Mode_manual=true;
  const changing=Boolean(actions.Mode_lock||actions.Mode_manual);
  s=tick({actions,pointer:{position:aim,down:candidates.length>0&&!changing&&!s.fireRearm}});battleFrames++;
  if(frames===180)assert.ok(s.fired>0,'policy must actually deploy troops');
  bossReached||=Boolean(s.bossPresent);maxMonsters=Math.max(maxMonsters,Object.values(s.monsters??{}).length);
  if(Object.values(s.monsters??{}).some(m=>m.damage>=m.guard*.7))nearFrames++;
  const n=s.breaks-lastBreaks;assert.ok(n<=40);if(n){const results=Object.values(s.lotteryResults).slice(-n);for(const r of results){if(r.won){missRun=0;if(r.amount>0){const t=battleFrames/60;if(firstAward===null)firstAward=t;maxGap=Math.max(maxGap,t-lastWin);lastWin=t;}}else maxMissRun=Math.max(maxMissRun,++missRun);}lastBreaks=s.breaks;}
 }
 const raw=readObservation(module).world.observations;for(const key of ['economy_conserved','crystal_conserved','deployment_cost_conserved','troop_count_conserved','troops_in_bounds','lock_exclusive'])assert.equal(raw[key],true,key);
 const row={version:id,sourceHash:createHash('sha256').update(project.script).digest('hex'),seed,unit,status:s.phase==='clear'?'clear':s.phase==='defeat'?(s.time<=0?'timeout':'bankrupt'):'censored',battleSeconds:battleFrames/60,firstAwardSeconds:firstAward,maxAwardGapSeconds:maxGap,unfinishedAwardGapSeconds:battleFrames/60-lastWin,maxConsecutiveMisses:maxMissRun,nearBreakSeconds:nearFrames/60,bossReached,maxMonsters,coins:s.coins,spent:s.spent,earned:s.earned,crystals:s.crystals,refunded:s.refunded,shots:s.fired,breaks:s.breaks,misses:s.lotteryMisses,kills:s.kills,rankEconomy:s.rankEconomy};
 report.runs.push(row);writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({...row,rankEconomy:undefined,sourceHash:undefined}));
}
