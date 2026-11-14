import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.player.min.js';
import {createLighting, MAX_POINT_LIGHTS} from './lighting.js';

const fixture = () => {
  const world = new THREE.Group(), renderer = {shadowMap: {enabled: false, type: null}};
  return {world, renderer, lighting: createLighting(THREE, renderer, world)};
};
const lights = (world, type) => world.children.filter(child => child.type === type);
const camera3d = {position: {x: 0, y: 5, z: 10}, target: {x: 1, y: 0, z: 2}, fov_degrees: 50};

test('an unlit snapshot shows no light and keeps basic materials', () => {
  const {world, lighting} = fixture();
  assert.equal(lighting.apply(null, camera3d).lit, false);
  assert.ok(world.children.every(child => !child.visible));
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const unlit = mesh.material, lit = new THREE.MeshLambertMaterial();
  lighting.dress(mesh, unlit, lit);
  assert.equal(mesh.material, unlit);
  assert.equal(mesh.castShadow, false);
});

test('intensities scale by pi so 1 is full light, and point falloff uses range with decay 0', () => {
  const {world, lighting} = fixture();
  lighting.apply({ambient: {color: '#ff0000', intensity: 0.5},
    points: [{position: {x: 1, y: 2, z: 3}, color: '#ffffff', intensity: 2, range: 7}]}, camera3d);
  const [ambient] = lights(world, 'AmbientLight');
  assert.equal(ambient.visible, true);
  assert.equal(ambient.intensity, 0.5 * Math.PI);
  assert.deepEqual([ambient.color.r, ambient.color.g, ambient.color.b], [1, 0, 0]);
  const points = lights(world, 'PointLight');
  assert.equal(points.length, MAX_POINT_LIGHTS);
  assert.deepEqual(points.map(point => point.visible), [true, false, false, false, false, false, false, false]);
  assert.deepEqual([points[0].intensity, points[0].distance, points[0].decay], [2 * Math.PI, 7, 0]);
  assert.equal(lights(world, 'DirectionalLight')[0].visible, false, 'no sun declared');
});

test('the sun frames a shadow box around the camera target and lit meshes cast and receive', () => {
  const {world, renderer, lighting} = fixture();
  assert.equal(renderer.shadowMap.enabled, true);
  const state = lighting.apply({ambient: {color: '#ffffff', intensity: 0.3},
    sun: {direction: {x: 0, y: -2, z: 0}, color: '#ffffff', intensity: 1, shadows: {size: 1024, distance: 15, bias: 0.002}}}, camera3d);
  assert.deepEqual([state.lit, state.shadows], [true, true]);
  const [sun] = lights(world, 'DirectionalLight');
  assert.deepEqual([sun.target.position.x, sun.target.position.y, sun.target.position.z], [1, 0, 2]);
  assert.deepEqual([sun.position.x, sun.position.y, sun.position.z], [1, 30, 2], 'two box widths back along the light');
  const camera = sun.shadow.camera;
  assert.deepEqual([camera.left, camera.right, camera.top, camera.bottom, camera.near, camera.far], [-15, 15, 15, -15, 0, 60]);
  assert.deepEqual([sun.castShadow, sun.shadow.mapSize.x, sun.shadow.bias], [true, 1024, -0.002]);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()), lit = new THREE.MeshLambertMaterial();
  lighting.dress(mesh, mesh.material, lit);
  assert.deepEqual([mesh.material, mesh.castShadow, mesh.receiveShadow], [lit, true, true]);
  // Shadows off: the sun still lights, nothing casts.
  lighting.apply({ambient: {color: '#ffffff', intensity: 0.3}, sun: {direction: {x: 0, y: -1, z: 0}, color: '#ffffff', intensity: 1}}, camera3d);
  lighting.dress(mesh, mesh.material, lit);
  assert.deepEqual([sun.visible, sun.castShadow, mesh.castShadow], [true, false, false]);
});
