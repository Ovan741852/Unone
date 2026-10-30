import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from '../vendor/three/three.player.min.js';
import {createMeshEntityRenderer} from './mesh-entities.js';
const source=await readFile(new URL('./three.js',import.meta.url),'utf8');
function body(start,end){const at=source.indexOf(start),until=source.indexOf(end,at);assert(at>=0&&until>at);return source.slice(at,until);}
const pruneSprites=new Function('records','alive','world','root',body('    for (const [id, record] of records) {','    shaderMaterials.retain('));

test('production sprite synchronization releases despawned entities and preserves temporarily hidden sprites',()=>{
 const records=new Map(),attached=new Set();let disposed=0;
 const root={remove:mesh=>attached.delete(mesh)};
 for(let i=0;i<500;i++){
  const id='spawn-'+i,mesh={visible:true},record={mesh,material:{map:{},dispose(){disposed++;}}};records.set(id,record);attached.add(mesh);
  pruneSprites(records,new Set(),{entities:{[id]:{sprite:{visible:false}}}},root);
  assert.equal(records.size,1);assert.equal(disposed,i,'invisible existing entity retains its reusable material');
  pruneSprites(records,new Set(),{entities:{}},root);
  assert.equal(records.size,0);assert.equal(attached.size,0);assert.equal(disposed,i+1);
 }
});

test('mesh entities draw as one instanced batch per asset and release idle batches without touching shared asset meshes',()=>{
 const scene=new THREE.Scene(),assetGeometry=new THREE.BoxGeometry(),assetMaterial=new THREE.MeshBasicMaterial();let assetDisposes=0;
 assetGeometry.addEventListener('dispose',()=>assetDisposes++);assetMaterial.addEventListener('dispose',()=>assetDisposes++);
 const meshes=createMeshEntityRenderer(THREE,scene,id=>id==='actor'?{geometry:assetGeometry,material:assetMaterial}:{geometry:null});
 const t=(x)=>({position:{x,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}),entity=(asset,x,visible=true)=>({mesh3d:{asset,visible},transform3d:t(x)});
 const entities={};for(let i=0;i<300;i++)entities['b'+i]=entity(i%2?'mesh://primitive/sphere':'mesh://primitive/box',i);entities.a=entity('actor',1);entities.hidden=entity('actor',2,false);
 assert.equal(meshes.draw({entities},true,new Map()),false);
 assert.equal(scene.children.length,3);assert.equal(meshes.batches,3);assert.equal(meshes.count,301);
 const box=scene.children.find(m=>m.geometry.type==='BoxGeometry'&&m.material.type==='MeshNormalMaterial');assert.equal(box.count,150);
 assert.equal(box.instanceMatrix.array[12],0);assert.equal(box.instanceMatrix.array[16+12],2,'second box packs its own translation');
 assert.equal(meshes.draw({entities:{p:entity('pending',0)}},true,new Map()),true,'loading asset reports pending');
 for(let i=0;i<=120;i++)meshes.draw({entities:{}},true,new Map());
 assert.equal(scene.children.length,0,'idle batches are released');assert.equal(assetDisposes,0,'asset mesh resources stay with their owner');
 meshes.draw({entities},true,new Map());meshes.clear();assert.equal(scene.children.length,0);assert.equal(assetDisposes,0);
});
