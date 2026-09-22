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
  renderer.draw([]);
  assert.equal(renderer.count,0);
  assert.equal(renderer.drawCalls,0);
  renderer.dispose();
  assert.equal(meshes.size,0);
});
