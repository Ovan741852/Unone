// Separate actual-WASM operation-cost diagnostic. No browser/FPS, forced GC,
// Lua substitute implementation, wall-time gate or allocation-count inference.
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
  'timeout-ms': {type: 'string'},
}});
for (const key of ['runtime', 'out', 'expected-manifest', 'expected-javascript', 'expected-wasm',
  'expected-source', 'expected-fixture', 'expected-loader']) assert(values[key], `Missing --${key}`);
for (const key of ['expected-manifest', 'expected-javascript', 'expected-wasm', 'expected-fixture', 'expected-loader']) {
  assert.match(values[key], /^[a-f0-9]{64}$/, `--${key} must be a lowercase SHA-256`);
}
assert.match(values['expected-source'], /^[a-f0-9]{40}$/);
const timeoutMs = Number(values['timeout-ms'] ?? 30000);
assert(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 300000);
const runtime = fs.realpathSync(path.resolve(values.runtime)), out = path.resolve(values.out);
assert(!fs.existsSync(out), 'Refuse to overwrite evidence');
const parent = fs.realpathSync(path.dirname(out));
assert(['.cache', 'artifacts'].some(name => within(fs.realpathSync(path.join(root, name)), parent)), 'Use private repository cache/artifacts output');
assert(!within(runtime, parent), 'Evidence cannot modify its selected runtime');
fs.mkdirSync(out);
const write = (name, data) => fs.writeFileSync(path.join(out, name), `${JSON.stringify(data, null, 2)}\n`);
const cases = ['span', 'equals_mutable', 'equals_frozen', 'equals_mixed',
  'equals_range_mutable', 'equals_range_frozen', 'equals_range_mixed',
  'snapshot_mutable', 'snapshot_partial_frozen', 'snapshot_whole_frozen', 'readstring_same_content'];
const sizes = [4096, 65536, 1048576], warmupTicks = 3, rounds = 3, ticksPerRound = 4;
const report = {
  schema: 'unone.immutable-bytes.actual-wasm-operation-cost.v1', ok: false,
  started_at: new Date().toISOString(), node: process.version,
  command: {executable: process.execPath, argv: process.argv.slice(1), cwd: process.cwd()},
  pins: {}, stderr: [], stderr_overflow: 0, aborts: [], rows: [],
  protocol: {sizes, cases, warmup_ticks_per_mode_sample: warmupTicks, rounds, ticks_per_round: ticksPerRound,
    mode_order: 'baseline/actual alternates by round', seed: 42,
    timed_scope: 'Synchronous actual _unone_web_tick call; input submission and JavaScript observation decoding are outside the timed span'},
  cleanup: {attempted: false, unloaded: false, decoder_released: false},
  limitations: [
    'Actual emitted WASM operation diagnostic using the unchanged fixture shared with native measurements; no FPS or browser result.',
    'Tick wall includes Core update/publication and fixture assertions; baseline adjustment does not isolate pure memcpy or memcmp time.',
    'Negative baseline-adjusted values are retained as noise, never clamped or treated as a speed claim.',
    'Natural VM collection and JIT/tiering/host scheduling may affect samples; there is no forced collector or allocation-count measurement.',
    'readstring_same_content includes Luau string interning; results do not establish independent string allocation on each operation.',
    'Span allocates a descriptor and retains its root; whole-frozen snapshot identity reuse is intentionally distinct from copying cases.',
    'Native and Web wall times are separate host measurements, not cross-host causal comparisons.',
  ],
};
const pins = [];
function pinned(file, expected, name) {
  const bytes = fs.readFileSync(file), hash = sha(bytes);
  assert.equal(hash, expected, `${name} differs from its explicit pin`);
  report.pins[name] = {path: file, bytes: bytes.length, sha256: hash};
  pins.push({file, hash, name}); return bytes;
}
let module, releaseObservationResources, readObservation;
const encoder = new TextEncoder();
function sample(size, index, baseline, timed) {
  const actions = {[`BytesSize${size}`]: true, [`BytesOp${index}`]: true};
  if (baseline) actions.BytesBaseline = true;
  const bytes = encoder.encode(JSON.stringify({actions})), pointer = module._unone_web_alloc(bytes.length);
  assert(Number.isSafeInteger(pointer) && pointer >= 0 && pointer + bytes.length <= module.HEAPU8.length, 'Invalid input allocation');
  module.HEAPU8.set(bytes, pointer);
  assert.equal(module._unone_web_set_input_frame(pointer, bytes.length), 0);
  const start = performance.now(), status = module._unone_web_tick(), end = performance.now();
  const state = readObservation(module);
  assert.equal(status, 0, JSON.stringify(state));
  const observed = state.world?.observations;
  const repetitions = index === 1 || index === 10 ? 512 : Math.max(1, Math.floor(1048576 / size));
  assert.equal(observed?.bytes_ops_ready, true);
  assert.equal(observed.bytes_ops_size, size);
  assert.equal(observed.bytes_ops_case, index);
  assert.equal(observed.bytes_ops_repetitions, repetitions);
  assert.equal(observed.bytes_ops_baseline, baseline);
  assert.equal(observed.bytes_ops_checksum, repetitions);
  assert(Number.isFinite(end - start) && end >= start);
  return {frame: state.world.frame, repetitions, wall_ms: end - start,
    ns_per_operation: (end - start) * 1e6 / repetitions,
    ...(timed ? {observation_digest: state.observation_digest} : {})};
}
const mean = list => list.reduce((total, value) => total + value, 0) / list.length;
const median = list => {const sorted = [...list].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)];};
try {
  fs.copyFileSync(fileURLToPath(import.meta.url), path.join(out, 'verification-script.mjs'));
  const harnessFile = path.join(root, 'scripts/immutable-bytes-emitted-runtime.mjs'), harness = fs.readFileSync(harnessFile);
  pinned(harnessFile, sha(harness), 'runtime_harness'); fs.writeFileSync(path.join(out, 'immutable-bytes-emitted-runtime.mjs'), harness);
  const selected = readPinnedRuntime({directory: runtime, expected: {
    manifest: values['expected-manifest'], source: values['expected-source'],
    javascript: values['expected-javascript'], wasm: values['expected-wasm'],
  }, pinned});
  report.runtime_metadata = selected.metadata;
  fs.writeFileSync(path.join(out, 'runtime.json'), selected.metadataBytes);
  const fixtureFile = fs.realpathSync(path.resolve(values.fixture ?? path.join(root, 'crates/unone-engine/tests/fixtures/immutable-bytes-ops-perf.luau')));
  const fixtureBytes = pinned(fixtureFile, values['expected-fixture'], 'fixture');
  fs.writeFileSync(path.join(out, 'immutable-bytes-ops-perf.luau'), fixtureBytes);
  const loader = fs.realpathSync(path.resolve(values.loader ?? path.join(root, 'web/shared/load-project.js')));
  pinned(loader, values['expected-loader'], 'observation_loader');
  const loaderModule = await import(pathToFileURL(loader).href);
  const {loadProject} = loaderModule;
  ({readObservation, releaseObservationResources} = loaderModule);
  for (const operation of [loadProject, readObservation, releaseObservationResources]) assert.equal(typeof operation, 'function');
  module = await instantiateEmittedRuntime({...selected, timeoutMs, diagnostics: report});
  const payload = {config: {name: 'immutable-bytes-ops-perf', entry_script: 'main.luau'},
    script: new TextDecoder('utf-8', {fatal: true}).decode(fixtureBytes), scene: null};
  const initial = loadProject(module, payload, 42n);
  assert.equal(initial.world?.observations?.bytes_ops_ready, true);
  write('project-payload.json', payload);
  for (const size of sizes) for (let index = 1; index <= cases.length; index++) {
    const row = {size, case: cases[index - 1], case_index: index, rounds: []};
    report.rows.push(row);
    for (let round = 0; round < rounds; round++) {
      const measured = {round, order: round % 2 === 0 ? ['baseline', 'actual'] : ['actual', 'baseline']};
      row.rounds.push(measured);
      for (const mode of measured.order) {
        for (let tick = 0; tick < warmupTicks; tick++) sample(size, index, mode === 'baseline', false);
        measured[mode] = [];
        for (let tick = 0; tick < ticksPerRound; tick++) measured[mode].push(sample(size, index, mode === 'baseline', true));
      }
      measured.actual_ns_per_operation = mean(measured.actual.map(item => item.ns_per_operation));
      measured.baseline_ns_per_operation = mean(measured.baseline.map(item => item.ns_per_operation));
      measured.adjusted_ns_per_operation = measured.actual_ns_per_operation - measured.baseline_ns_per_operation;
    }
    row.actual_median_ns_per_operation = median(row.rounds.map(item => item.actual_ns_per_operation));
    row.baseline_median_ns_per_operation = median(row.rounds.map(item => item.baseline_ns_per_operation));
    row.adjusted_median_ns_per_operation = median(row.rounds.map(item => item.adjusted_ns_per_operation));
  }
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
    try {assert.equal(sha(fs.readFileSync(file)), hash, `${name} changed during the diagnostic`);}
    catch (error) {report.pin_recheck_error = String(error.stack ?? error); process.exitCode = 1;}
  }
  if (report.stderr.length || report.stderr_overflow || report.aborts.length) process.exitCode = 1;
  report.finished_at = new Date().toISOString();
  report.ok = !process.exitCode && report.rows.length === sizes.length * cases.length
    && report.rows.every(row => row.rounds.length === rounds && row.rounds.every(round => round.actual?.length === ticksPerRound && round.baseline?.length === ticksPerRound))
    && report.cleanup.unloaded && report.cleanup.decoder_released;
  write('report.json', report);
  console.log(JSON.stringify({ok: report.ok, report: path.join(out, 'report.json'), rows: report.rows.length,
    wasm_sha256: report.pins.wasm?.sha256, cleanup: report.cleanup, error: report.error}));
}
