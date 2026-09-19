import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {module,payload,loadProject,readObservation} from './runtime-harness.mjs';

const fixture=`
function Game.start(api:any)
 apiRef=api;reset();S.phase="battle";S.aimX=0;S.aimZ=0
 S.skillSources[1]={{id="rebound_charge"}};fire()
 local t=troops[1];t.skills.critChance=0;t.x=WALL_X-.02;t.z=1;t.dx=1;t.dz=0
 moveTroop(t,.08)
 assert(t.state=="wall_charge","rebound starts charge state")
 assert(t.bounceCount==1 and t.wallChargeRemaining==t.wallChargeDuration,"bounce and charge begin together")
 local expectedDuration=.8;assert(math.abs(t.wallChargeDuration-expectedDuration)<1e-6,"default charge lasts 0.8 seconds")
 advanceWallCharge(t,t.wallChargeDuration+.01)
 assert(t.state=="wall_surge" and t.wallSurgeRemaining>0,"charge releases into timed surge")
 assert(t.dx<0 and math.abs(math.sqrt(t.dx*t.dx+t.dz*t.dz)-1)<1e-6,"random heading points back into arena and stays normalized")
 local boostedSpeed=troopMovementSpeed(t,0);assert(math.abs(boostedSpeed-13.6)<1e-6,"surge multiplies ground speed by 1.7")
 t.state="run";t.wallSurgeRemaining=0;t.reboundStacks=0
 local baseline={id=1,rank=1,x=0,z=0,guard=10000,damage=0,alive=true,scale=1,slow=0,flash=0}
 hit(baseline,24,t);local normal=S.damageEvents[#S.damageEvents].amount
 t.state="wall_surge";t.wallSurgeRemaining=1;t.wallSurgeDamageBonus=.45
 local surged={id=2,rank=1,x=0,z=0,guard=10000,damage=0,alive=true,scale=1,slow=0,flash=0}
 hit(surged,24,t);local boosted=S.damageEvents[#S.damageEvents].amount
 assert(normal==24 and math.abs(boosted-normal*1.45)<1e-6,"surge increases main-hit damage by 45 percent")
 assert(S.skillTriggers.wall_charge==1,"one skill trigger is recorded for the wall collision")
 publish(api)
 assert(S.visualTroops[1].state=="wall_surge" and S.visualTroops[1].wallSurge>0,"presentation receives charge/surge state")
 api.observation.set("wall_surge_checks",6)
end
`;
loadProject(module,{...payload,script:payload.script.replace('return Game',fixture+'\nreturn Game')},42n);
const checks=readObservation(module).world.observations.wall_surge_checks;
assert.equal(checks,6);
const out=new URL('../tests/rebound-surge/',import.meta.url);mkdirSync(out,{recursive:true});
writeFileSync(new URL('runtime-report.json',out),JSON.stringify({checks,chargeSeconds:.8,surgeSeconds:1.25,surgeSpeedMultiplier:1.7,mainDamageMultiplier:1.45,heading:'random angle constrained inward at collided wall',runtime:'Unone WASM Luau'},null,2));
console.log('PASS',checks,'real Luau wall charge -> random inward surge -> speed / damage checks');
