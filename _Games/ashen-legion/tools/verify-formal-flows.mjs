// Explicit UI-state fixtures: exercise real Game.update and official input in WASM.
import {module,payload,tick,loadProject,readObservation} from './runtime-harness.mjs';
import assert from 'node:assert/strict';
function fixture(setup){const script=payload.script.replace('return Game',`local originalStart=Game.start\nfunction Game.start(api:any) originalStart(api);${setup};publish(api)end\nreturn Game`);loadProject(module,{...payload,script},42n)}
const actions=()=>readObservation(module).world.ui.children.filter(n=>n.kind==='button').map(n=>n.action);
for(const location of ['potion','tech','curse','enchant']){
 fixture(`S.phase="shop";S.location="${location}";stockShop();addItem(gearCatalog[1],0);S.worn[1][5]=S.items[1].id;S.equipSlot=5`);
 if(location==='enchant'){
  assert.ok(actions().includes('Enchant'));tick({actions:{Enchant:true}});tick({});assert.ok(actions().includes('AcceptEnchant'));assert.ok(!actions().includes('LeaveShop'));tick({actions:{AcceptEnchant:true}});tick({});assert.ok(actions().includes('LeaveShop'));
 }else{
  // The shop is detail-first: open the first stock card, then confirm from
  // the detail modal. Keep the direct Buy1 branch for older fixtures.
  if(actions().includes('ShopDetail1')){tick({actions:{ShopDetail1:true}});tick({});}
  assert.ok(actions().includes('Buy1'));tick({actions:{Buy1:true}});const s=tick({});assert.ok(s.stock[0].sold);
 }
}
fixture('S.phase="clear";S.presentationDelay=0;S.chests={{tier=3,playerId=1}};S.chestCount=1');
assert.ok(actions().includes('OpenChest'));
for(let i=0;i<30;i++)tick({actions:{OpenChest:true}});tick({});assert.equal(readObservation(module).world.observations.game.chestCount,1,'short hold does not open');
for(let i=0;i<62;i++)tick({actions:{OpenChest:true}});tick({});assert.equal(readObservation(module).world.observations.game.chestCount,0);assert.ok(actions().includes('ChestDone'));tick({actions:{ChestDone:true}});tick({});assert.ok(!actions().includes('ChestDone'));
tick({actions:{Next:true}});assert.equal(tick({}).phase,'map');for(let step=0;step<90;step++)tick({});assert.equal(tick({}).phase,'choice');
console.log('PASS explicit UI fixtures: potion/technology/curse purchases, enchant pending/accept, interrupted and full chest hold, claim and next round.');
for(let round=1;round<=7;round++){
 fixture(`S.round=${round};travelToRound()`);
 const initial=tick({}),gold=initial.coins,seconds=initial.battleSeconds;
 assert.equal(initial.phase,'map');assert.equal(Object.keys(initial.cards).length,0);
 for(let i=0;i<40;i++)tick({actions:{Choice1:true,Fire:true}});
 assert.equal(readObservation(module).world.observations.game.phase,'map','cannot choose during travel');
 for(let i=0;i<50;i++)tick({});
 const arrived=tick({});assert.equal(arrived.phase,'choice');assert.equal(arrived.round,round);
 assert.equal(arrived.coins,gold);assert.equal(arrived.battleSeconds,seconds);
 const cards=JSON.stringify(arrived.cards);tick({actions:{ViewMap:true}});tick({});
 tick({actions:{VisitLocation:true}});assert.equal(JSON.stringify(tick({}).cards),cards,'viewing map must not reroll buildings');
}
console.log('PASS all seven arrivals: input gated during travel, no battle time or gold consumed, map return preserves building offers.');
for(const reason of ['timeout','bankrupt']){
 fixture(reason==='timeout'?'S.phase="battle";S.time=.001':'S.phase="battle";S.coins=0;S.shopSpent=320');
 tick({});const lost=tick({});assert.equal(lost.phase,'defeat');assert.ok(lost.message.includes(reason==='timeout'?'時間':'金幣'));
 const frozen=[lost.battleSeconds,lost.earned,lost.spent,lost.kills,lost.refunded];
 for(let i=0;i<100;i++)tick({});
 const settled=tick({});assert.deepEqual([settled.battleSeconds,settled.earned,settled.spent,settled.kills,settled.refunded],frozen);
 assert.ok(actions().includes('ReturnTown'));assert.ok(actions().includes('Start'));
}
console.log('PASS timeout and bankruptcy settlement: frozen real statistics and delayed result actions.');
