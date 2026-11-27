import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {main, readGame, replay, runPlayers, summarize} from './compare-web-replay.mjs';
import * as loader from '../web/shared/load-project.js';
import {dataRecord, sha, verifiedExport, writePublication} from './web-export-files.mjs';

const digest = 'sha256:' + '1'.repeat(64);

test('a recorded clock overrides the project policy before load and must end exactly on both sides', async () => {
  const tape = {schema_version: 1, source_epoch: 'runtime-creation', transactions: []};
  const host = {read: name => Buffer.from(JSON.stringify(name.endsWith('project.json')
    ? {config: {tick_rate: 60, host_time: {mode: 'live'}}} : {assets: []}))};
  assert.equal(readGame(host, loader).payload.config.host_time.mode, 'live');
  assert.deepEqual(readGame(host, loader, tape).payload.config, {tick_rate: 60, host_time: {mode: 'replay', tape}});
  for (const fail of [false, true]) {
    const calls = [];
    const report = {input: {host_time_tape: {}}, rows: [], state: {before: {aborts: []}, after: {aborts: []}}};
    const open = (side, state) => {
      Object.assign(state, {loaded_frame: 0, loaded_digest: digest, close() {calls.push([side, 'close']);}});
      return {execute(command) {
        if (command.kind === 'tick') return {world: {frame: 1}, observation_digest: digest};
        assert.deepEqual(command, {kind: 'hostTime', request: {kind: 'complete'}});
        calls.push([side, 'complete']);
        if (fail && side === 'after') throw Error('unused clock transactions');
      }};
    };
    const run = runPlayers(open, [], 1, report);
    if (fail) await assert.rejects(run, /unused clock/); else await run;
    assert.deepEqual(calls, [['before','complete'],['after','complete'],['before','close'],['after','close']]);
  }
});

test('the official catalog overrides only with declared textures, and shared data sources retain every ID', () => {
  const declared = [{id:'texture://embedded',kind:'texture2d'}];
  const payload = {asset_catalog:declared, data_assets:[{id:'data://a',source:'shared.bin'},{id:'data://b',source:'shared.bin'}],
    script_bytecode:{source:'script.luaubc'}};
  for (const manifest of [{assets:[]}, {assets:[{id:'texture://art',kind:'texture2d'}, {id:'data://other',kind:'data'}]}]) {
    const requests = [];
    function read(name) {
      requests.push(name);
      if (name === 'content/project.json') return Buffer.from(JSON.stringify(payload));
      if (name === 'content/assets.json') return Buffer.from(JSON.stringify(manifest));
      return Buffer.from('test bytes');
    }
    const game = readGame({read}, loader);
    assert.deepEqual(game.payload.asset_catalog, manifest.assets.length ? [manifest.assets[0]] : declared);
    assert.equal(requests.filter(x => x === 'content/shared.bin').length, 1);
    assert.equal(game.data.length, 3);
    assert.deepEqual(game.data.slice(0,2).map(x=>x.id), ['data://a','data://b']);
    assert.equal(requests.at(-1), 'content/script.luaubc');
  }
});

test('the replay alternates order and gives each side an independent copy of every input', async () => {
  const calls = [], rows = [], sequence = [{actions: {Press: true}}, {actions: {Press: false}}];
  const side = name => ({async execute({input}) {
    calls.push([name, structuredClone(input)]);
    if (input.actions) input.actions.Press = 'changed by host';
    return {world: {frame: Math.ceil(calls.length / 2)}, observation_digest: digest};
  }});
  await replay({before: side('b'), after: side('a')}, sequence, 3, rows);
  assert.deepEqual(calls, [['b', sequence[0]], ['a', sequence[0]], ['a', sequence[1]], ['b', sequence[1]], ['b', {}], ['a', {}]]);
  assert.deepEqual(rows.map(row => [row.tick, row.first, row.digest]), [[1,'before',digest],[2,'after',digest],[3,'before',digest]]);
  assert.deepEqual(sequence, [{actions: {Press: true}}, {actions: {Press: false}}]);
});

test('a missing digest or the first divergent frame fails even during warmup', async () => {
  const make = (last, frameOffset = 0) => {
    let ticks = 0;
    return {async execute() { ticks++; return {world: {frame: ticks + frameOffset}, observation_digest: ticks === 2 ? last : digest}; }};
  };
  for (const [last, offset, message] of [
    [undefined, 0, /Missing frame or canonical after digest at replay tick 2/],
    ['sha256:' + '0'.repeat(64), 0, /REPLAY_MISMATCH at tick 2/],
    [digest, 1, /REPLAY_MISMATCH at tick 1/],
  ]) {
    const rows = [];
    await assert.rejects(replay({before: make(digest), after: make(last, offset)}, [], 4, rows), message);
    assert.equal(rows.length, offset === 1 ? 0 : 1);
  }
});

test('warmup is excluded from percentiles, paired differences and win counts', () => {
  const values = [[500,1], [5,1], [3,4], [10,9], [11,10]].map(([before_ms, after_ms]) => ({before_ms, after_ms}));
  const summary = summarize(values, 1);
  assert.equal(summary.pairs, 4);
  assert.equal(summary.after_faster_pairs, 3);
  assert.equal(summary.before.p50_ms, 5);
  assert.equal(summary.after.p95_ms, 10);
  assert.equal(summary.paired_after_minus_before.p50_ms, -1);
});

test('each allocated VM closes once on initial load or digest failure, tick failure and success', async () => {
  for (const [scenario, pattern] of [
    ['failure during second load', /load failed/], ['divergent load', /REPLAY_MISMATCH at tick 0/],
    ['divergent tick', /REPLAY_MISMATCH at tick 1/], ['failed tick and cleanup', /tick failed/],
    ['failed cleanup only', /cleanup failed/], ['success', null],
  ]) {
    const calls = [], report = {rows: [], state: {before: {aborts: []}, after: {aborts: []}}};
    const otherDigest = 'sha256:' + '2'.repeat(64);
    const open = async (side, state) => {
      state.close = () => {
        calls.push(side);
        if (side === 'before' && scenario.includes('cleanup')) throw Error('cleanup failed');
      };
      if (side === 'after' && scenario === 'failure during second load') throw Error('load failed');
      state.loaded_frame = 0;
      state.loaded_digest = side === 'after' && scenario === 'divergent load' ? otherDigest : digest;
      return {async execute() {
        if (side === 'after' && scenario === 'failed tick and cleanup') throw Error('tick failed');
        return {world: {frame: 1}, observation_digest: side === 'after' && scenario === 'divergent tick' ? otherDigest : digest};
      }};
    };
    const result = runPlayers(open, [], 1, report);
    if (pattern) await assert.rejects(result, pattern); else await result;
    assert.deepEqual(calls, ['before', 'after']);
    assert.equal(report.state.after.closed, true);
    assert.equal(Object.hasOwn(report.state.before, 'close'), false);
  }
});

test('preflight requires a clean production runtime; reports are fresh and outside both exports', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unone-compare-replay-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const dir = path.join(root, 'published'), input = path.join(root, 'input.json'), output = path.join(root, 'out.json');
  const metadata = Buffer.from(JSON.stringify({source_dirty: true}));
  const record = dataRecord('runtime/runtime.json', metadata);
  writePublication(dir, '<head></head>', new Map([[record.path, record]]), {
    variant: 'production', profile: 'release', renderer_mode: 'custom', dev_tools: false, preview_tools: false,
  });
  fs.writeFileSync(input, '[{}]');
  assert.throws(() => verifiedExport(dir), /WEB_REFRESH_BASE_INVALID/);
  const args = ['--before', dir, '--after', dir, '--input-sequence', input, '--out'];
  await assert.rejects(main([...args, path.join(dir, 'report.json')]), /outside both exports/);
  await assert.rejects(main([...args, output]), /WEB_REFRESH_RUNTIME_VARIANT/);
  const report = JSON.parse(fs.readFileSync(output));
  assert.equal(report.ok, false);
  assert.equal(report.rows.length, 0);
  assert.equal(report.input.sha256, sha('[{}]'));
  const contents = fs.readFileSync(output);
  await assert.rejects(main([...args, output]), /EEXIST/);
  assert.deepEqual(fs.readFileSync(output), contents);
  fs.writeFileSync(path.join(dir, 'runtime/runtime.json'), '{}');
  await assert.rejects(main([...args, path.join(root, 'tampered.json')]), /WEB_REFRESH_BASE_HASH/);
});
