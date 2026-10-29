import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import {createParticleRenderer} from './particles.js';

test('particle renderer batches instances by authored shape and blend, and releases pooled resources',()=>{
  const meshes=new Set(),scene={add(mesh){meshes.add(mesh);},remove(mesh){meshes.delete(mesh);}};
  const renderer=createParticleRenderer(THREE,scene);
  const particles=[
    {position:{x:0,y:0,z:0},size:1,color:[1,.2,.1,1],rotation:.2,sprite_shape:'diamond',additive:true},
    {position:{x:1,y:0,z:0},size:.5,color:[.2,.8,1,1],rotation:0,sprite_shape:'diamond',additive:true},
    {position:{x:0,y:1,z:0},size:.5,color:[.4,1,.2,1],rotation:0,sprite_shape:'ring',additive:false},
  ];
  renderer.draw(particles,new THREE.PerspectiveCamera());
  assert.equal(renderer.count,3);
  assert.equal(renderer.drawCalls,3);
  assert.equal(meshes.size,3);
  assert.ok([...meshes].every(mesh=>mesh.isInstancedMesh));
  assert.deepEqual(renderer.debugBatches.map(b=>b.key),['diamond|1|7|7|1|1','diamond|1|7|1|6|7','ring|0|7|3|7|1']);
  renderer.draw([]);
  assert.equal(renderer.count,0);
  assert.equal(renderer.drawCalls,0);
  renderer.dispose();
  assert.equal(meshes.size,0);
});

test('particle pool releases instance buffers on growth, idle eviction and idempotent teardown',()=>{
 let built=0,disposed=0,colors=0;const live=new Set();
 class Mesh extends THREE.InstancedMesh{
  constructor(...args){super(...args);built++;this.addEventListener('dispose',()=>disposed++);}
 }
 class Color extends THREE.Color{constructor(...args){super(...args);colors++;}}
 const scene={add:m=>live.add(m),remove:m=>live.delete(m)};
 const renderer=createParticleRenderer({...THREE,InstancedMesh:Mesh,Color},scene);
 const p={position:{x:0,y:0,z:0},size:1,color:[1,1,1,1],sprite_shape:'diamond',additive:true};
 renderer.draw([p]);assert.equal(built,1);
 const firstColors=colors;for(let i=0;i<120;i++)renderer.draw([p]);
 assert.equal(built,1);assert.equal(colors,firstColors,'steady-state draws reuse material tint');
 renderer.draw([p,p,p]);assert.equal(built,2);assert.equal(disposed,1,'grown mesh instanceMatrix is released');
 renderer.draw([]);assert.equal(live.size,1,'short gaps reuse the pool');
 for(let i=1;i<120;i++)renderer.draw([]);
 assert.equal(live.size,0);assert.equal(disposed,2,'inactive historical bins cannot retain GPU buffers indefinitely');
 renderer.draw([p]);assert.equal(built,3);renderer.dispose();renderer.dispose();
 assert.equal(disposed,built);assert.equal(live.size,0);
});

test('active historical peaks obey the aggregate capacity budget and stable small bins do not churn',()=>{
 let built=0,disposed=0;const meshes=new Set();
 class Mesh extends THREE.InstancedMesh{constructor(...args){super(...args);built++;this.addEventListener('dispose',()=>disposed++);}}
 const renderer=createParticleRenderer({...THREE,InstancedMesh:Mesh},{add:m=>meshes.add(m),remove:m=>meshes.delete(m)});
 const colors=Array.from({length:32},(_,i)=>({position:{x:i,y:0,z:0},size:1,color:[(i%8)/7,Math.floor(i/8)/7,1,1],sprite_shape:'diamond',additive:true}));
 for(let peak=0;peak<colors.length;peak++){
  const samples=[...colors,...Array(4095).fill(colors[peak])];renderer.draw(samples);
  const metrics=renderer.metrics();assert.equal(renderer.count,samples.length);
  assert(metrics.capacity<=Math.max(4096,samples.length*4),'historical active peaks cannot accumulate one full buffer per color');
  assert.equal([...meshes].reduce((n,m)=>n+m.count,0),samples.length);
 }
 renderer.draw(colors);assert(renderer.metrics().capacity<=4096);
 const steady={built,disposed,compactions:renderer.metrics().compactions};
 for(let i=0;i<120;i++)renderer.draw(colors);
 assert.deepEqual({built,disposed,compactions:renderer.metrics().compactions},steady,'fixed live bins perform no repeated rebuild or compaction');
 renderer.dispose();assert.equal(disposed,built);assert.equal(renderer.metrics().capacity,0);assert.equal(meshes.size,0);
});
