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

test('fog, grade and vignette set the combine uniforms and turn the chain on alone', () => {
  const f = fixture();
  f.bloom.draw({}, camera, null, frame({
    fog: {on: true, mode: 'linear', color: '#ff0000', density: .02, start: 5, end: 50},
    grade: {on: true, saturation: 1.5, contrast: 1.2, brightness: .8, tint: '#ffffff'},
    vignette: {on: true, strength: .4, radius: .5, softness: .3, color: '#000000'},
  }));
  assert.equal(f.passes.length, 2, 'world and combine; no bloom passes');
  const u = f.passes[1].material.uniforms;
  assert.deepEqual([u.fogMode.value, u.fogStart.value, u.fogEnd.value], [2, 5, 50]);
  assert.deepEqual([u.fogColor.value.r, u.fogColor.value.g, u.fogColor.value.b], [1, 0, 0]);
  assert.deepEqual([u.gradeOn.value, u.saturation.value, u.contrast.value, u.brightness.value], [true, 1.5, 1.2, .8]);
  assert.deepEqual([u.vignetteStrength.value, u.vignetteRadius.value, u.vignetteSoftness.value], [.4, .5, .3]);
  assert.match(f.passes[1].material.fragmentShader, /<tonemapping_fragment>[\s\S]*gradeOn[\s\S]*vignetteStrength[\s\S]*<colorspace_fragment>/, 'grade and vignette follow the tone curve');
  // Switched off the next frame: the uniforms neutralize.
  f.bloom.draw({}, camera, null, frame({fog: {on: false}, grade: {on: false}, vignette: {on: false}, tone: {mode: 'none', exposure: 1}}));
  const off = f.passes.at(-1).material.uniforms;
  assert.deepEqual([off.fogMode.value, off.gradeOn.value, off.vignetteStrength.value], [0, false, 0]);
});

test('fxaa runs after the combine and before extensions', () => {
  const f = fixture();
  f.bloom.draw({}, camera, null, frame({fxaa: true}));
  const [world, combine, aa] = f.passes;
  assert.equal(world.material, 'world');
  assert.ok(combine.target, 'the combine writes the chain when fxaa follows');
  assert.equal(aa.material.uniforms.image.value, combine.target.texture);
  assert.equal(aa.target, null, 'fxaa writes the screen when it is last');
  assert.deepEqual([aa.material.uniforms.pixels.value.x, aa.material.uniforms.pixels.value.y], [1 / 8, 1 / 8]);
  const seen = [];
  f.bloom.draw({}, camera, null, frame({fxaa: true, extensions: [{id: 'e', params: {}, runner: {draw: ctx => { seen.push(ctx); ctx.fullscreen(new THREE.ShaderMaterial(), ctx.output); }}}]}));
  const aa2 = f.passes.find((pass, index) => index > 2 && pass.material?.uniforms?.pixels && !pass.material.uniforms.aoStrength);
  assert.ok(aa2.target, 'fxaa writes the chain when an extension follows');
  assert.equal(seen[0].input, aa2.target.texture, 'the extension reads the antialiased image');
  assert.equal(seen[0].output, null);
});

test('a disabled scene pass clears instead of drawing the world', () => {
  const f = fixture();
  f.bloom.draw({}, camera, () => assert.fail('no overlay without the scene'), frame({scene: false}));
  assert.equal(f.clears(), 1);
  assert.ok(!f.passes.some(pass => pass.material === 'world'));
});

test('experimental destination receives the final world pass with or without bloom, fxaa and extensions',()=>{
 const target=new THREE.WebGLRenderTarget(8,8);
 for(const overrides of [{},{bloom:{on:true,threshold:.55,strength:.75}},{fxaa:true},
  {extensions:[{id:'copy',params:{},runner:{draw:ctx=>ctx.fullscreen(new THREE.ShaderMaterial(),ctx.output)}}]}]){
  const f=fixture();f.bloom.draw({},camera,null,frame(overrides),target);assert.equal(f.passes.at(-1).target,target);f.bloom.dispose();
 }
 target.dispose();
});
