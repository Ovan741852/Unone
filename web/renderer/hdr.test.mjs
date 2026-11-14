import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.player.min.js';
import {decodeHdr, environmentTexture, createEnvironment} from './hdr.js';

const rgbe = (r, g, b) => {
  const max = Math.max(r, g, b), exponent = Math.floor(Math.log2(max)) + 1, scale = 256 / 2 ** exponent;
  return [Math.floor(r * scale), Math.floor(g * scale), Math.floor(b * scale), exponent + 128];
};
const file = (header, body) => new Uint8Array([...new TextEncoder().encode(header), ...body]).buffer;

test('flat and run-length scanlines decode to linear floats, rows top first', () => {
  const flat = decodeHdr(file('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 1\n', [...rgbe(1, 0.5, 0.25), ...rgbe(4, 0, 0)]));
  assert.deepEqual([flat.width, flat.height], [1, 2]);
  assert.deepEqual([...flat.data], [1, 0.5, 0.25, 1, 4, 0, 0, 1]);
  const rle = decodeHdr(file('#?RGBE\n\n-Y 1 +X 8\n', [2, 2, 0, 8, ...rgbe(2, 1, 0.5).flatMap(value => [136, value])]));
  assert.deepEqual([...rle.data.slice(28, 32)], [2, 1, 0.5, 1]);
  assert.throws(() => decodeHdr(file('P6\n', [])), /not a Radiance/);
  assert.throws(() => decodeHdr(file('#?RADIANCE\n\n+Y 1 +X 1\n', [0, 0, 0, 0])), /orientation/);
  assert.throws(() => decodeHdr(file('#?RADIANCE\n\n-Y 1 +X 2\n', [1, 2, 3])), /ends early/);
});

test('the texture puts the panorama top at v = 1 and the loader checks the asset', () => {
  const texture = environmentTexture(THREE, {width: 1, height: 2, data: new Float32Array([1, 1, 1, 1, 0, 0, 0, 1])});
  assert.equal(texture.image.data[0], 0, 'first row in memory is the bottom (black)');
  assert.equal(texture.image.data[4], THREE.DataUtils.toHalfFloat(1));
  assert.equal(texture.mapping, THREE.EquirectangularReflectionMapping);
  const scene = new THREE.Scene(), environment = createEnvironment(THREE, scene, () => 'unused');
  assert.throws(() => environment.sync({map: 'sky', intensity: 1, rotation: 0, background: false}, new Map([['sky', {kind: 'texture2d', source: 'sky.png'}]])), /ENVIRONMENT_MAP_INVALID/);
  assert.equal(environment.sync(null, new Map()), false);
  assert.equal(scene.environment, null);
});
