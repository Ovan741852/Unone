import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.core.js';
import {createBloom} from './bloom.js';

// A renderer double that records every full-screen pass: its material, the
// target it wrote and the tone mapping in effect.
function fixture() {
  const passes = [], gl = {getExtension: () => null, getParameter: () => false};
  let target = null, clears = 0;
  const renderer = {
    toneMapping: THREE.NoToneMapping, toneMappingExposure: 1,
    getContext: () => gl, getDrawingBufferSize: v => v.set(8, 8),
    setRenderTarget: value => { target = value; }, clear: () => { clears++; },
    render: scene => passes.push({material: scene.children?.[0]?.material ?? 'world', target, toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure}),
  };
  return {bloom: createBloom(THREE, renderer), passes, clears: () => clears};
}
const camera = new THREE.PerspectiveCamera();
const frame = overrides => ({
  ids: [], scene: true, ao: {on: false, strength: 1.7}, bloom: {on: false, threshold: .55, strength: .75},
  tone: null, extensions: [], projected: true, ...overrides,
});

test('declared bloom and tone params drive the shared post chain per frame', () => {
  const f = fixture();
  f.bloom.draw({}, camera, null, frame({bloom: {on: true, threshold: 1.5, strength: 2}, tone: {mode: 'aces', exposure: 0.4}}));
  const combine = f.passes.at(-1);
  assert.equal(f.passes.length, 5, 'world, bright, two blurs, combine');
  assert.equal(f.passes[1].material.uniforms.threshold.value, 1.5);
  assert.equal(combine.material.uniforms.strength.value, 2);
  assert.equal(combine.target, null, 'without extensions the combine writes the screen');
  assert.deepEqual([combine.toneMapping, combine.exposure], [THREE.ACESFilmicToneMapping, 0.4]);
  assert.equal(combine.material.toneMapped, true);
  // The next frame turns tone mapping off: the shader drops it and the renderer state is restored.
  f.bloom.draw({}, camera, null, frame({bloom: {on: true, threshold: .5, strength: 1}}));
  assert.equal(f.passes.at(-1).material.toneMapped, false);
  assert.equal(f.passes.at(-1).toneMapping, THREE.NoToneMapping);
});

test('extension passes chain after the combine and the last one writes the screen', () => {
  const f = fixture(), seen = [];
  const runner = name => ({draw: ctx => { seen.push({name, input: ctx.input, output: ctx.output, params: ctx.params}); ctx.fullscreen(new THREE.ShaderMaterial(), ctx.output); }});
  f.bloom.draw({}, camera, null, frame({extensions: [
    {id: 'a', params: {amount: 0.5}, runner: runner('a')},
    {id: 'b', params: {}, runner: runner('b')},
  ]}));
  const combine = f.passes.find(pass => pass.material?.uniforms?.aoStrength);
  assert.ok(combine.target, 'the combine writes an offscreen target when extensions follow');
  assert.equal(seen[0].input, combine.target.texture, 'the first extension reads the combine result');
  assert.equal(seen[0].params.amount, 0.5);
  assert.ok(seen[0].output && seen[0].output !== combine.target, 'it writes the other chain target');
  assert.equal(seen[1].input, seen[0].output.texture);
  assert.equal(seen[1].output, null, 'the last extension writes the screen');
  assert.equal(f.passes.at(-1).target, null);
});

test('a disabled scene pass clears instead of drawing the world', () => {
  const f = fixture();
  f.bloom.draw({}, camera, () => assert.fail('no overlay without the scene'), frame({scene: false}));
  assert.equal(f.clears(), 1);
  assert.ok(!f.passes.some(pass => pass.material === 'world'));
});
