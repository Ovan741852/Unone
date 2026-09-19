// Actual child/GPU acceptance, not a mocked readiness packet.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { player: { type: 'string' }, root: { type: 'string' }, out: { type: 'string' } } });
for (const key of ['player', 'root', 'out']) assert.ok(values[key], `Missing --${key}`);
const player = resolve(values.player), root = resolve(values.root), out = resolve(values.out);
mkdirSync(out);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const results = [];
for (const mode of ['gpu', 'headless', 'missing-package']) {
  const args = ['--root', mode === 'missing-package' ? join(out, 'does-not-exist') : root,
    '--frames', '3', '--warmup', '0', '--freeze-simulation', '--report', join(out, `${mode}.json`)];
  if (mode === 'headless') args.push('--headless');
  const child = spawnSync(player, args, { windowsHide: true, encoding: 'utf8', timeout: 30000 });
  assert.ifError(child.error);
  writeFileSync(join(out, `${mode}.log`), `${child.stdout}\n${child.stderr}`);
  const lines = child.stdout.split(/\r?\n/).filter(line => line.startsWith('UNONE_NATIVE_READY '));
  assert.equal(lines.length, mode === 'gpu' ? 1 : 0, mode);
  if (mode === 'missing-package') assert.notEqual(child.status, 0);
  else assert.equal(child.status, 0, child.stderr);
  let ready = null;
  if (mode === 'gpu') {
    ready = JSON.parse(lines[0].slice('UNONE_NATIVE_READY '.length));
    assert.equal(ready.contract, 'unone.native-ready.v1');
    assert.equal(ready.package_sha256, sha(readFileSync(join(root, 'export.json'))));
    assert.equal(ready.renderer, 'wgpu-native-instanced');
    assert.equal(ready.host, 'windows');
    assert.ok(Number.isInteger(ready.process_id) && ready.process_id > 0);
    assert.ok(ready.resolution.length === 2 && ready.resolution.every(n => n > 0));
    const report = JSON.parse(readFileSync(join(out, 'gpu.json')));
    assert.equal(report.error, null);
    assert.equal(report.drawn, 3);
    assert.equal(ready.adapter, report.adapter);
  }
  results.push({ mode, exit_code: child.status, ready_count: lines.length, ready });
}
const report = { scope: 'Actual Windows native child, GPU first-frame signal, headless and invalid-package negative controls',
  player_sha256: sha(readFileSync(player)), results, ok: true };
writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
