import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {call, cameraOf} from '../plugin.mjs';
import {createScene, decodePng, encodePng, render} from '../tracer.mjs';

const scene = {
  camera: {projection: 'perspective', position: {x: 0, y: 2, z: 5}, target: {x: 0, y: 0, z: 0}, fovDegrees: 50},
  materials: {red: {color: '#ff0000', roughness: 0.5}},
  lighting: {ambient: {intensity: 0.2}, sun: {direction: {x: -0.3, y: -1, z: -0.2}, intensity: 1}},
  entities: [
    {id: 'floor', transform3d: {position: {x: 0, y: -0.5, z: 0}, scale: {x: 6, y: 1, z: 6}}, mesh3d: {asset: 'mesh://primitive/box'}},
    {id: 'ball', transform3d: {position: {x: 0, y: 0.5, z: 0}}, mesh3d: {asset: 'mesh://primitive/sphere', material: 'red'}},
  ],
};
const pixel = (png, x, y) => { const at = (y * png.width + x) * 4; return [png.rgba[at], png.rgba[at + 1], png.rgba[at + 2]]; };

test('PNG encoding round-trips through the decoder', () => {
  const rgb = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
  const png = decodePng(encodePng(2, 2, rgb));
  assert.deepEqual([png.width, png.height], [2, 2]);
  assert.deepEqual(pixel(png, 0, 0), [1, 0, 0]);
  assert.deepEqual(pixel(png, 1, 1), [1, 1, 1]);
});

test('a lit red ball renders red, deterministically for a seed', () => {
  const world = createScene(scene, {mesh: () => { throw new Error('none'); }, texture: () => null, hdr: () => null});
  const options = {width: 24, height: 16, samples: 4, bounces: 1, seed: 3};
  const a = render(world, cameraOf(scene), options), b = render(world, cameraOf(scene), options);
  assert.ok(a.png.equals(b.png), 'the same seed gives the same image');
  const image = decodePng(a.png), [r, g, bl] = pixel(image, 12, 7);
  assert.ok(r > 0.15 && r > g * 3 && r > bl * 3, `the centre is the red ball: ${[r, g, bl]}`);
  assert.equal(a.stats.spheres, 1);
  assert.equal(a.stats.triangles, 12);
});

test('the tool renders the main scene to a PNG', async () => {
  const project = await mkdtemp(join(tmpdir(), 'unone-pathtrace-'));
  await writeFile(join(project, 'project.unone.json'), JSON.stringify({name: 'p', entry_script: 'main.luau', main_scene: 'scene.json'}));
  await writeFile(join(project, 'scene.json'), JSON.stringify(scene));
  const response = await call('pathtrace.render', {width: 16, height: 10, samples: 2, output: 'shot.png'}, project);
  assert.equal(response.ok, true, JSON.stringify(response.diagnostics));
  assert.equal(decodePng(await readFile(join(project, 'shot.png'))).width, 16);
  await writeFile(join(project, 'scene.json'), JSON.stringify({entities: []}));
  assert.equal((await call('pathtrace.render', {}, project)).diagnostics[0].code, 'PATHTRACE_CAMERA_REQUIRED');
});
