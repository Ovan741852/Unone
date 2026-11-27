#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {instantiateEmittedRuntime} from './immutable-bytes-emitted-runtime.mjs';
import {inspectRuntime} from './refresh-official-web.mjs';
import {checkedRoot, inside, sha, sourceFile, verifiedExport} from './web-export-files.mjs';

const usage = `node scripts/compare-web-replay.mjs --before <export-dir> --after <export-dir> --input-sequence <InputFrame[].json> --out <fresh-report.json>
  [--scope full|core] [--frames <1..10000>] [--warmup <initial ticks to exclude>] [--seed <u64>]
  [--host-time-tape <recorded HostTime tape.json>]
full uses each finalized production player’s content, JS host and Core. core uses before’s content
and JS host on both sides, with each side’s own production runtime. Each pair alternates which VM
ticks first. Frames default to the sequence length. Extra frames have empty input. Warmup defaults
to 0, seed to 42. Elapsed time covers the headless host tick through observation restore (no GPU).`;
const utf8 = new TextDecoder('utf-8', {fatal: true});
const sides = ['before', 'after'];

function integer(raw, name, min, max) {
  const n = Number(raw);
  assert(/^(0|[1-9][0-9]*)$/.test(raw) && Number.isSafeInteger(n) && n >= min && n <= max, `Invalid --${name}`);
  return n;
}

function readPlayer(directory) {
  // Both official and custom renders sit downstream of this headless host command.
  const player = verifiedExport(directory, {allowCustomRenderer: true});
  const {manifest} = player;
  assert(player.generation_matches, 'Content does not match the finalized release generation');
  assert(manifest.variant === 'production' && manifest.profile === 'release' &&
    manifest.dev_tools === false && manifest.preview_tools === false, 'Finalized production Web export required');
  const generation = path.join(player.root, manifest.release_root);
  const runtime = inspectRuntime(path.join(generation, 'runtime'));
  const meta = runtime.metadata;
  assert(meta.sampling_profile === false && meta.phase_profile === false && (meta.profile_mode ?? 'none') === 'none',
    'Production runtime required without profiling');
  assert.equal(runtime.files.get('runtime/' + meta.wasm).bytes, meta.wasm_bytes, 'Runtime WASM size');
  // All aliases, immutable files, inventory hashes and index were checked by verifiedExport.
  // For inputs we read ourselves, pin the exact bytes that we pass to the VM as well.
  function read(relative) {
    const record = player.logical.get(relative);
    assert(record, `Missing export file: ${relative}`);
    const bytes = fs.readFileSync(sourceFile(generation, relative));
    assert.equal(sha(bytes), record.sha256, `Export file changed: ${relative}`);
    return bytes;
  }
  return {
    generation, read, meta,
    identity: {export_dir: player.root, release_root: manifest.release_root, manifest_sha256: player.manifest_sha256,
      project: manifest.project, entry_script_sha256: manifest.script_sources?.entry_sha256 ?? null,
      payload_sha256: player.logical.get('content/project.json')?.sha256, runtime_manifest_sha256: runtime.sha256,
      core_source_commit: meta.source_commit, javascript_sha256: meta.javascript_sha256, wasm_sha256: meta.wasm_sha256},
  };
}

export function readGame(host, {payloadDataSources, textureCatalog}, tape) {
  const payload = JSON.parse(utf8.decode(host.read('content/project.json')));
  if (tape) payload.config = {...payload.config, host_time: {mode: 'replay', tape}};
  const assets = JSON.parse(utf8.decode(host.read('content/assets.json')));
  const catalog = textureCatalog(assets);
  if (catalog.length) payload.asset_catalog = catalog;
  const sources = new Map();
  const data = payloadDataSources(payload).map(({id, source}) => {
    if (!sources.has(source)) sources.set(source, host.read('content/' + source));
    return {id, bytes: sources.get(source)};
  });
  return {payload, data};
}

async function openPlayer(runtime, host, seed, state, tape) {
  const javascriptFile = sourceFile(runtime.generation, 'runtime/' + runtime.meta.javascript);
  const shared = name => pathToFileURL(sourceFile(host.generation, 'web/shared/' + name)).href;
  const {createRuntimeCore} = await import(shared('runtime-core.mjs'));
  const {payload, data} = readGame(host, await import(shared('load-project.js')), tape);
  state.host_time_mode = payload.config?.host_time?.mode ?? 'disabled';
  state.texture_count = payload.asset_catalog?.length ?? 0;
  state.data_sources = data.length;
  const module = await instantiateEmittedRuntime({javascriptFile, javascript: runtime.read('runtime/' + runtime.meta.javascript),
    wasm: runtime.read('runtime/' + runtime.meta.wasm), timeoutMs: 60000, diagnostics: state});
  // Register ownership before construction/load; either side can fail independently.
  state.close = () => module._unone_web_unload_project();
  const core = createRuntimeCore(module, {url: pathToFileURL(javascriptFile).href, profile: false});
  state.close = () => core.close();
  const loaded = await core.execute({kind: 'load', payload, seed, data});
  state.loaded_frame = loaded.world?.frame;
  state.loaded_digest = loaded.observation_digest;
  return core;
}

function checkPair(before, after, tick) {
  for (const [side, value] of Object.entries({before, after})) {
    assert(Number.isSafeInteger(value.frame) && /^sha256:[0-9a-f]{64}$/.test(value.digest),
      `Missing frame or canonical ${side} digest at replay tick ${tick}`);
  }
  if (before.digest !== after.digest || before.frame !== after.frame) {
    throw Error(`REPLAY_MISMATCH at tick ${tick}: before frame=${before.frame} ${before.digest}, after frame=${after.frame} ${after.digest}`);
  }
}

export async function replay(cores, sequence, frames, rows) {
  for (let i = 0; i < frames; i++) {
    const order = i % 2 === 0 ? sides : ['after', 'before'];
    const input = sequence[i] ?? {};
    const pair = {};
    for (const side of order) {
      // Each side owns its input. Clone and result bookkeeping are outside the timed call.
      const command = {kind: 'tick', input: structuredClone(input)};
      const start = performance.now();
      const snapshot = await cores[side].execute(command);
      const ms = performance.now() - start;
      pair[side] = {ms, frame: snapshot.world?.frame, digest: snapshot.observation_digest};
    }
    checkPair(pair.before, pair.after, i + 1);
    rows.push({tick: i + 1, first: order[0], frame: pair.before.frame, digest: pair.before.digest,
      before_ms: pair.before.ms, after_ms: pair.after.ms});
  }
}

function distribution(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const quantile = p => sorted[Math.ceil(sorted.length * p) - 1];
  return {p50_ms: quantile(0.5), p95_ms: quantile(0.95), mean_ms: samples.reduce((a, b) => a + b, 0) / samples.length};
}

export function summarize(rows, warmup) {
  const measured = rows.slice(warmup);
  return {pairs: measured.length, before: distribution(measured.map(row => row.before_ms)),
    after: distribution(measured.map(row => row.after_ms)),
    paired_after_minus_before: distribution(measured.map(row => row.after_ms - row.before_ms)),
    after_faster_pairs: measured.filter(row => row.after_ms < row.before_ms).length};
}

// An open call registers the module's close callback as soon as it exists,
// including while the initial project load is still allowed to fail.
export async function runPlayers(open, sequence, frames, report) {
  let failure;
  try {
    const cores = {};
    for (const side of sides) cores[side] = await open(side, report.state[side]);
    const initial = side => ({frame: report.state[side].loaded_frame, digest: report.state[side].loaded_digest});
    checkPair(initial('before'), initial('after'), 0);
    await replay(cores, sequence, frames, report.rows);
    if (report.input?.host_time_tape) {
      for (const side of sides) {
        await cores[side].execute({kind: 'hostTime', request: {kind: 'complete'}});
        report.state[side].host_time_complete = true;
      }
    }
    for (const side of sides) assert.equal(report.state[side].aborts.length, 0, `${side} WASM aborted`);
  } catch (error) {
    failure = error;
  } finally {
    for (const side of sides) {
      const state = report.state[side];
      if (!state.close) continue;
      try { await state.close(); state.closed = true; }
      catch (error) { state.close_error = error.message; failure ??= error; }
      delete state.close;
    }
  }
  if (failure) throw failure;
}

export async function main(args = process.argv.slice(2)) {
  const options = Object.fromEntries(['before', 'after', 'input-sequence', 'out', 'scope', 'frames', 'warmup', 'seed', 'host-time-tape']
    .map(key => [key, {type: 'string'}]));
  const {values} = parseArgs({args, options: {...options, help: {type: 'boolean', short: 'h'}}});
  if (values.help) { console.log(usage); return; }
  for (const key of ['before', 'after', 'input-sequence', 'out']) assert(values[key], `Missing --${key}\n${usage}`);
  const roots = sides.map(side => checkedRoot(values[side]));
  const out = path.join(checkedRoot(path.dirname(path.resolve(values.out))), path.basename(values.out));
  assert(roots.every(root => !inside(root, out)), 'Report must be outside both exports');
  const fd = fs.openSync(out, 'wx');
  const state = Object.fromEntries(sides.map(side => [side, {stderr: [], stderr_overflow: 0, aborts: [], closed: false}]));
  const report = {schema: 'unone.web-replay-comparison.v1', ok: false, scope: values.scope ?? 'full',
    node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch,
    clock: 'Elapsed milliseconds for each host tick and its restored observation in Node; graphics submission is outside this measurement.',
    rows: [], state};
  try {
    assert(['core', 'full'].includes(report.scope), 'Invalid --scope');
    const file = checkedRoot(values['input-sequence']);
    assert(fs.statSync(file).size <= 8 * 1024 * 1024, 'Input sequence exceeds 8 MiB');
    const bytes = fs.readFileSync(file);
    const sequence = JSON.parse(utf8.decode(bytes));
    assert(Array.isArray(sequence) && sequence.length <= 10000 &&
      sequence.every(input => input && typeof input === 'object' && !Array.isArray(input)), 'Expected an InputFrame[]');
    const frames = integer(values.frames ?? String(sequence.length), 'frames', 1, 10000);
    const warmup = integer(values.warmup ?? '0', 'warmup', 0, frames - 1);
    const seed = values.seed ?? '42';
    assert(/^(0|[1-9][0-9]{0,19})$/.test(seed) && BigInt(seed) <= 18446744073709551615n, 'Invalid --seed');
    report.input = {path: file, sha256: sha(bytes), sequence_length: sequence.length, frames, warmup, seed};
    let tape;
    if (values['host-time-tape'] !== undefined) {
      const tapePath = checkedRoot(values['host-time-tape']);
      const tapeBytes = fs.readFileSync(tapePath);
      tape = JSON.parse(utf8.decode(tapeBytes));
      assert(tape?.schema_version === 1 && Array.isArray(tape.transactions), 'Expected a schema-1 HostTime tape');
      report.input.host_time_tape = {path: tapePath, sha256: sha(tapeBytes), transactions: tape.transactions.length};
    }
    const before = readPlayer(roots[0]);
    const after = roots[0] === roots[1] ? before : readPlayer(roots[1]);
    report.exports = {before: before.identity, after: after.identity};
    const afterHost = report.scope === 'core' ? before : after;
    report.after_host_and_content_release = afterHost.identity.release_root;
    const open = (side, session) => side === 'before' ? openPlayer(before, before, seed, session, tape)
      : openPlayer(after, afterHost, seed, session, tape);
    await runPlayers(open, sequence, frames, report);
    report.summary = summarize(report.rows, warmup);
    report.ok = true;
  } catch (error) {
    report.error = error.message;
  } finally {
    try { fs.writeFileSync(fd, JSON.stringify(report, null, 2) + '\n'); }
    finally { fs.closeSync(fd); }
  }
  if (!report.ok) throw Error(`${report.error ?? 'Runtime cleanup failed'} (report: ${out})`);
  console.log(JSON.stringify({out, scope: report.scope, ...report.summary}));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
