import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {module,payload,loadProject,readObservation} from './runtime-harness.mjs';
import {createTriggerFX} from '../presentation/trigger-fx.mjs';

const fixture=readFileSync(new URL('necromancer-fixtures.luau',import.meta.url),'utf8');
loadProject(module,{...payload,script:payload.script.replace('return Game',fixture+'\nreturn Game')},42n);
const checks=readObservation(module).world.observations.necromancer_checks;
assert.equal(checks,24);
console.log('PASS',checks,'necromancer and grave-bloom assertions in actual Unone WASM');

const calls={ink:0,core:0};
const batch=name=>Object.fromEntries(['line','arc','shard'].map(method=>[method,(...args)=>{calls[name]++;assert.ok(args.slice(0,-2).every(v=>typeof v!=='number'||Number.isFinite(v)),'finite VFX geometry');}]));
const fx=createTriggerFX({ink:batch('ink'),core:batch('core')});
const dash=fx.draw({events:[{id:1,kind:'necromancer',time:2,x:0,z:0,tx:2,tz:0,radius:1}],wraiths:[{id:1,x:1,z:.3,dx:1,dz:0,progress:.5,radius:1.25}],buffs:[]},{time:2.12,reduced:false,budget:4});
assert.equal(dash.ghosts,1);assert.ok(dash.kinds.soul_wraith===1&&dash.events>=1,'dash and birth tell apart a moving spirit');
const burst=fx.draw({events:[{id:2,kind:'necromancer_burst',time:3,x:1,z:0,radius:1.25}],wraiths:[],buffs:[]},{time:3.1,reduced:false,budget:4});
assert.equal(burst.ghosts,0);assert.ok(burst.kinds.necromancer_burst===1&&calls.ink>0&&calls.core>0,'arrival burst renders faceted ink silhouette and spectral core');

const out=new URL('../tests/necromancer/',import.meta.url);mkdirSync(out,{recursive:true});
writeFileSync(new URL('runtime-report.json',out),JSON.stringify({checks,scope:'Actual Unone WASM death/expiry fixtures, real production troop contact and normal break/award route, Lock targeting, caps, pending settlement, anti-recursion and VFX geometry.',rules:{chance:.38,range:5.8,dashSeconds:.34,directDamage:.34,splashDamage:.16,radius:1.25,targetCap:3,ghostCapPerPlayer:6},vfx:{birth:dash,arrival:burst,primitiveCalls:calls}},null,2));
console.log('PASS necromancer dash/burst VFX shares existing fixed GPU batches');
