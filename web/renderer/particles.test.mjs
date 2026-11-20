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
test('image particles borrow the sprite texture, keep its aspect and draw sprite_shape until it is ready',()=>{
  const meshes=new Set(),scene={add(m){meshes.add(m);},remove(m){meshes.delete(m);}};
  const heart=new THREE.Texture({width:64,height:32});let ready=false,asked=0,heartDisposed=false;heart.addEventListener('dispose',()=>{heartDisposed=true;});
  const renderer=createParticleRenderer(THREE,scene,{imageTexture:id=>{asked++;return id==='asset://fx/heart'&&ready?heart:null;}});
  const p=x=>({position:{x,y:0,z:0},size:2,color:[1,1,1,1],sprite_shape:'diamond',texture:'asset://fx/heart',additive:false});
  renderer.draw([p(0),p(1)]);
  assert.deepEqual(renderer.debugBatches.filter(b=>b.count>0).map(b=>b.key),['diamond|0|7|7|7|7'],'the silhouette stands in until the image is ready');
  assert.equal(asked,1,'one lookup per image per frame');
  ready=true;renderer.draw([p(0),p(1),{position:{x:0,y:0,z:0},size:1,color:[1,1,1,1],sprite_shape:'ring',additive:true}]);
  assert.deepEqual(renderer.debugBatches.filter(b=>b.count>0).map(b=>b.key).sort(),['image:asset://fx/heart|0|7|7|7|7','ring|1|7|7|7|7']);
  const imageMesh=[...meshes].find(m=>m.material.map===heart);
  assert.ok(imageMesh,'the image is the material map');assert.equal(imageMesh.count,2);
  const m=imageMesh.instanceMatrix.array;
  assert.ok(Math.abs(Math.hypot(m[0],m[1],m[2])-4)<1e-6,'the width follows the 2:1 image');
  assert.ok(Math.abs(Math.hypot(m[4],m[5],m[6])-2)<1e-6,'size is the image height');
  renderer.dispose();
  assert.equal(heartDisposed,false,'a borrowed texture stays owned by the sprite cache');assert.equal(meshes.size,0);
});

test('flipbook cells draw their part of the image with the cell aspect and their clones are released',()=>{
  const meshes=new Set(),scene={add(m){meshes.add(m);},remove(m){meshes.delete(m);}};
  const sheet=new THREE.Texture({width:128,height:64});sheet.flipY=true;let disposedClones=0,sheetDisposed=false;
  sheet.addEventListener('dispose',()=>{sheetDisposed=true;});
  const renderer=createParticleRenderer(THREE,scene,{imageTexture:()=>sheet});
  const p=(x,uv)=>({position:{x,y:0,z:0},size:3,color:[1,1,1,1],sprite_shape:'soft_circle',texture:'asset://fx/sheet',uv,additive:false});
  renderer.draw([p(0,[0,0,.5,.5]),p(1,[.5,.5,.5,.5]),p(2,[0,0,.5,.5])]);
  const live=[...meshes].filter(m=>m.count>0);
  assert.equal(live.length,2,'one batch per cell');
  const first=live.find(m=>m.material.map.offset.x===0),last=live.find(m=>m.material.map.offset.x===.5);
  assert.equal(first.count,2);assert.deepEqual([first.material.map.repeat.x,first.material.map.repeat.y],[.5,.5]);
  assert.equal(first.material.map.offset.y,.5,'the top-left cell sits in the upper half of a flipped image');
  assert.equal(last.material.map.offset.y,0);
  assert.equal(first.material.map.source,sheet.source,'cells share the image source');
  const m=first.instanceMatrix.array;assert.ok(Math.abs(Math.hypot(m[0],m[1],m[2])-6)<1e-6,'a 64x32 cell is twice as wide as tall');
  for(const mesh of live)mesh.material.map.addEventListener('dispose',()=>disposedClones++);
  renderer.dispose();assert.equal(disposedClones,2);assert.equal(sheetDisposed,false);
});
