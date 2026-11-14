import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.player.min.js';
import {createMeshEntityRenderer} from './mesh-entities.js';
import {createLighting} from './lighting.js';

const t = x => ({position: {x, y: 0, z: 0}, rotation: {x: 0, y: 0, z: 0}, scale: {x: 1, y: 1, z: 1}});
const world = materials => ({
  materials,
  entities: {
    plain: {mesh3d: {asset: 'mesh://primitive/box', visible: true}, transform3d: t(0)},
    gold1: {mesh3d: {asset: 'mesh://primitive/box', visible: true, material: 'gold'}, transform3d: t(1)},
    gold2: {mesh3d: {asset: 'mesh://primitive/box', visible: true, material: 'gold'}, transform3d: t(2)},
  },
});
const gold = {color: '#ffcc55', metallic: 1, roughness: 0.3, emissive: '#000000', emissive_intensity: 1};

test('a material batches separately and shades physically when the scene is lit', () => {
  const scene = new THREE.Scene(), group = new THREE.Group();
  const lighting = createLighting(THREE, null, group);
  const meshes = createMeshEntityRenderer(THREE, scene, () => ({geometry: null}), lighting);
  lighting.apply({ambient: {color: '#ffffff', intensity: 0.3}, sun: {direction: {x: 0, y: -1, z: 0}, color: '#ffffff', intensity: 1}}, null);
  meshes.draw(world({gold}), true, new Map());
  assert.equal(meshes.batches, 2, 'plain and gold boxes are two batches');
  const [plain, golden] = [...scene.children].sort((a, b) => a.count - b.count);
  assert.equal(plain.material.type, 'MeshLambertMaterial');
  assert.equal(golden.count, 2);
  assert.equal(golden.material.type, 'MeshStandardMaterial');
  assert.deepEqual([golden.material.metalness, golden.material.roughness], [1, 0.3]);
  assert.equal(golden.material.color.getHexString(), 'ffcc55');
  // Unlit: the colour alone, on a basic material; a later material.set retunes it.
  lighting.apply(null, null);
  meshes.draw(world({gold: {...gold, color: '#ff0000'}}), true, new Map());
  assert.equal(golden.material.type, 'MeshBasicMaterial');
  assert.equal(golden.material.color.getHexString(), 'ff0000');
  meshes.clear();
  assert.equal(scene.children.length, 0);
});
