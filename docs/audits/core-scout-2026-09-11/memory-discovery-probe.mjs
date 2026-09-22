// Reviewed, explicitly invoked local probe. Not a sandbox or a product command.
// Public CLI and the published diagnostics example only. Never opens a real game.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
assert.equal(args.length, 2);
assert.equal(args[0], '--root');
const root = path.resolve(args[1]);
const audit = path.join(root, 'docs/audits/core-scout-2026-09-11');
const identity = JSON.parse(readFileSync(path.join(audit, 'subject/binary.json'), 'utf8'));
const binary = path.join(root, identity.path);
const hash = value => createHash('sha256').update(value).digest('hex');
const verifyBinary = () => assert.equal(hash(readFileSync(binary)), identity.sha256, 'Select the audited executable; do not replace the old hash to claim a retest.');
verifyBinary();
const temp = mkdtempSync(path.join(os.tmpdir(), 'unone-core-memory-capture-'));
const project = path.join(temp, 'starter');
const raw = path.join(temp, 'raw');
mkdirSync(project); mkdirSync(raw);
let step = 0;
function run(label, argv, { projectRoot = project, ok = true, select = e => e } = {}) {
  const command = ['--project', projectRoot, '--json', ...argv];
  const result = spawnSync(binary, command, { cwd: temp, encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
  const id = ++step;
  writeFileSync(path.join(raw, `${id}-${label}.stdout`), result.stdout ?? '');
  writeFileSync(path.join(raw, `${id}-${label}.stderr`), result.stderr ?? '');
  assert.ifError(result.error);
  const envelope = JSON.parse(result.stdout);
  console.log(JSON.stringify({ step: id, label, command: [binary, ...command], exitCode: result.status,
    stdoutBytes: Buffer.byteLength(result.stdout), stdoutSha256: hash(result.stdout), stderr: result.stderr,
    // Large discovery outputs are explicitly selected, not disguised as complete transcripts.
    selection: select(envelope) }));
  assert.equal(envelope.ok, ok, `${label}: unexpected EngineResult.ok`);
  if (ok) assert.equal(result.status, 0);
  else assert.notEqual(result.status, 0);
  return envelope;
}

console.log(JSON.stringify({ probe: 'public-discovery-memory-replay', mode: 'informed', binary: identity, temp,
  limitations: ['Windows x64 existing binary; not a clean source build or other platform test.',
    'CLI/headless only. No renderer, browser, provider, account, network, packaging or GUI operations.',
    'Actual raw subprocess output is retained in the displayed C: temp directory; capture explicitly selects large discovery output.',
    'Full-GC diagnostic workload is not a normal gameplay timing baseline.'] }));

run('init', ['project', 'init', '--name', 'Core audit memory capture']);
const caps = run('platform-snapshot', ['platform', 'snapshot'], { select: e => ({ ok: e.ok, diagnostics: e.diagnostics,
  platform: e.value?.platform, core: e.value?.core, capabilities: e.value?.capabilities, renderers: e.value?.renderers,
  omitted: ['project_systems', 'plugins', 'plugin_search_roots'] }) });
assert.equal(caps.value.core.renderer_probe, 'not_probed');
run('api-search-no-match', ['api', 'search', '記憶體 GC 效能瓶頸']);
const search = run('api-search-move', ['api', 'search', 'move entity'], { select: e => ({ ok: e.ok, diagnostics: e.diagnostics,
  query: e.value?.query, matchCount: e.value?.matches.length, names: e.value?.matches.map(m => m.name),
  firstMatch: e.value?.matches[0], omitted: 'Full remaining descriptors; byte count/hash refers to complete original stdout.' }) });
assert.ok(search.value.matches.some(m => m.name === 'entity.setPosition'));
run('api-describe-position', ['api', 'describe', 'entity.setPosition']);
const tests = run('starter-tests', ['test']);
assert.equal(tests.value.passed, true);
assert.equal(tests.value.cases.length, 2);
const fingerprint = run('starter-fingerprint', ['replay', 'fingerprint']);
assert.equal(fingerprint.value.engine.coreRevision, `sha256:${identity.sha256}`);
run('starter-perf', ['perf', '--frames', '60', '--seed', '42']);

const fixture = path.join(temp, 'diagnostics');
cpSync(path.join(audit, 'subject/diagnostics'), fixture, { recursive: true, errorOnExist: true });
const requestFile = path.join(fixture, 'request.json');
const helperArgs = [path.join(fixture, 'create-request.mjs'), binary, requestFile];
const helper = spawnSync(process.execPath, helperArgs, { cwd: temp, encoding: 'utf8', windowsHide: true, timeout: 15000 });
console.log(JSON.stringify({ step: ++step, label: 'public-example-generate-request', command: [process.execPath, ...helperArgs],
  exitCode: helper.status, stdout: helper.stdout, stderr: helper.stderr,
  nestedCli: 'The public helper calls replay fingerprint exactly once.' }));
assert.ifError(helper.error); assert.equal(helper.status, 0);
const request = JSON.parse(readFileSync(requestFile, 'utf8'));
const requestBefore = hash(readFileSync(requestFile));
assert.equal(request.target.engine.coreRevision, `sha256:${identity.sha256}`);
const wrong = structuredClone(request);
wrong.reproduction.engine.coreRevision = `sha256:${'0'.repeat(64)}`;
const wrongFile = path.join(fixture, 'wrong-version.json');
writeFileSync(wrongFile, JSON.stringify(wrong, null, 2));
const invalid = run('replay-wrong-executable', ['replay', 'scenario', '--request', wrongFile], { projectRoot: path.join(fixture, 'project'), ok: false });
assert.equal(invalid.value.status, 'incompatible');
assert.equal(invalid.value.ticksExecuted, null, 'Refusal before simulation must not claim a measured zero ticks.');
const repaired = run('replay-original-valid-capture', ['replay', 'scenario', '--request', requestFile], { projectRoot: path.join(fixture, 'project') });
assert.equal(repaired.value.status, 'reproduced');
assert.equal(repaired.value.regressionStatus, 'passed');
assert.equal(repaired.value.ticksExecuted, 40);
const memory = repaired.value.memory;
assert.equal(memory.samples.length, 4);
assert.equal(memory.samples.filter(s => s.warmup).length, 1);
assert.equal(memory.trends[0].samples, 3);
assert.equal(memory.trends[0].leak_proven, false);
assert.equal(memory.unavailable.gpu_bytes, null);
assert.equal(memory.unavailable.rust_heap_bytes, null);
assert.ok(memory.samples.every(s => s.collected && typeof s.full_gc_wall_ms === 'number'));
assert.equal(hash(readFileSync(requestFile)), requestBefore, 'Wrong-version test must preserve the original capture.');
verifyBinary();
console.log(JSON.stringify({ result: 'ALL_CHECKS_PASSED', explicitProcessSteps: step, nestedCliSteps: 1,
  assertions: 'Discovery, two starter tests, actual executable identity, wrong-version refusal, repair, four explicit GC samples, warmup exclusion, unavailable metrics null, original request preserved, binary unchanged.',
  tempPreserved: temp, noProductFilesChanged: true }));
