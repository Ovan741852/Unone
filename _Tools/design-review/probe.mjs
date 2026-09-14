// Review-only reproduction. Production sources and the user's saved town are not edited.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {module,payload,loadProject,readObservation,tick} from '../../_Games/ashen-legion/tools/runtime-harness.mjs';
import * as THREE from '../../_Games/ashen-legion/presentation/vendor/build/three.module.js';
const output=new URL('../../docs/reviews/2026-09-11-gamedesignos/',import.meta.url);
mkdirSync(output,{recursive:true});
const observe=()=>readObservation(module).world.observations.game;
function press(actions){tick({actions});return tick({actions:{}});}
function fixture(code){loadProject(module,{...payload,script:payload.script.replace('return Game',`local originalStart=Game.start\nfunction Game.start(api:any)originalStart(api);${code};publish(api)end\nreturn Game`)},42n);}
loadProject(module,payload,42n);
press({Start:true});for(let i=0;i<94;i++)tick({actions:{}});
assert.equal(observe().phase,'choice');
press({Unit2:true,Build9:true,Choice1:true});
let s=observe();assert.equal(s.location,'market');assert.equal(s.stock[0].skill,'landing_spin');
const before={gold:s.coins,crystals:s.crystals,cost:s.costs[1],loadout:s.loadouts[1]};
const item=structuredClone(s.stock[0]);press({Buy1:true});s=press({Equip1:true});
const after={gold:s.coins,crystals:s.crystals,cost:s.costs[1],loadout:s.loadouts[1]};
const duplicateSpin={scope:'Normal InputFrame actions on unchanged production WASM/Luau, seed 42; not a complete playthrough',actions:['Start','wait 94 frames','Unit2 + Build9 + Choice1','Buy1','Equip1'],item,before,after,unchangedLoadout:JSON.stringify(before.loadout)===JSON.stringify(after.loadout)};
assert.equal(duplicateSpin.unchangedLoadout,true);assert.equal(after.cost-before.cost,6);

fixture(`
 for slot=1,5 do
  local best:any=nil
  for _,def in ipairs(gearCatalog)do if def.slot==slot and (not best or sourcePrices[def.skill]>sourcePrices[best.skill])then best=def end end
  assert(best);addItem(best,0);local item=S.items[#S.items];item.enchant="shock";S.worn[1][slot]=item.id
 end
 S.coins=20;S.shopSpent=300;beginBattle()
`);
s=observe();const bankruptcyBefore={phase:s.phase,gold:s.coins,costs:s.costs,items:s.items,troops:s.troops};
s=tick({actions:{}});s=tick({actions:{}});
const bankruptcy={scope:'Explicit synthetic loadout and low-gold fixture; real updateCombat and economy invariants, not a natural run',before:bankruptcyBefore,after:{phase:s.phase,gold:s.coins,costs:s.costs,message:s.message},otherAffordableUnit:bankruptcyBefore.costs.some(cost=>cost<=bankruptcyBefore.gold)};
assert.equal(bankruptcy.otherAffordableUnit,true);assert.equal(bankruptcy.after.phase,'defeat');

// Feed known scene world points through the current camera and the quick tool's
// literal click formula. This isolates mapping accuracy from bot targeting.
const scene=JSON.parse(readFileSync(new URL('../../_Games/ashen-legion/scene.json',import.meta.url)));
const config=scene.camera3d,camera=new THREE.PerspectiveCamera(config.fov_degrees,16/9,.1,1000);
camera.position.set(config.position.x,config.position.y,config.position.z);
camera.lookAt(config.target.x,config.target.y,config.target.z);camera.updateMatrixWorld();
const appSource=readFileSync(new URL('../fishing-quicktest/app.mjs',import.meta.url),'utf8');
const formula=appSource.match(/function point\(e\)\{[^\n]+\}/)?.[0];assert.ok(formula);
const mapClick=Function('canvas',formula+'; return point;')({getBoundingClientRect:()=>({left:0,top:0,width:1600,height:900})});
const mapping=[{x:5,z:0},{x:10,z:-3},{x:0,z:6}].map(p=>{
 const ndc=new THREE.Vector3(p.x,0,p.z).project(camera);
 const result=mapClick({clientX:(ndc.x+1)*800,clientY:(1-ndc.y)*450});
 return {world:p,projectedNdc:{x:ndc.x,y:ndc.y},quickToolAim:result,error:Math.hypot(result.x-p.x,result.y-p.z)};
});
const report={capturedAt:new Date().toISOString(),scriptHash:createHash('sha256').update(payload.script).digest('hex'),sourceMatchesExport:payload.script===readFileSync(new URL('../../_Games/ashen-legion/main.luau',import.meta.url),'utf8'),duplicateSpin,bankruptcy,quickToolPointer:{scope:'Analytic current scene-camera projection compared with exact app.mjs point() function; not subjective handfeel',camera:config,mapping}};
writeFileSync(new URL('runtime-probes.json',output),JSON.stringify(report,null,2));
console.log(JSON.stringify({scriptHash:report.scriptHash,duplicateSpin:{costBefore:before.cost,costAfter:after.cost,crystalsPaid:before.crystals-after.crystals,unchangedLoadout:duplicateSpin.unchangedLoadout},bankruptcy,mapping},null,2));
