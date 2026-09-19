import assert from 'node:assert/strict';
import {module,payload,loadProject,readObservation,tick} from './runtime-harness.mjs';
const fixture=code=>loadProject(module,{...payload,script:payload.script.replace('return Game',`local oldStart=Game.start\nfunction Game.start(api:any)oldStart(api);${code};publish(api)end\nreturn Game`)},42n);
const state=()=>readObservation(module).world.observations.game;
const press=a=>{tick({actions:{[a]:true}});return tick({})};
for(const place of ['market','rune','potion','tech','enchant','curse']){
 fixture(`S.phase="shop";S.location="${place}";stockShop();addItem(gearCatalog[1],0);S.worn[1][5]=1`);
 const old=state(),coins=old.coins,crystals=old.crystals,worn=JSON.stringify(old.worn);
 const s=press('QuickDeploy');assert.equal(s.phase,'battle',place+' direct deploy');
 assert.equal(s.coins,coins);assert.equal(s.crystals,crystals);assert.equal(JSON.stringify(s.worn),worn);
}
fixture('S.phase="shop";S.location="market";stockShop()');press('ShopDetail1');assert.equal(press('QuickDeploy').phase,'shop','detail captures navigation');
press('ShopDetailClose');assert.equal(press('LeaveShop').phase,'loadout','preparation path retained');assert.equal(press('Deploy').phase,'battle');
fixture('S.phase="shop";S.location="enchant";stockShop();addItem(gearCatalog[1],0);S.worn[1][5]=1');
press('Enchant');assert.ok(state().enchantPending);assert.equal(press('QuickDeploy').phase,'shop');assert.ok(state().enchantPending);
press('KeepEnchant');assert.equal(press('QuickDeploy').phase,'battle');
for(const phase of ['menu','choice','map','clear','defeat']){fixture(`S.phase="${phase}"`);assert.equal(press('QuickDeploy').phase,phase,'no bypass from '+phase);}
fixture('for _,g in ipairs(gearCatalog)do assert(skillSummaries[g.skill],"Missing summary: "..g.skill)end');
console.log('PASS: six direct-deploy locations, preserved equipment/funds, preparation path, modal/enchant/phase guards, complete equipment summaries');
