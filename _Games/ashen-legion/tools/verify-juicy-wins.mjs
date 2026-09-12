import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {module,payload,loadProject,readObservation,tick} from './runtime-harness.mjs';
const reports=[];
// Isolated fixture: force a known successful boss award through the real hit
// function. Production RNG, saves and downloadable payload remain untouched.
for(const [tier,round]of [[4,1],[4,7],[3,1]]){
 const setup=`
function Game.start(api:any)
 apiRef=api;reset();S.round=${round};beginBattle();S.time=17
 S.selected=1;fire();local striker=troops[1];striker.skills.critChance=0
 cooldown=0;S.selected=3;fire()
 addMonster(5,0,0);local boss=monsters[#monsters];boss.guard=1
 apiRef={random={nextFloat=function()return ${tier===4?0:.1} end},save=api.save}
 contactHit(striker,boss);settleSurvivors();apiRef=api
 publish(api)
end
`;
 loadProject(module,{...payload,script:payload.script.replace('return Game',setup+'\nreturn Game')},42n);
 let snap=readObservation(module),s=snap.world.observations.game;
 assert.equal(s.phase,'celebration');assert.equal(s.roundOutro.tier,tier);assert.equal(s.roundRefund,20);assert.equal(s.contactDeaths,1);
 const initial={coins:s.coins,refunded:s.refunded,crystals:s.crystals,chestCount:s.chestCount,spent:s.spent,fired:s.fired,event:s.event,time:s.time};
 const checkMoney=()=>{for(const [k,v]of Object.entries(initial))assert.equal(s[k],v,k+' changed during ceremony');};
 s=tick({actions:{Home:true,Start:true,Next:true,OpenChest:true,Mode_auto:true,Space:true}});s=tick({});checkMoney();assert.equal(s.phase,'celebration');
 s=tick({actions:{Pause:true}});s=tick({});assert.equal(s.paused,true);const held=s.roundOutro.elapsed;
 for(let n=0;n<60;n++)s=tick({});assert.equal(s.roundOutro.elapsed,held);checkMoney();
 snap=readObservation(module);assert.ok(JSON.stringify(snap.world.ui).includes('outro_resume'),'pause offers resume');
 s=tick({actions:{Pause:true}});s=tick({});assert.equal(s.paused,false);
 let ticks=0;
 while(s.phase==='celebration'&&ticks++<450){
  snap=readObservation(module);assert.ok(!JSON.stringify(snap.world.ui).includes('result_earned'),'result cannot show during ceremony');
  s=tick({});checkMoney();
 }
 assert.equal(s.phase,round===7?'victory':'clear');assert.equal(s.roundOutro.elapsed,s.roundOutro.duration);assert.equal(s.presentationDelay,0);
 s=tick({});snap=readObservation(module);assert.ok(JSON.stringify(snap.world.ui).includes('result_earned'));checkMoney();
 for(let n=0;n<30;n++)s=tick({});checkMoney();
 if(round===1){s=tick({actions:{Next:true}});s=tick({});assert.equal(s.round,2);assert.equal(s.phase,'map');}
 else {s=tick({actions:{Start:true}});s=tick({});assert.equal(s.round,1);assert.equal(s.phase,'map');assert.equal(s.event,0);}
 reports.push({tier,round,duration:tier===4?6.4:3.3,initial,pauseAndInputGate:true,resultAfterCeremony:true});
 console.log('PASS actual WASM outro, pause, one-time refund/award and progression: tier '+tier+' round '+round);
}
writeFileSync(new URL('../tests/juicy-wins-contract.json',import.meta.url),JSON.stringify({ok:true,scope:'Disclosed forced award through actual WASM hit logic; no change to production chances',reports},null,2));
