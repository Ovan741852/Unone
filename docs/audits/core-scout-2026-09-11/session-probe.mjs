// Reviewed reproduction of the already-recorded first-use path; not a new blind test.
// Do not run until the parent has reviewed this file. Only Node built-ins are used.
// Usage: node replay-probe.mjs --root D:\Projects\Unone
// Parent review changes: include actual selected CLI / full session responses in
// recorder stdout and verify the executable again after execution. The original
// author's hash was 982efc1adba55e33add3f3a27c0a70111178f77315384242aae7098546bdd91c.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const EXPECTED_BINARY_SHA256 = '6af56a589c4a39d3f16e176cfb2fc817ef7fcbbe7836e160c516973e86cc8c8e';
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--root') {
  throw new Error('Usage: node replay-probe.mjs --root <repository root>');
}
if (process.platform !== 'win32') throw new Error('This recorded reproduction requires the same Windows binary.');
const repo = fs.realpathSync(path.resolve(args[1]));
const binary = path.join(repo, 'target', 'release', 'game.exe');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const binaryBytes = fs.readFileSync(binary);
const binarySha256 = hash(binaryBytes);
assert.equal(binarySha256, EXPECTED_BINARY_SHA256, 'Binary changed. Review the new binary explicitly; this probe will not substitute it.');
const tempBase = fs.realpathSync(os.tmpdir());
if (path.parse(tempBase).root.slice(0, 2).toLowerCase() !== 'c:') throw new Error('OS temp must be on C: for this reproduction.');
const output = fs.mkdtempSync(path.join(tempBase, 'unone-core-replay-'));
const game = path.join(output, 'game');
const raw = path.join(output, 'raw');
fs.mkdirSync(game);
fs.mkdirSync(raw);
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
const event = value => fs.appendFileSync(path.join(output, 'events.jsonl'), JSON.stringify({ utc: new Date().toISOString(), ...value }) + '\n');
const checkOk = result => { assert.equal(result.ok, true, JSON.stringify(result.diagnostics)); return result.value; };
const checkError = (result, code) => {
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === code), JSON.stringify(result.diagnostics));
  assert.deepEqual(result.effects, []);
};
const x = (value, id) => value.snapshot?.entities?.[id]?.transform?.x ?? value.snapshot?.['/transform']?.x;
const near = (actual, expected) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < 0.000002, `Expected ${expected}; received ${actual}`);
save('identity.json', {
  purpose: 'Reviewed repeat of existing public Core exploration; not a new blind test or cross-platform validation.',
  repo, executable: binary, binarySha256, binaryBytes: binaryBytes.length,
  platform: process.platform, node: process.version, output,
  externalInputs: ['Existing exact game.exe binary identified by SHA-256', 'Installed Node.js with built-in modules', 'Writable C: OS temp directory', 'Host OS/time/scheduler and inherited environment'],
  deliberatelyOmittedFromRepeat: ['verify: the first run required an unavailable separate luau-analyze, and this repeat invokes only game.exe', 'GPU/browser/provider/network/download/packaging/Rust builds'],
  firstUseTransportDifference: 'This harness closes its own child stdin with EOF. The first exploratory harness stopped its already-closed idle child by PID.'
});
console.log(`Evidence directory: ${output}`);
const children = new Set();

function spawnOwned(label, argv) {
  event({ type: 'process_start', label, executable: binary, argv, cwd: output });
  const child = spawn(binary, argv, { cwd: output, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child);
  child.once('close', (exitCode, signal) => {
    children.delete(child);
    event({ type: 'process_close', label, exitCode, signal });
  });
  return child;
}

async function cli(label, argv) {
  const start = new Date().toISOString();
  const child = spawnOwned(label, argv);
  let stdout = '', stderr = '', timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, 20000);
  child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); fs.appendFileSync(path.join(raw, `${label}.stdout`), chunk); });
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); fs.appendFileSync(path.join(raw, `${label}.stderr`), chunk); });
  child.stdin.end();
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode, signal) => resolve({ start, end: new Date().toISOString(), executable: binary, argv, cwd: output, exitCode, signal, timedOut, stdout, stderr }));
  }).finally(() => clearTimeout(timer));
  save(`raw/${label}.json`, result);
  assert.equal(result.timedOut, false, `${label} exceeded its timeout`);
  const parsed = label === '001-help' ? null : JSON.parse(stdout);
  const selectedOutput = label === '005-session-schema' ? { commands: parsed.oneOf.map(v => v.properties?.command?.const) }
    : label === '006-api-search-move' ? { query: parsed.value.query, names: parsed.value.matches.map(m => m.name) }
    : label.includes('platform-snapshot') ? { core: parsed.value?.core, platform: parsed.value?.platform }
    : parsed;
  console.log(JSON.stringify({ label, exitCode: result.exitCode, ok: parsed?.ok, diagnostics: parsed?.diagnostics,
    stdoutBytes: Buffer.byteLength(stdout), stdoutSha256: hash(stdout), selectedOutput,
    note: 'Large schema/search/platform output selected explicitly; complete raw stdout retained in evidence directory.' }));
  return { ...result, parsed };
}

function openTransport() {
  const label = '009-session';
  const argv = ['--project', game, 'session'];
  const child = spawnOwned(label, argv);
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  let pending = null;
  let next = 0;
  let closed = false;
  let failure = null;
  let stdout = '', stderr = '', stdin = '';
  const start = new Date().toISOString();
  const done = new Promise(resolve => {
    child.once('close', (exitCode, signal) => {
      closed = true;
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Session closed during ${pending.label}`));
        pending = null;
      }
      save(`raw/${label}.json`, { start, end: new Date().toISOString(), executable: binary, argv, cwd: output, exitCode, signal, stdin, stdout, stderr });
      resolve({ exitCode, signal });
    });
  });
  child.once('error', error => {
    failure = error;
    if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = null; }
  });
  child.stdout.on('data', chunk => {
    stdout += chunk.toString('utf8');
    fs.appendFileSync(path.join(raw, `${label}.stdout`), chunk);
    event({ type: 'stdout', label, data: chunk.toString('utf8') });
  });
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8');
    fs.appendFileSync(path.join(raw, `${label}.stderr`), chunk);
    event({ type: 'stderr', label, data: chunk.toString('utf8') });
  });
  lines.on('line', line => {
    if (!pending) { failure = new Error('Unsolicited response line'); child.kill(); return; }
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    try {
      const response = JSON.parse(line);
      save(`raw/${current.label}.json`, { request: current.request, response });
      console.log(JSON.stringify({ label: current.label, request: current.request, response }));
      current.resolve(response);
    } catch (error) { current.reject(error); }
  });
  return {
    async request(name, request) {
      if (failure) throw failure;
      if (closed) throw new Error('Session is closed');
      if (pending) throw new Error('Concurrent requests are not permitted by this reproduction');
      const label = `P${String(++next).padStart(2, '0')}-${name}`;
      const text = JSON.stringify(request) + '\n';
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending = null;
          failure = new Error(`${label} exceeded its timeout`);
          reject(failure);
          child.kill();
        }, 15000);
        pending = { label, request, resolve, reject, timer };
        stdin += text;
        fs.appendFileSync(path.join(raw, '009-session.stdin'), text);
        event({ type: 'stdin', label, data: text });
        child.stdin.write(text, error => {
          if (error && pending?.label === label) { clearTimeout(timer); pending = null; reject(error); }
        });
      });
    },
    async end() {
      if (!closed) child.stdin.end();
      const killTimer = setTimeout(() => { if (!closed) child.kill(); }, 3000);
      try { return await done; } finally { clearTimeout(killTimer); lines.close(); }
    }
  };
}

const fixturePaths = ['project.unone.json', 'scenes/main.scene.json', 'scripts/main.luau', 'tests/bootstrap-idle.test.json', 'tests/bootstrap-input.test.json'];
const fixtureFacts = () => fixturePaths.map(relative => {
  const bytes = fs.readFileSync(path.join(game, relative));
  return { path: relative, bytes: bytes.length, sha256: hash(bytes), contents: bytes.toString('utf8') };
});

let transport = null;
try {
  const help = await cli('001-help', ['--help']);
  assert.equal(help.exitCode, 0);
  assert.match(help.stdout, /session/);
  const empty = await cli('002-platform-snapshot-empty', ['--project', game, '--json', 'platform', 'snapshot']);
  checkError(empty.parsed, 'PROJECT_CONFIG_NOT_FOUND');
  assert.equal(empty.parsed.value.core.renderer_probe, 'not_probed');
  const init = await cli('003-project-init', ['--project', game, '--json', 'project', 'init', '--name', 'PublicCoreProbe']);
  checkOk(init.parsed);
  assert.equal(init.parsed.value.files.length, 5);
  const before = fixtureFacts();
  save('fixture-before.json', before);
  const scene = JSON.parse(before.find(file => file.path === 'scenes/main.scene.json').contents);
  const entityId = scene.entities[0].id;
  assert.equal(entityId, 'example', 'Starter changed; review the new fixture before reproducing the old path');
  const schema = await cli('005-session-schema', ['--project', game, 'session', '--schema']);
  for (const command of ['open', 'snapshot', 'step', 'watch', 'enact', 'perf', 'recording', 'replay', 'close']) {
    assert.ok(schema.parsed.oneOf.some(variant => variant.properties?.command?.const === command), `Schema no longer declares ${command}`);
  }
  const search = await cli('006-api-search-move', ['--project', game, '--json', 'api', 'search', 'move entity']);
  assert.ok(checkOk(search.parsed).matches.some(match => match.name === 'entity.setPosition'));
  const retry = await cli('007-project-init-retry', ['--project', game, '--json', 'project', 'init', '--name', 'PublicCoreProbe']);
  checkError(retry.parsed, 'PROJECT_ALREADY_EXISTS');
  const platform = await cli('008-platform-snapshot', ['--project', game, '--json', 'platform', 'snapshot']);
  assert.equal(checkOk(platform.parsed).core.renderer_probe, 'not_probed');

  transport = openTransport();
  const ask = (label, request) => transport.request(label, request);
  const initial = checkOk(await ask('open', { command: 'open', seed: 42 }));
  const session = initial.session;
  near(x(initial, entityId), 0);
  assert.equal(initial.host, 'headless');
  assert.equal(initial.mutation_policy, 'temporary_debug_state_patch');
  assert.equal(initial.gameplay_authority, 'luau_and_input');
  const selection = { selector: { kind: 'entity', id: entityId }, paths: ['/transform'] };
  const snap0 = checkOk(await ask('snapshot-initial', { command: 'snapshot', session, ...selection }));
  assert.equal(snap0.observation_digest, initial.observation_digest);
  const firstStep = { command: 'step', session, expected_revision: initial.revision, frames: 30, input: { actions: { Right: true } } };
  checkError(await ask('wrong-field', { ...firstStep, framse: 30 }), 'DEVELOPER_REQUEST_INVALID');
  const moved = checkOk(await ask('repair-field', firstStep));
  assert.equal(moved.completed_frames, 30);
  assert.equal(moved.frame, 30);
  near(x(moved, entityId), 0.5);
  checkError(await ask('retry-stale-revision', firstStep), 'REVISION_CONFLICT');
  const afterRetry = checkOk(await ask('snapshot-after-retry', { command: 'snapshot', session, ...selection }));
  assert.equal(afterRetry.revision, moved.revision);
  assert.equal(afterRetry.observation_digest, moved.observation_digest);
  const released = checkOk(await ask('release-input', { command: 'step', session, expected_revision: moved.revision, frames: 1, input: {} }));
  near(x(released, entityId), 0.5);
  assert.equal(released.frame, moved.frame + 1);
  const watchSelection = { selector: selection.selector, paths: ['/transform/x'] };
  const firstPage = checkOk(await ask('watch-page-one', { command: 'watch', session, after: moved.cursor - 2, limit: 1, ...watchSelection }));
  assert.equal(firstPage.has_more, true);
  assert.notEqual(firstPage.next_cursor, firstPage.cursor);
  assert.equal(firstPage.current.frame, released.frame);
  const secondPage = checkOk(await ask('watch-page-two', { command: 'watch', session, after: firstPage.next_cursor, limit: 1, ...watchSelection }));
  assert.equal(secondPage.has_more, false);
  assert.equal(secondPage.next_cursor, firstPage.cursor);
  assert.equal(secondPage.frame, released.frame);
  const operations = [{ selector: selection.selector, change: { op: 'set_position', position: { x: 10, y: 0 } } }];
  const dryRun = checkOk(await ask('enact-dry-run', { command: 'enact', session, expected_revision: released.revision, dry_run: true, operations }));
  assert.equal(dryRun.revision, released.revision);
  assert.ok(dryRun.changes.some(change => change.path === `/entities/${entityId}/transform/x` && change.before === 0.5 && change.after === 10));
  const afterDry = checkOk(await ask('snapshot-after-dry-run', { command: 'snapshot', session, ...selection }));
  near(x(afterDry, entityId), 0.5);
  assert.equal(afterDry.observation_digest, released.observation_digest);
  const committed = checkOk(await ask('enact-commit', { command: 'enact', session, expected_revision: released.revision, dry_run: false, operations }));
  assert.equal(committed.revision, released.revision + 1);
  assert.equal(committed.frame, released.frame);
  const finalState = checkOk(await ask('input-after-commit', { command: 'step', session, expected_revision: committed.revision, frames: 1, input: { actions: { Right: true } } }));
  near(x(finalState, entityId), 10 + 1 / 60);
  const perf = checkOk(await ask('perf', { command: 'perf', session }));
  assert.equal(perf.performance.frames, 32);
  assert.equal(perf.performance.counts.entities, 1);
  assert.ok(Number.isFinite(perf.performance.mean_frame_ms));
  assert.match(perf.measurement_scope, /excludes rendering/);
  const recording = checkOk(await ask('recording', { command: 'recording', session }));
  assert.equal(recording.commands.length, 4);
  assert.deepEqual(recording.commands.map(command => command.command), ['step', 'step', 'enact', 'step']);
  save('recording.json', recording);
  const replay = checkOk(await ask('replay', { command: 'replay', recording }));
  assert.equal(replay.identical, true);
  assert.equal(replay.script_changed, false);
  assert.equal(replay.engine_version_changed, false);
  const afterReplay = checkOk(await ask('snapshot-after-replay', { command: 'snapshot', session, ...selection }));
  assert.equal(afterReplay.revision, finalState.revision);
  assert.equal(afterReplay.observation_digest, finalState.observation_digest);
  assert.equal(checkOk(await ask('close-first', { command: 'close', session })).closed, true);
  const reopened = checkOk(await ask('reopen', { command: 'open', seed: 42 }));
  assert.notEqual(reopened.session, session);
  assert.equal(reopened.observation_digest, initial.observation_digest);
  checkError(await ask('old-session-id', { command: 'snapshot', session, ...selection }), 'SESSION_MISMATCH');
  const fresh = checkOk(await ask('snapshot-new-session', { command: 'snapshot', session: reopened.session, ...selection }));
  near(x(fresh, entityId), 0);
  assert.equal(fresh.frame, 0);
  assert.equal(fresh.revision, 0);
  assert.equal(checkOk(await ask('close-second', { command: 'close', session: reopened.session })).closed, true);
  const ended = await transport.end();
  transport = null;
  assert.equal(ended.exitCode, 0);
  const after = fixtureFacts();
  save('fixture-after.json', after);
  assert.deepEqual(after.map(file => [file.path, file.sha256]), before.map(file => [file.path, file.sha256]));
  assert.equal(hash(fs.readFileSync(binary)), EXPECTED_BINARY_SHA256, 'Executable changed during the probe.');
  console.log(JSON.stringify({ result: 'ALL_CHECKS_PASSED', sessionRequests: 22, totalOperationsIncludingLaunch: 30,
    unchangedAuthoringFiles: after.map(({path, sha256}) => ({path, sha256})), binarySha256,
    replayIdentical: replay.identical, normalTransportExitCode: ended.exitCode,
    verifyNotReplayed: true, measurementScope: perf.measurement_scope }));
  save('result.json', {
    ok: true, output, binarySha256, sessionRequests: 22, totalOperationsIncludingLaunch: 30,
    firstUseVerifyGateNotReplayed: true, unchangedAuthoringFiles: true, replayIdentical: true,
    measurementScope: perf.measurement_scope, performance: perf.performance,
    interpretation: 'The existing representative contracts reproduced on this exact Windows binary and synthetic fixture. Timings are observations, not a workload benchmark or rendered FPS claim.'
  });
  console.log(`Completed representative reproduction. Raw evidence: ${output}`);
} catch (error) {
  save('result.json', { ok: false, output, binarySha256, error: { name: error.name, message: error.message, stack: error.stack } });
  console.error(`Probe stopped. Partial evidence retained at ${output}\n${error.stack ?? error}`);
  process.exitCode = 1;
} finally {
  if (transport) await transport.end();
  for (const child of children) child.kill();
}
