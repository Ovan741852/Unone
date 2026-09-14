import assert from 'node:assert/strict';
import {module,payload,tick,loadProject,readObservation} from './runtime-harness.mjs';
const checks=`
function Game.start(api:any)
 apiRef=api;local checks=0
 for unit=1,3 do for _,def in ipairs(gearCatalog)do for context=1,3 do
  reset();S.discount=context==3 and .15 or 0
  if context>=2 then
   addItem({skill="pierce",slot=def.slot,name="old"},0);S.items[1].enchant="recruit";S.worn[unit][def.slot]=S.items[1].id
   S.coins=60;S.curses={{kind=1,remaining=2}};S.runes[unit]=1
  end
  local proposal={id=9000,skill=def.skill,slot=def.slot,paid=0,enchant=context==3 and "critical" or nil}
  local before=costs(unit);local wornId=S.worn[unit][def.slot];local count=#S.items;local coins=S.coins;local crystals=S.crystals
  local quoted=costs(unit,proposal)
  assert(costs(unit)==before and S.worn[unit][def.slot]==wornId and #S.items==count and S.coins==coins and S.crystals==crystals,"preview mutated loadout or money")
  table.insert(S.items,proposal);S.worn[unit][def.slot]=proposal.id
  assert(costs(unit)==quoted,"preview differs from actual equipped cost")
  checks+=2
 end end end
 reset();publish(api);api.observation.set("ui_quote_checks",checks)
end
`;
loadProject(module,{...payload,script:payload.script.replace('return Game',checks+'\nreturn Game')},42n);
console.log('PASS '+readObservation(module).world.observations.ui_quote_checks+' pure equipment quote checks across units, slot replacement, old enchant removal, curse, rune and discount.');
const observation=()=>readObservation(module).world;
const nodes=()=>observation().ui.children;
const press=a=>{tick({actions:{[a]:true}});return tick({});};
function fixture(code){loadProject(module,{...payload,script:payload.script.replace('return Game',`local start=Game.start\nfunction Game.start(api:any)start(api);${code};publish(api)end\nreturn Game`)},42n);}
fixture('S.phase="shop";S.location="market";stockShop()');
const quote=Number(nodes().find(n=>n.id==='stock_cost_1').text.match(/→\s*(\d+)/)[1]);
let s=press('Buy1');const balance=s.crystals,itemId=s.items[0].id;
assert.equal(s.stock[0].itemId,itemId);assert.equal(nodes().find(n=>n.id==='buy_1').action,'Equip1');
s=press('Equip1');assert.equal(s.crystals,balance);assert.equal(s.costs[0],quote);assert.equal(nodes().find(n=>n.id==='buy_1').text,'已穿戴');assert.equal(nodes().find(n=>n.id==='buy_1').kind,'text');
s=press('Buy1');assert.equal(s.crystals,balance);assert.equal(s.items.length,1);
press('UI_gear');assert.ok(!nodes().some(n=>n.id==='gear_prev'));assert.equal(nodes().find(n=>n.id==='sell_1').kind,'text');
fixture('S.phase="shop";S.location="enchant";stockShop()');
assert.equal(nodes().find(n=>n.id==='enchant').action,'UI_gear');assert.ok(!nodes().some(n=>n.action==='Enchant'));
fixture('S.phase="shop";S.location="enchant";stockShop();addItem(gearCatalog[1],0);S.worn[1][5]=S.items[1].id;S.equipSlot=5');
s=press('Enchant');assert.ok(s.enchantPending);assert.ok(nodes().find(n=>n.id==='enchant_help').text.includes(s.items[0].name));
press('UI_gear');assert.equal(observation().ui.node,'shop:home');assert.ok(nodes().some(n=>n.action==='KeepEnchant'));assert.ok(!nodes().some(n=>n.action==='LeaveShop'));
s=press('KeepEnchant');assert.equal(s.crystals,10);assert.ok(nodes().some(n=>n.action==='LeaveShop'));
fixture('S.phase="battle";beginBattle()');
press('Pause');press('UI_guide');assert.ok(nodes().some(n=>n.id==='help_6'));press('UI_home');assert.ok(nodes().some(n=>n.action==='Pause'));s=press('Pause');assert.equal(s.paused,false);
console.log('PASS purchase → direct equip → exact quote, one payment, worn sale disabled, empty enchant route, pending enchant decision, guide → resume.');
