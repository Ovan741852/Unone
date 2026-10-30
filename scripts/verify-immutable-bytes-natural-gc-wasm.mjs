// Natural-collection ownership witness in the actual emitted WASM VM.
// This is not a GC-frequency, zero-allocation or global leak-freedom gate.
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
}});
for (const key of ['runtime', 'out', 'expected-manifest', 'expected-javascript', 'expected-wasm',
  'expected-source', 'expected-fixture', 'expected-loader']) assert(values[key], `Missing --${key}`);
for (const key of ['expected-manifest', 'expected-javascript', 'expected-wasm', 'expected-fixture', 'expected-loader']) {
  assert.match(values[key], /^[a-f0-9]{64}$/, `--${key} must be a lowercase SHA-256`);
}
assert.match(values['expected-source'], /^[a-f0-9]{40}$/);
const runtime = fs.realpathSync(path.resolve(values.runtime)), out = path.resolve(values.out);
assert(!fs.existsSync(out), 'Refuse to overwrite evidence');
const parent = fs.realpathSync(path.dirname(out));
assert(['.cache', 'artifacts'].some(name => within(fs.realpathSync(path.join(root, name)), parent)), 'Use private repository evidence output');
assert(!within(runtime, parent), 'Evidence cannot modify its selected runtime');
fs.mkdirSync(out);
const write = (name, data) => fs.writeFileSync(path.join(out, name), `${JSON.stringify(data, null, 2)}\n`);
const report = {schema: 'unone.immutable-bytes.actual-wasm-natural-gc.v1', ok: false,
  started_at: new Date().toISOString(), node: process.version,
  command: {executable: process.execPath, argv: process.argv.slice(1), cwd: process.cwd()},
  pins: {}, stderr: [], stderr_overflow: 0, aborts: [], checkpoints: [],
  budget: {maximum_fixed_ticks: 100, ephemeral_buffers_per_tick: 32, ephemeral_buffer_bytes: 65536,
    maximum_cumulative_pressure_bytes: 209715200},
  cleanup: {attempted: false, unloaded: false, decoder_released: false},
  limitations: [
    'No force-GC API, profiler, browser, gameplay code or clock replacement is used.',
    'Weak-value disappearance witnesses actual collection of these specific objects; it is not a collection-frequency measurement.',
    'Pressure bytes are cumulative requested ephemeral payload bytes, not live memory, allocation counters or WASM capacity.',
    'The test proves bounded span/root ownership behavior on this actual WASM artifact, not global leak freedom or FPS.',
  ],
};
const pins = [];
function pinned(file, expected, name) {
  const bytes = fs.readFileSync(file), hash = sha(bytes);
  assert.equal(hash, expected, `${name} differs from its explicit pin`);
  report.pins[name] = {path: file, bytes: bytes.length, sha256: hash};
  pins.push({file, hash, name}); return bytes;
}
let module, releaseObservationResources;
try {
  fs.copyFileSync(fileURLToPath(import.meta.url), path.join(out, 'verification-script.mjs'));
  const harnessFile = path.join(root, 'scripts/immutable-bytes-emitted-runtime.mjs'), harness = fs.readFileSync(harnessFile);
  pinned(harnessFile, sha(harness), 'runtime_harness'); fs.writeFileSync(path.join(out, 'immutable-bytes-emitted-runtime.mjs'), harness);
  const selected = readPinnedRuntime({directory: runtime, expected: {manifest: values['expected-manifest'],
    source: values['expected-source'], javascript: values['expected-javascript'], wasm: values['expected-wasm']}, pinned});
  report.runtime_metadata = selected.metadata;
  fs.writeFileSync(path.join(out, 'runtime.json'), selected.metadataBytes);
  const fixtureFile = fs.realpathSync(path.resolve(values.fixture ?? path.join(root, 'crates/unone-engine/tests/fixtures/immutable-bytes-natural-gc.luau')));
  const fixtureBytes = pinned(fixtureFile, values['expected-fixture'], 'fixture');
  fs.writeFileSync(path.join(out, 'immutable-bytes-natural-gc.luau'), fixtureBytes);
  const loader = fs.realpathSync(path.resolve(values.loader ?? path.join(root, 'web/shared/load-project.js')));
  pinned(loader, values['expected-loader'], 'observation_loader');
  const loaderModule = await import(pathToFileURL(loader).href);
  const {loadProject, readObservation} = loaderModule;
  releaseObservationResources = loaderModule.releaseObservationResources;
  module = await instantiateEmittedRuntime({...selected, timeoutMs: 30000, diagnostics: report});
  const payload = {config: {name: 'immutable-bytes-natural-gc', entry_script: 'main.luau'},
    script: new TextDecoder('utf-8', {fatal: true}).decode(fixtureBytes), scene: null};
  write('project-payload.json', payload);
  let state = loadProject(module, payload, 42n), releaseSent = false;
  const observe = (value, frame) => {
    assert.equal(value.world?.frame, frame);
    const observed = value.world.observations;
    assert.equal(observed.bytes_gc_ready, true);
    assert.equal(observed.bytes_gc_ticks, frame);
    assert.equal(observed.bytes_gc_pressure_bytes, frame * 32 * 65536);
    report.checkpoints.push({frame, observation_digest: value.observation_digest, observations: observed});
    return observed;
  };
  const initial = observe(state, 0);
  assert.equal(initial.bytes_gc_root_alive, true); assert.equal(initial.bytes_gc_child_valid, true);
  const encoder = new TextEncoder();
  for (let frame = 1; frame <= 100; frame++) {
    const actions = {};
    if (report.retained_root_witness && !releaseSent) {actions.ReleaseLastChild = true; releaseSent = true; report.release_action_frame = frame;}
    const input = encoder.encode(JSON.stringify({actions})), pointer = module._unone_web_alloc(input.length);
    assert(Number.isSafeInteger(pointer) && pointer >= 0 && pointer + input.length <= module.HEAPU8.length);
    module.HEAPU8.set(input, pointer);
    assert.equal(module._unone_web_set_input_frame(pointer, input.length), 0);
    const status = module._unone_web_tick(); state = readObservation(module);
    assert.equal(status, 0, `Natural GC ownership failure: ${JSON.stringify(state)}`);
    const observed = observe(state, frame);
    assert.equal(observed.bytes_gc_released, releaseSent);
    if (!releaseSent) {
      assert.equal(observed.bytes_gc_root_alive, true, 'Root disappeared while the last child remained live');
      assert.equal(observed.bytes_gc_child_valid, true);
      assert.equal(observed.bytes_gc_child_collected, false);
      if (observed.bytes_gc_intermediate_collected) report.retained_root_witness ??= {frame, observations: observed};
    } else if (!observed.bytes_gc_root_alive && observed.bytes_gc_child_collected) {
      assert.equal(observed.bytes_gc_intermediate_collected, true);
      assert.equal(observed.bytes_gc_child_valid, false);
      report.final_collection_witness = {frame, observations: observed};
      break;
    }
  }
  assert(report.retained_root_witness, 'No actual intermediate collection witnessed within the fixed pressure budget');
  assert(report.final_collection_witness, 'Last root did not retire within the fixed pressure budget');
  assert(report.final_collection_witness.frame >= report.release_action_frame);
} catch (error) {
  report.error = String(error.stack ?? error); process.exitCode = 1;
  if (error.result) write('failed-publication.json', error.result);
} finally {
  if (module) {
    report.cleanup.attempted = true;
    try {assert.equal(module._unone_web_unload_project(), 0); assert.equal(module._unone_web_observation_len(), 0); report.cleanup.unloaded = true;}
    catch (error) {report.cleanup.error = String(error.stack ?? error); process.exitCode = 1;}
    try {releaseObservationResources(module); report.cleanup.decoder_released = true;}
    catch (error) {report.cleanup.decoder_error = String(error.stack ?? error); process.exitCode = 1;}
  }
  for (const {file, hash, name} of pins) {
    try {assert.equal(sha(fs.readFileSync(file)), hash, `${name} changed during the test`);}
    catch (error) {report.pin_recheck_error = String(error.stack ?? error); process.exitCode = 1;}
  }
  if (report.stderr.length || report.stderr_overflow || report.aborts.length) process.exitCode = 1;
  report.finished_at = new Date().toISOString();
  report.ok = !process.exitCode && !!report.retained_root_witness && !!report.final_collection_witness
    && report.cleanup.unloaded && report.cleanup.decoder_released;
  write('report.json', report);
  console.log(JSON.stringify({ok: report.ok, report: path.join(out, 'report.json'),
    retained_root_frame: report.retained_root_witness?.frame, release_action_frame: report.release_action_frame,
    final_collection_frame: report.final_collection_witness?.frame, cleanup: report.cleanup, error: report.error}));
}
