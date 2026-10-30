// Actual emitted-Core correctness only. The existing read-cost benchmark stays
// in verify-immutable-bytes-wasm.mjs; this script never substitutes a Lua API.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {within, readPinnedRuntime, instantiateEmittedRuntime} from './immutable-bytes-emitted-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = data => createHash('sha256').update(data).digest('hex');
const {values} = parseArgs({options: {
  runtime: {type: 'string'}, out: {type: 'string'}, fixture: {type: 'string'}, loader: {type: 'string'},
  'expected-manifest': {type: 'string'}, 'expected-javascript': {type: 'string'},
  'expected-wasm': {type: 'string'}, 'expected-source': {type: 'string'},
  'expected-fixture': {type: 'string'}, 'expected-loader': {type: 'string'},
  'native-report': {type: 'string'}, 'expected-native-report': {type: 'string'},
  'timeout-ms': {type: 'string'},
}});
for (const key of ['runtime', 'out', 'expected-manifest', 'expected-javascript', 'expected-wasm',
  'expected-source', 'expected-fixture', 'expected-loader']) assert(values[key], `Missing --${key}`);
for (const key of ['expected-manifest', 'expected-javascript', 'expected-wasm', 'expected-fixture', 'expected-loader']) {
  assert.match(values[key], /^[a-f0-9]{64}$/, `--${key} must be a lowercase SHA-256`);
}
assert.match(values['expected-source'], /^[a-f0-9]{40}$/, '--expected-source requires the complete clean commit');
assert.equal(Boolean(values['native-report']), Boolean(values['expected-native-report']),
  '--native-report requires --expected-native-report, and vice versa');
if (values['expected-native-report']) assert.match(values['expected-native-report'], /^[a-f0-9]{64}$/);
const timeoutMs = Number(values['timeout-ms'] ?? 30000);
assert(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 300000, 'Invalid --timeout-ms');

const out = path.resolve(values.out);
assert(!fs.existsSync(out), 'Refuse to overwrite evidence');
// Resolve and admit both paths before the first output mutation. In particular
// a mistaken --out <immutable-runtime>/fresh must leave that artifact intact.
const runtime = fs.realpathSync(path.resolve(values.runtime));
const outputParent = fs.realpathSync(path.dirname(out));
assert(['.cache', 'artifacts'].some(name => within(fs.realpathSync(path.join(root, name)), outputParent)),
  'Use a fresh output directory under this repository .cache or artifacts');
assert(!within(runtime, outputParent), 'Evidence cannot modify its selected runtime');
fs.mkdirSync(out);
const write = (name, data) => fs.writeFileSync(path.join(out, name), `${JSON.stringify(data, null, 2)}\n`);
const report = {
  schema: 'unone.immutable-bytes.functional-wasm.v1', ok: false,
  started_at: new Date().toISOString(), node: process.version,
  command: {executable: process.execPath, argv: process.argv.slice(1), cwd: process.cwd()},
  pins: {}, checks: [], checkpoints: [], stderr: [], stderr_overflow: 0, aborts: [],
  cleanup: {attempted: false, unloaded: false, decoder_released: false},
  limitations: [
    'Functional execution of a newly emitted WASM Core and the unchanged shared fixture; no Lua replacement is injected.',
    'Existing SDK19/7510 and pre-span 28df runtimes cannot satisfy this gate.',
    'This record does not establish rendering, FPS, comparison-allocation counts, GC frequency or leak freedom.',
    'Native parity is claimed only when an explicitly pinned, actually executed native report is supplied and matches.',
    'No gameplay project, SDK selection, browser, forced collector or performance clock is changed.',
  ],
};
const filePins = [];
let module, releaseObservationResources;
function pinned(file, expected, label) {
  const bytes = fs.readFileSync(file), hash = sha(bytes);
  assert.equal(hash, expected, `${label} differs from its explicit pin`);
  report.pins[label] = {path: file, bytes: bytes.length, sha256: hash};
  filePins.push({file, hash, label});
  return bytes;
}
const check = (truth, label) => {assert(truth, label); report.checks.push(label);};
function snapshot(state, label, expectedFrame) {
  assert(state?.world && typeof state.world === 'object', `${label}: no successful world`);
  assert.equal(state.world.frame, expectedFrame, `${label}: wrong fixed frame`);
  assert.match(state.observation_digest, /^sha256:[a-f0-9]{64}$/, `${label}: missing canonical digest`);
  // These are emitted by the expanded, independently shared fixture, not by a
  // host mock. In particular the old 14-write-only fixture cannot pass.
  assert.equal(state.world.observations?.immutable_bytes_pass, true, `${label}: expanded fixture did not pass`);
  const observed = state.world.observations;
  assert(Number.isSafeInteger(observed.immutable_bytes_checks) && observed.immutable_bytes_checks >= 300,
    `${label}: expanded span assertions were not exercised`);
  assert(Number.isSafeInteger(observed.immutable_bytes_rejections) && observed.immutable_bytes_rejections >= 40,
    `${label}: expanded malformed-input assertions were not exercised`);
  assert.equal(observed.immutable_bytes_signature, 'bytes-v2:256:32640:4294967295');
  assert.equal(observed.immutable_bytes_boundary, 'unchanged');
  assert.equal(observed.immutable_bytes_ticks, expectedFrame);
  assert.equal(observed.immutable_bytes_lifetime_value, 17);
  assert.deepEqual(state.save_payload, {immutable_bytes: 'portable-only', revision: 1});
  const result = {label, frame: expectedFrame, observation_digest: state.observation_digest,
    observations: state.world.observations, save_payload: state.save_payload ?? null, world: state.world};
  report.checkpoints.push(result);
  return result;
}

try {
  fs.copyFileSync(fileURLToPath(import.meta.url), path.join(out, 'verification-script.mjs'));
  const harnessFile = path.join(root, 'scripts/immutable-bytes-emitted-runtime.mjs');
  const harnessBytes = fs.readFileSync(harnessFile);
  pinned(harnessFile, sha(harnessBytes), 'runtime_harness');
  fs.writeFileSync(path.join(out, 'immutable-bytes-emitted-runtime.mjs'), harnessBytes);
  const selected = readPinnedRuntime({directory: runtime, expected: {
    manifest: values['expected-manifest'], source: values['expected-source'],
    javascript: values['expected-javascript'], wasm: values['expected-wasm'],
  }, pinned});
  const {metadata, metadataBytes, required} = selected;
  const fixtureFile = fs.realpathSync(path.resolve(values.fixture ?? path.join(root, 'crates/unone-engine/tests/fixtures/immutable-bytes.luau')));
  const fixtureBytes = pinned(fixtureFile, values['expected-fixture'], 'fixture');
  const fixture = new TextDecoder('utf-8', {fatal: true}).decode(fixtureBytes);
  const loader = fs.realpathSync(path.resolve(values.loader ?? path.join(root, 'web/shared/load-project.js')));
  pinned(loader, values['expected-loader'], 'observation_loader');
  report.runtime_metadata = metadata;
  fs.writeFileSync(path.join(out, 'runtime.json'), metadataBytes);
  fs.writeFileSync(path.join(out, 'immutable-bytes.luau'), fixtureBytes);
  const loaderModule = await import(pathToFileURL(loader).href);
  const {loadProject, readObservation} = loaderModule;
  releaseObservationResources = loaderModule.releaseObservationResources;
  for (const operation of [loadProject, readObservation, releaseObservationResources]) assert.equal(typeof operation, 'function');
  module = await instantiateEmittedRuntime({...selected, timeoutMs, diagnostics: report});
  check(required.every(name => typeof module[`_unone_web_${name}`] === 'function'), 'Actual emitted module exposes Core ABI');
  const payload = {config: {name: 'immutable-bytes', entry_script: 'main.luau'}, script: fixture, scene: null};
  write('project-payload.json', payload);
  const initial = snapshot(loadProject(module, payload, 42n), 'initial', 0);
  const input = new TextEncoder().encode(JSON.stringify({actions: {}}));
  for (let frame = 1; frame <= 3; frame++) {
    const pointer = module._unone_web_alloc(input.length);
    assert(Number.isSafeInteger(pointer) && pointer >= 0 && pointer + input.length <= module.HEAPU8.length, 'Invalid input allocation');
    module.HEAPU8.set(input, pointer);
    assert.equal(module._unone_web_set_input_frame(pointer, input.length), 0);
    const status = module._unone_web_tick(), state = readObservation(module);
    assert.equal(status, 0, `Fixed tick ${frame} failed: ${JSON.stringify(state)}`);
    snapshot(state, `tick-${frame}`, frame);
  }
  check(true, 'Shared expanded fixture passes at load and frames 1..3');
  if (values['native-report']) {
    const nativeFile = fs.realpathSync(path.resolve(values['native-report']));
    const nativeBytes = pinned(nativeFile, values['expected-native-report'], 'native_report');
    const native = JSON.parse(nativeBytes.toString('utf8'));
    assert.equal(native.ok, true, 'Native report did not execute and pass');
    assert.equal(native.fixture_sha256, sha(fixtureBytes));
    assert.equal(native.seed, 42);
    assert.deepEqual(native.config, payload.config, 'Native used a different project configuration');
    assert.equal(native.checkpoints?.length, 4);
    for (let index = 0; index < 4; index++) {
      const actual = report.checkpoints[index], expected = native.checkpoints[index];
      assert.equal(actual.frame, expected.frame);
      assert.equal(actual.observation_digest, expected.observation_digest, `Native/WASM digest differs at frame ${index}`);
      assert.deepEqual(actual.observations, expected.observations);
      assert.deepEqual(actual.save_payload, expected.save_payload ?? null);
      if (Object.hasOwn(expected, 'world')) assert.deepEqual(actual.world, expected.world);
    }
    report.native_pairing = {status: 'passed', compared_frames: [0, 1, 2, 3]};
    check(true, 'Actually executed Native report matches WASM canonical digest and values at frames 0..3');
  } else report.native_pairing = {status: 'outside-this-record', reason: 'No executed native report supplied'};
  assert.equal(module._unone_web_unload_project(), 0);
  releaseObservationResources(module);
  assert.equal(module._unone_web_observation_len(), 0);
  const fresh = snapshot(loadProject(module, payload, 42n), 'fresh-after-unload', 0);
  assert.equal(fresh.observation_digest, initial.observation_digest);
  assert.deepEqual(fresh.world, initial.world);
  assert.deepEqual(fresh.save_payload, initial.save_payload);
  check(true, 'Unload and new runtime reproduce the complete initial canonical result');
} catch (error) {
  report.error = String(error.stack ?? error);
  if (error.result) write('failed-publication.json', error.result);
  process.exitCode = 1;
} finally {
  if (module) {
    report.cleanup.attempted = true;
    try {
      assert.equal(module._unone_web_unload_project(), 0);
      assert.equal(module._unone_web_observation_len(), 0);
      report.cleanup.unloaded = true;
    } catch (error) {report.cleanup.error = String(error.stack ?? error); process.exitCode = 1;}
    try {releaseObservationResources(module); report.cleanup.decoder_released = true;}
    catch (error) {report.cleanup.decoder_error = String(error.stack ?? error); process.exitCode = 1;}
  }
  for (const {file, hash, label} of filePins) {
    try {assert.equal(sha(fs.readFileSync(file)), hash, `${label} changed during verification`);}
    catch (error) {report.pin_recheck_error = String(error.stack ?? error); process.exitCode = 1;}
  }
  if (report.stderr.length || report.stderr_overflow || report.aborts.length) process.exitCode = 1;
  report.finished_at = new Date().toISOString();
  report.ok = !process.exitCode && report.checkpoints.length === 5 && report.cleanup.unloaded && report.cleanup.decoder_released;
  write('report.json', report);
  console.log(JSON.stringify({ok: report.ok, report: path.join(out, 'report.json'), checkpoints: report.checkpoints.length,
    native_pairing: report.native_pairing, wasm_sha256: report.pins.wasm?.sha256, cleanup: report.cleanup, error: report.error}));
}
