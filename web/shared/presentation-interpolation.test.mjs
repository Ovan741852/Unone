import test from 'node:test';
import assert from 'node:assert/strict';
import {createPresentationInterpolator} from './presentation-interpolation.mjs';
const snapshot=(frame,x)=>({observation_digest:'same',world:{frame,entities:{a:{transform3d:{position:{x,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}}},instances3d:{}}});
test('interpolation changes presentation only and snaps after reset',()=>{
 let time=0;const p=createPresentationInterpolator({enabled:true,now:()=>time});
 p.accept(snapshot(0,0));time=1000/60;const canonical=snapshot(1,10),saved=JSON.stringify(canonical);p.accept(canonical);
 time+=1000/120;assert.ok(Math.abs(p.sample().snapshot.world.entities.a.transform3d.position.x-5)<1e-6);
 assert.equal(JSON.stringify(canonical),saved);assert.equal(p.sample({snap:true}).snapshot,canonical);
 p.reset();p.accept(canonical);assert.equal(p.sample().snapshot.world.entities.a.transform3d.position.x,10);
});
