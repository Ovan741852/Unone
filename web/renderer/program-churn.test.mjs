import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import {createParticleRenderer} from './particles.js';
import {setSpriteMap} from './three.js';

// Setting material.needsUpdate (or letting three.js do it in its two-pass path for transparent DoubleSide materials)
// makes three.js rebuild that material's program parameters and cache key on its next draw. Doing it for every sprite
// and particle group on every frame cost a 2D game about 1 ms per frame on a desktop CPU.

test('a sprite material is invalidated only when it gains or loses a texture, not when one texture replaces another',()=>{
  const material=new THREE.MeshBasicMaterial({transparent:true}),a=new THREE.Texture(),b=new THREE.Texture();
  let version=material.version;
  setSpriteMap(material,a);assert.ok(material.version>version,'gaining a map changes the program (USE_MAP)');assert.equal(material.map,a);
  version=material.version;
  for(let i=0;i<10;i++)setSpriteMap(material,a);
  setSpriteMap(material,b);assert.equal(material.version,version,'the same or another ready texture is a uniform change');assert.equal(material.map,b);
  setSpriteMap(material,null);assert.ok(material.version>version,'losing the map changes the program again');assert.equal(material.map,null);
});

test('particle groups draw in one pass and an empty group is skipped instead of being set up with no instances',()=>{
  const meshes=new Set(),scene={add(mesh){meshes.add(mesh);},remove(mesh){meshes.delete(mesh);}};
  const renderer=createParticleRenderer(THREE,scene);
  const p={position:{x:0,y:0,z:0},size:1,color:[1,1,1,1],sprite_shape:'diamond',additive:true};
  renderer.draw([p]);
  const [mesh]=[...meshes];
  assert.equal(mesh.material.side,THREE.DoubleSide,'both faces stay visible');
  assert.equal(mesh.material.forceSinglePass,true,'three.js would otherwise draw it twice and flag the material before each pass');
  assert.equal(mesh.visible,true);
  const version=mesh.material.version;
  for(let i=0;i<10;i++)renderer.draw([p]);
  assert.equal(mesh.material.version,version,'steady drawing never invalidates the program');
  renderer.draw([]);
  assert.equal(mesh.count,0);assert.equal(mesh.visible,false,'a group kept for reuse is hidden while it is empty');
  renderer.draw([p]);assert.equal(mesh.visible,true,'and shown again when it has particles');
  renderer.dispose();
});
