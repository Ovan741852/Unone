import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {module,payload,loadProject,readObservation,tick} from './runtime-harness.mjs';
const values=x=>Object.values(x??{});
const press=key=>{tick({actions:{[key]:true}});return tick({});};
function fixture(setup,seed=42n){
 const script=payload.script.replace('return Game',`function Game.start(api:any)\n apiRef=api;reset();${setup};publish(api)\nend\nreturn Game`);
 loadProject(module,{...payload,script},seed);return tick({});
}
const sets=new Set(),kinds=new Set();let assertions=0;
function check(ok,msg){assert.ok(ok,msg);assertions++;}
// Fixed seed reproducibility and eligibility across every round, with gear for enchanting.
for(let seed=1;seed<=30;seed++)for(let round=1;round<=7;round++){
 const setup=`S.round=${round};addItem(gearCatalog[1],12);offers();S.phase="choice"`;
 let s=fixture(setup,BigInt(seed)),ids=values(s.cards).map(x=>x.id);
 check(ids.length===3&&new Set(ids).size===3,'three unique shops');
 check(round<=5||!ids.includes('curse'),'late curses excluded before payoff becomes impossible');
 if(round===1)sets.add(ids.join(','));ids.forEach(x=>kinds.add(x));
 const again=fixture(setup,BigInt(seed));assert.deepEqual(values(again.cards).map(x=>x.id),ids);assertions++;
}
check(kinds.size===6,'all six specialized destinations reachable');check(sets.size>12,'varied first-round offerings');
let s=fixture('offers();S.phase="choice"');check(!values(s.cards).some(x=>x.id==='enchant'),'no empty-enchantment visit');
s=press('OpenLoadout');check(s.phase==='loadout'&&s.loadoutReturn==='choice','configuration from route');s=press('Deploy');check(s.phase==='loadout','cannot skip visiting a shop');s=press('ReturnFromLoadout');check(s.phase==='choice','return to choices');
for(const [location,kind]of [['market','gear'],['rune','rune'],['potion','potion'],['tech','tech'],['curse','curse'],['enchant',null]]){
 s=fixture(`S.location="${location}";S.phase="shop";stockShop()`);
 check(values(s.stock).every(x=>x.kind===kind),location+' specialized stock');
 if(kind)check(values(s.stock).length>0,location+' has stock');
}
s=fixture('S.location="market";S.phase="shop";stockShop()');
const quote=s.stock[0],gold=s.coins,crystals=s.crystals;s=press('Buy1');
check(s.items.length===1&&s.crystals===crystals-quote.price&&s.coins===gold,'purchase into backpack with crystals');
check(values(s.worn).every(w=>values(w).every(x=>x===0)),'buy never autoequips');
s=press('Equip1');check(values(s.worn).every(w=>values(w).every(x=>x===0)),'shop blocks equip input');
const stock=structuredClone(s.stock);s=press('LeaveShop');check(s.phase==='loadout','shopping advances to configuration');s=press('Equip1');
check(s.worn[0][quote.slot-1]===s.items[0].id,'equip selected troop');s=press('Unit3');s=press('Equip1');
check(s.worn[2][quote.slot-1]===s.items[0].id&&s.worn[0][quote.slot-1]===0,'one owned item transfers between troops');
s=press('ReturnFromLoadout');assert.deepEqual(s.stock,stock);assertions++;
const beforeItems=s.items.length;s=press('Sell1');check(s.items.length===beforeItems,'equipped gear cannot sell');
s=press('LeaveShop');s=press('Slot'+quote.slot);s=press('Unequip');s=press('ReturnFromLoadout');s=press('Sell1');
check(values(s.items).length===0&&s.crystalSold===Math.floor(quote.price/2),'unequip separately then sell in equipment shop');
s=press('LeaveShop');s=press('Deploy');check(s.phase==='battle','explicit deploy starts battle');
// Real production action handlers against a prepared shop: no duplicated rune ownership.
s=fixture('S.location="rune";S.phase="shop";stockShop();S.stock={{kind="rune",value=1,name=runeNames[1],price=6,currency="crystal"}}');const runeStart=s.crystals;
s=press('Buy1');check(s.runeBag[0]===1&&s.crystals===runeStart-6&&values(s.runes).every(x=>x===0),'rune purchase has no auto assignment');
s=press('Rune1');check(values(s.runes).every(x=>x===0),'rune shop cannot assign');
s=press('LeaveShop');s=press('Rune1');check(s.runes[0]===1&&s.runeBag[0]===0,'assign from shared bag');s=press('Unit2');s=press('Rune1');
check(s.runes[0]===0&&s.runes[1]===1&&s.runeBag[0]===0,'transfer rune instead of duplicating');s=press('RuneOff');check(s.runeBag[0]===1&&s.runes[1]===0,'unassign returns rune');
s=press('ReturnFromLoadout');s=press('SellRune1');check(s.runeBag[0]===0&&s.crystals===runeStart-3,'rune resale only bag copy');
s=fixture('S.location="rune";S.phase="shop";stockShop();S.runeBag[1]=3;S.runeBag[2]=1;S.stock={{kind="rune",value=1,name=runeNames[1],price=6,currency="crystal"}}');const capGold=s.crystals;
s=press('Buy1');check(s.runeBag[0]===3&&s.crystals===capGold,'three-copy cap cannot charge');s=press('LeaveShop');s=press('Rune1');s=press('Rune2');
check(s.runeBag[0]===3&&s.runeBag[1]===0&&s.runes[0]===2,'replacement returns old copy');
// Enchant preview must resolve before opening loadout, and the offer is preserved.
s=fixture('addItem(gearCatalog[1],12);S.worn[1][5]=S.items[1].id;S.location="enchant";S.phase="shop";stockShop()');
s=press('Enchant');const pending=structuredClone(s.enchantPending);check(!!pending,'enchant creates offer');s=press('LeaveShop');check(s.phase==='shop','pending enchant blocks departure');s=press('OpenLoadout');assert.deepEqual(s.enchantPending,pending);assertions++;check(s.phase==='shop','pending enchant blocks config');s=press('KeepEnchant');s=press('OpenLoadout');check(s.phase==='loadout','resolved enchant can configure');
const out=new URL('../tests/shop-loadout/',import.meta.url);mkdirSync(out,{recursive:true});writeFileSync(new URL('runtime-report.json',out),JSON.stringify({assertions,seedSamples:30,roundsPerSeed:7,firstRoundVariants:sets.size,shopTypes:[...kinds],scope:'Real exported Luau runtime; prepared fixture inventory for rare economy cases; production input handlers and conservation checked every tick.'},null,2));
console.log('PASS',assertions,'shop/loadout assertions; random unique choices, inventory, rune conservation, preserved stock, deployment');

