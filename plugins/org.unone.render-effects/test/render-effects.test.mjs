import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {call, loadEffects} from '../plugin.mjs';

async function project(config = {name: 'fx', entry_script: 'main.luau'}, presentation) {
  const root = await mkdtemp(join(tmpdir(), 'render-effects-'));
  await writeFile(join(root, 'project.unone.json'), JSON.stringify(config));
  if (presentation) await writeFile(join(root, 'player.presentation.json'), JSON.stringify(presentation));
  return root;
}
const json = async (root, file) => JSON.parse(await readFile(join(root, file), 'utf8'));

test('the self-test loads every module and draws once', async () => {
  const response = await call('plugin.test');
  assert.equal(response.ok, true, JSON.stringify(response.diagnostics));
  assert.equal(response.value.effects, 6);
});

test('every effect lists namespaced kinds, ranges and defaults', async () => {
  const {value} = await call('effects.list');
  assert.deepEqual(value.effects.map(effect => effect.kind), ['fx.crt', 'fx.pixelate', 'fx.grain', 'fx.chromatic', 'fx.posterize', 'fx.ink']);
  for (const effect of value.effects) assert.ok(effect.keywords.length && Object.keys(effect.defaults).length, effect.kind);
});

test('params are clamped and unknown values fall back to the default', async () => {
  const [, pixelate] = await loadEffects();
  const recorded = [];
  const THREE = {ShaderMaterial: class { constructor(o) { Object.assign(this, o); } dispose() {} }, Vector2: class { set(x, y) { this.x = x; this.y = y; } }, Color: class { set() {} }};
  const pass = pixelate.createPass({THREE});
  const draw = params => pass.draw({input: null, output: null, params, width: 10, height: 10, fullscreen: material => recorded.push(material.uniforms.size.value)});
  draw({size: 999}); draw({size: 'big'}); draw({size: 8});
  assert.deepEqual(recorded, [64, 4, 8]);
});

test('plan writes nothing; apply installs modules, extensions and disabled passes', async () => {
  const root = await project({name: 'fx', entry_script: 'main.luau', render_pipeline: {version: 1, passes: [{id: 'world', kind: 'scene'}, {id: 'hud', kind: 'ui'}]}});
  const planned = await call('effects.plan', {effects: ['crt', 'fx.grain']}, root);
  assert.equal(planned.value.writes, false);
  assert.deepEqual(planned.value.files.map(file => [file.path, file.status]), [['render/fx/shared.js', 'new'], ['render/fx/crt.js', 'new'], ['render/fx/grain.js', 'new']]);
  await assert.rejects(readFile(join(root, 'render/fx/crt.js')), 'plan must not write');

  const applied = await call('effects.apply', {effects: ['crt', 'fx.grain']}, root);
  assert.equal(applied.ok, true, JSON.stringify(applied.diagnostics));
  assert.ok((await readFile(join(root, 'render/fx/crt.js'), 'utf8')).includes('fx.crt'));
  const presentation = await json(root, 'player.presentation.json');
  assert.deepEqual(presentation.render_extensions, [
    {kind: 'fx.crt', module: 'render/fx/crt.js', files: ['render/fx/shared.js']},
    {kind: 'fx.grain', module: 'render/fx/grain.js', files: ['render/fx/shared.js']},
  ]);
  const passes = (await json(root, 'project.unone.json')).render_pipeline.passes;
  assert.deepEqual(passes.map(pass => pass.id), ['world', 'crt', 'grain', 'hud'], 'extensions go before ui');
  assert.equal(passes[1].enabled, false);
  assert.deepEqual(passes[1].params, {curvature: 0.15, scanlines: 0.35, mask: 0.2});

  const again = await call('effects.apply', {effects: ['crt']}, root);
  assert.deepEqual(again.effects, [], 'a second apply changes nothing');
});

test('a new pipeline keeps presentation bloom, and edited modules are not overwritten', async () => {
  const root = await project(undefined, {bloom: true});
  await call('effects.apply', {effects: ['ink'], enabled: true}, root);
  const passes = (await json(root, 'project.unone.json')).render_pipeline.passes;
  assert.deepEqual(passes.map(pass => [pass.kind, pass.enabled ?? true]), [['scene', true], ['bloom', true], ['fx.ink', true]]);
  await writeFile(join(root, 'render/fx/ink.js'), '// edited\n');
  const refused = await call('effects.apply', {effects: ['ink']}, root);
  assert.equal(refused.diagnostics[0].code, 'RENDER_EFFECT_MODIFIED');
  assert.equal((await call('effects.apply', {effects: ['ink'], force: true}, root)).ok, true);
  assert.equal((await call('effects.plan', {effects: ['sepia']}, root)).diagnostics[0].code, 'RENDER_EFFECT_UNKNOWN');
});
