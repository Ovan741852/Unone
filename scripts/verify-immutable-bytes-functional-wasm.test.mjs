// Preflight/failure-evidence checks only. No fixture here executes a VM or
// stands in for the actual immutable-bytes implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts/verify-immutable-bytes-functional-wasm.mjs');
function setup(t) {
  const scratch = fs.mkdtempSync(path.join(root, '.cache/bytes-verifier-preflight-'));
  const runtime = path.join(scratch, 'runtime');
  fs.mkdirSync(runtime);
  const marker = path.join(runtime, 'immutable-marker');
  fs.writeFileSync(marker, 'do not change');
  t.after(() => {
    const owned = fs.realpathSync(scratch), allowed = fs.realpathSync(path.join(root, '.cache'));
    assert(owned.startsWith(`${allowed}${path.sep}`), 'Cleanup stays in the exact private cache directory');
    fs.rmSync(scratch, {recursive: true});
  });
  function invoke(out, overrides = {}) {
    const options = {
      runtime, out,
      'expected-manifest': '0'.repeat(64), 'expected-javascript': '0'.repeat(64),
      'expected-wasm': '0'.repeat(64), 'expected-source': '0'.repeat(40),
      'expected-fixture': '0'.repeat(64), 'expected-loader': '0'.repeat(64), ...overrides,
    };
    const args = [script, ...Object.entries(options).flatMap(([key, value]) => [`--${key}`, value])];
    const result = spawnSync(process.execPath, args, {cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true});
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1, `Expected a rejecting preflight: ${result.stdout}\n${result.stderr}`);
    return result;
  }
  return {scratch, runtime, marker, invoke};
}

test('a rejected runtime-contained output leaves its immutable runtime untouched', t => {
  const f = setup(t), before = fs.readdirSync(f.runtime), out = path.join(f.runtime, 'must-not-be-created');
  const result = f.invoke(out);
  assert.match(result.stderr, /Evidence cannot modify its selected runtime/);
  assert.equal(fs.existsSync(out), false);
  assert.deepEqual(fs.readdirSync(f.runtime), before);
  assert.equal(fs.readFileSync(f.marker, 'utf8'), 'do not change');
});

test('normalized traversal into the runtime is rejected before writes', t => {
  const f = setup(t), out = path.join(f.runtime, '..', 'runtime', 'must-not-be-created');
  const result = f.invoke(out);
  assert.match(result.stderr, /Evidence cannot modify its selected runtime/);
  assert.equal(fs.existsSync(out), false);
  assert.deepEqual(fs.readdirSync(f.runtime), ['immutable-marker']);
});

test('manifest rejection preserves a fresh failed report without initializing a VM', t => {
  const f = setup(t), out = path.join(f.scratch, 'failed-evidence');
  fs.writeFileSync(path.join(f.runtime, 'runtime.json'), '{}');
  const result = f.invoke(out);
  const report = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8'));
  assert.equal(report.ok, false);
  assert.match(report.error, /runtime_manifest differs from its explicit pin/);
  assert.deepEqual(report.checkpoints, []);
  assert.equal(report.cleanup.attempted, false);
  assert.deepEqual(report.aborts, []);
  assert.match(result.stdout, /"ok":false/);
  assert.equal(fs.existsSync(path.join(out, 'project-payload.json')), false);
  assert.equal(fs.readFileSync(f.marker, 'utf8'), 'do not change');
});

test('an existing evidence directory is preserved instead of overwritten', t => {
  const f = setup(t), out = path.join(f.scratch, 'existing');
  fs.mkdirSync(out); fs.writeFileSync(path.join(out, 'report.json'), 'original evidence');
  const result = f.invoke(out);
  assert.match(result.stderr, /Refuse to overwrite evidence/);
  assert.equal(fs.readFileSync(path.join(out, 'report.json'), 'utf8'), 'original evidence');
});

test('native pairing cannot proceed with an unpinned report', t => {
  const f = setup(t), out = path.join(f.scratch, 'must-not-be-created');
  const result = f.invoke(out, {'native-report': path.join(f.scratch, 'not-read.json')});
  assert.match(result.stderr, /--native-report requires --expected-native-report/);
  assert.equal(fs.existsSync(out), false);
});

test('malformed source pins fail before creating evidence', t => {
  const f = setup(t), out = path.join(f.scratch, 'must-not-be-created');
  const result = f.invoke(out, {'expected-source': 'HEAD'});
  assert.match(result.stderr, /--expected-source requires the complete clean commit/);
  assert.equal(fs.existsSync(out), false);
});
