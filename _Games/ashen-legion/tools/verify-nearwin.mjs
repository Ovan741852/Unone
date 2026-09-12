import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {module,payload,loadProject,readObservation} from './runtime-harness.mjs';
import {guardFeedback} from '../presentation/guard-feedback.mjs';
const fixture=`
function Game.start(api:any)
 apiRef=api;local checks=0
 local function check(ok:boolean,label:string)assert(ok,label);checks+=1 end
 local roll=.999;apiRef={random={nextFloat=function()return roll end},save=api.save}
 local function prepare(k:number)
  reset();S.phase="battle";S.selected=k;S.aimX=0;S.aimZ=0;fire();local t=troops[1];t.skills.critChance=0;return t
 end
 local function monster(rank:number)
  return {id=900+rank,rank=rank,x=0,z=0,guard=100,damage=0,alive=true,scale=1,slow=0,flash=0,angle=0,turn=100,breaks=0,name="nearwin fixture"}
 end
 reset();check(costs(1)==4 and costs(2)==10 and costs(3)==20,"half-price baseline")
 S.skillSources[1]={{id="pierce"}};check(costs(1)==5,"halve complete equipped quote")
 S.skillSources[1]={{id="critical"}};check(costs(1)==5,"round odd complete quote upward")
 local t=prepare(3);local paid=t.paid;settleSurvivors();settleSurvivors();check(paid==20 and S.refunded==20 and S.coins==320,"refund discounted historical paid once")
 for rank=1,5 do
  t=prepare(1);local m=monster(rank);roll=.999
  hit(m,75,t);check(m.alive and m.damage==75 and S.breaks==0,"progress is actual damage before attempt")
  hit(m,25,t);check(m.alive and m.damage==0 and m.breaks==1 and S.lotteryMisses==1,"miss retains monster and resets guard")
  check(S.kills==0 and S.earned==0 and S.crystals==18 and S.streaks[1].count==0,"miss gives no kill prize crystal or streak")
  for i=1,50 do hit(m,100,t)end
  check(m.alive and m.breaks==51 and S.lotteryMisses==51 and S.kills==0,"repeated misses do not force a prize or kill")
  check(#S.lotteryResults==40,"bounded result receipts")
 end
 for rank=1,2 do
  t=prepare(1);local m=monster(rank);roll=baseAwardChances[rank]*economyTuning.awardScale
  hit(m,100,t);check(m.alive and S.lotteryMisses==1,"probability boundary misses")
  roll=0;hit(m,100,t);check(not m.alive and S.kills==1 and S.earned==({16,28})[rank],"small dies only after actual award")
 end
 t=prepare(1);local m=monster(1);roll=.999;contactHit(t,m)
 check(not t.alive and m.alive and S.contactDeaths==1,"sword contact death independent of surviving monster")
 t=prepare(1);m=monster(1);m.guard=1;t.skills.frenzy=1;t.skills.killLife=.25;roll=.999
 hit(m,100,t);check(t.life==baseLife[1] and S.streaks[1].count==0,"miss cannot trigger kill skills")
 apiRef=api;reset();publish(api);api.observation.set("nearwin_checks",checks)
end
`;
loadProject(module,{...payload,script:payload.script.replace('return Game',fixture+'\nreturn Game')},42n);
const count=readObservation(module).world.observations.nearwin_checks;assert.ok(count>=35);
const monster={id:1,damage:75,guard:100,guardProgress:.75};let s={rewardClock:1,lotteryResults:[],economyTuning:{nearBreak:.7}};
assert.equal(guardFeedback(monster,s).label,'即將破防');assert.equal(guardFeedback({...monster,damage:0,guardProgress:0},s).near,false);
s.lotteryResults=[{monsterId:1,won:false,time:.5}];assert.equal(guardFeedback({...monster,guardProgress:0},s).label,'未開獎');
assert.equal(guardFeedback(monster,s).label,'即將破防','new true progress takes precedence over old failure');
s.rewardClock=2;assert.equal(guardFeedback({...monster,guardProgress:0},s).label,'破防','failure display expires');
writeFileSync(new URL('../tests/nearwin-contract.json',import.meta.url),JSON.stringify({ok:true,luauChecks:count,guardChecks:5,scope:'Isolated actual WASM rules with disclosed controlled RNG; presentation reads actual progress. Not probability or balance evidence.'},null,2));console.log('PASS '+count+' Luau checks + 5 guard-feedback checks');
