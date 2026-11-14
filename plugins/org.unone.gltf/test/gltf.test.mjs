import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {call, inspectGltf, readGlb} from '../plugin.mjs';
import {makeGlb} from './make-glb.mjs';

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'unone-gltf-'));
  await writeFile(join(root, 'project.unone.json'), JSON.stringify({name: 'gltf', entry_script: 'main.luau', main_scene: 'scene.json'}));
  await writeFile(join(root, 'scene.json'), JSON.stringify({entities: []}));
  await mkdir(join(root, 'art'));
  await writeFile(join(root, 'art', 'Crate Box.glb'), makeGlb());
  return root;
}
const json = async (root, file) => JSON.parse(await readFile(join(root, file), 'utf8'));

test('the self-test passes', async () => {
  assert.equal((await call('plugin.test')).ok, true);
});

test('inspect reports meshes, triangles, materials in sRGB and what is not read', () => {
  const report = inspectGltf(readGlb(makeGlb()));
  assert.deepEqual(report.meshes, [{name: 'Quad', primitives: 1, triangles: 2}]);
  assert.deepEqual(report.materials[0], {name: 'Paint', color: '#ffbc89', metallic: 0.2, roughness: 0.6, emissive: '#000000', texture: true});
  assert.equal(report.importable, true);
  const draco = inspectGltf(readGlb(makeGlb({extensionsRequired: ['KHR_draco_mesh_compression']})));
  assert.equal(draco.importable, false);
  assert.match(draco.blocked[0], /Draco/);
  assert.throws(() => readGlb(Buffer.from('{"asset":{}}')), /not a binary glTF/);
});

test('plan writes nothing; apply wires the importer, root, assets and a material', async () => {
  const root = await project();
  const planned = await call('gltf.plan', {path: 'art/Crate Box.glb'}, root);
  assert.equal(planned.value.writes, false);
  assert.deepEqual(planned.value.assets.map(asset => asset.id), ['mesh://crate-box', 'texture://crate-box']);
  await assert.rejects(readFile(join(root, 'import/unone-gltf.luau')));

  const applied = await call('gltf.apply', {path: 'art/Crate Box.glb'}, root);
  assert.equal(applied.ok, true, JSON.stringify(applied.diagnostics));
  assert.ok((await readFile(join(root, 'import/unone-gltf.luau'), 'utf8')).includes('GLTF_IMPORT_FAILED'));
  const config = await json(root, 'project.unone.json');
  assert.deepEqual(config.import.importers['unone.gltf.mesh'], {module: 'import/unone-gltf.luau', node: 'mesh'});
  assert.equal(config.asset_manifest, 'assets.json');
  const manifest = await json(root, 'assets.json');
  assert.deepEqual(manifest.assets[0].import, {importer: 'unone.gltf.mesh', product: 'mesh', inputs: {model: 'models:Crate Box.glb'}, params: {texture: 'texture://crate-box'}});
  assert.equal(manifest.assets[1].source, 'assets/imported/crate-box.png');
  assert.equal((await json(root, '.unone/import-roots.json')).models, join(root, 'art').split('\\').join('/'));
  assert.deepEqual((await json(root, 'scene.json')).materials['crate-box'], {color: '#ffbc89', metallic: 0.2, roughness: 0.6});
  const again = await call('gltf.apply', {path: 'art/Crate Box.glb'}, root);
  assert.equal(again.diagnostics[0].code, 'GLTF_ASSET_EXISTS');
  assert.equal((await call('gltf.apply', {path: 'art/Crate Box.glb', name: 'crate2'}, root)).ok, true, 'a second name imports again under the same root');
});
