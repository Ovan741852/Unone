import assert from 'node:assert/strict';
import {module,payload,loadProject,readObservation,tick} from './runtime-harness.mjs';
const checks=`
function Game.start(api:any)
 apiRef=api;local checks=0
 local function check(ok:boolean,label:string) assert(ok,label);checks+=1 end
 local function rolls(n:number)apiRef={random={nextFloat=function()return n end},save=api.save}end
 reset();check(S.coins==320 and S.crystals==18,"starting purses")
 check(not payCrystals(19) and S.coins==320 and S.crystals==18,"no gold fallback")
 check(payCrystals(12) and S.coins==320 and S.crystals==6,"upgrade paid with crystals")
 check(pay(32) and S.coins==288 and S.crystals==6,"potion paid with gold")
 local function launch()S.phase="battle";S.aimX=0;S.aimZ=0;fire();local t=troops[#troops];t.skills.critChance=0;return t end
 reset();addItem(gearCatalog[1],12);S.worn[1][5]=1;local t=launch()
 check(t.paid==5 and S.coins==315 and S.crystals==18,"equipped deployment includes half-price quote")
 settleSurvivors();check(S.coins==320 and S.crystals==18,"survivor refunds gold only")
 local function monster(rank:number)return {id=100,rank=rank,x=0,z=0,guard=1,damage=0,alive=true,scale=1,slow=0,flash=0,angle=0,turn=100,breaks=0,name="currency fixture"}end
 for rank=1,5 do reset();local unit=launch();rolls(.99);hit(monster(rank),100,unit)
  check(S.crystals==18 and S.crystalProgress==0 and S.earned==0,"failed lottery grants nothing")end
 reset();t=launch();rolls(0)
 for i=1,4 do hit(monster(1),100,t)end
 check(S.crystals==19 and S.earned==64,"four successful small awards make one crystal")
 for round=1,7 do
  reset();S.round=round;S.phase="battle";rolls(0)
  for i=1,60 do awardCrystals(5,4,1)end
  local cap=12+(round-1)*4
  check(S.roundCrystalEarned==cap and S.crystals==18+cap,"round crystal cap")
  win();settleSurvivors();local balance=S.crystals;settleSurvivors()
  check(balance==18+cap+6+(round-1)*2 and S.crystals==balance,"clear bonus exactly once")
 end
 reset();S.phase="battle";S.time=0;S.phase="defeat";settleSurvivors()
 check(S.crystals==18 and S.roundCrystalBonus==0,"defeat does not grant clear crystals")
 S.crystals=99;reset();check(S.crystals==18 and S.crystalEarned==0 and S.crystalSpent==0,"new run clears resources")
 apiRef=api;reset();publish(api);api.observation.set("currency_checks",checks)
end
`;
loadProject(module,{...payload,script:payload.script.replace('return Game',checks+'\nreturn Game')},42n);
console.log('PASS '+readObservation(module).world.observations.currency_checks+' actual Luau resource checks');
function fixture(code){loadProject(module,{...payload,script:payload.script.replace('return Game',`local oldStart=Game.start\nfunction Game.start(api:any)oldStart(api);${code};publish(api)end\nreturn Game`)},42n)}
function press(action){tick({actions:{[action]:true}});return tick({});}
fixture('S.phase="shop";S.location="market";stockShop()');
const price=Object.values(readObservation(module).world.observations.game.stock)[0].price;
let s=press('Buy1');assert.equal(s.coins,320);assert.equal(s.crystals,18-price);assert.equal(s.items[0].paid,price);
s=press('Sell1');assert.equal(s.coins,320);assert.equal(s.crystals,18-price+Math.floor(price/2));assert.equal(s.crystalSold,Math.floor(price/2));
fixture('S.phase="shop";S.location="rune";stockShop()');
const rune=Object.values(readObservation(module).world.observations.game.stock)[0];
s=press('Buy1');assert.equal(s.crystals,18-rune.price);assert.equal(s.coins,320);s=press('LeaveShop');
s=press('Rune'+rune.value);assert.equal(s.crystals,18-rune.price);press('RuneOff');s=press('Rune'+rune.value);assert.equal(s.crystals,18-rune.price,'owned rune equip is free');
fixture('S.phase="shop";S.location="tech";stockShop()');s=press('Buy1');assert.equal(s.crystals,11);s=press('Buy2');assert.equal(s.crystals,11,'research once per visit');
fixture('S.phase="shop";S.location="enchant";addItem(gearCatalog[1],0);S.worn[1][5]=1;stockShop()');s=press('Enchant');assert.equal(s.crystals,10);s=press('KeepEnchant');assert.equal(s.crystals,10,'keeping old enchant does not refund');
fixture('S.phase="shop";S.location="market";stockShop();S.crystals=0;S.crystalSpent=18');s=press('Buy1');assert.equal(s.coins,320);assert.equal(Object.keys(s.items).length,0);s=press('RefreshShop');assert.equal(s.coins,320);assert.equal(s.refreshCount,0);
fixture('S.phase="shop";S.location="potion";stockShop();S.coins=0;S.shopSpent=320');s=press('Buy1');assert.equal(s.crystals,18);assert.equal(Object.keys(s.potions).length,0);
fixture('S.phase="shop";S.location="market";stockShop()');
for(const [count,balance,next]of [[1,16,4],[2,12,6],[3,6,8]]){s=press('RefreshShop');assert.equal(s.crystals,balance);assert.equal(s.refreshCount,count);assert.equal(s.refreshCost,next);}
const unchanged=JSON.stringify(s.stock);s=press('RefreshShop');assert.equal(s.crystals,6);assert.equal(s.refreshCount,3);assert.equal(JSON.stringify(s.stock),unchanged,'unaffordable reroll must not replace stock');
s=press('UI_home');s=press('UI_home');assert.equal(s.refreshCost,8,'navigating UI must not reset the fee');
fixture('S.phase="shop";S.location="market";stockShop();grantCrystals(100)');
let expected=118;for(let i=1;i<=8;i++){expected-=2*i;s=press('RefreshShop');assert.equal(s.crystals,expected);assert.equal(s.refreshCount,i);assert.equal(s.refreshCost,2*(i+1));}
fixture('S.phase="shop";S.location="market";stockShop();S.refreshCount=8;stockShop()');
s=press('RefreshShop');assert.equal(s.crystals,16);assert.equal(s.refreshCount,1);assert.equal(s.refreshCost,4,'new shop visit resets the price');
console.log('PASS actual semantic actions: buy/sell/rune/tech/enchant/refresh; insufficient resources never use the other purse.');
