import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const projectRoot = resolve(readArg('--root') ?? process.env.UNONE_PROJECT_ROOT ?? process.cwd());
const pluginDir = join(projectRoot, 'plugins', 'org.unone.ai-native');
const entry = join(pluginDir, 'plugin.mjs');
const evaluateContractHash = '43e7a378c1a6fc4b2e161e88ea94ef08936a20e30b3e50a641224467c54eb6dd';

const report = {
  schema: 'unone.ai-native.audit.v1',
  rubricVersion: '1.0.0',
  target: {
    id: 'org.unone.ai-native',
    name: 'Unone AI-native Audit',
    surface: 'plugin',
    scope: 'Documented public read-only audit workflow: recommend, describe, init, catalog, snapshot, diagnostics, and evaluate through the standalone CLI and JSON-line entry. Registry writes, remote host/MCP integration, and source/ or test/ contents are outside this scope.',
    version: '0.3.0',
    revision: 'HEAD 1b166704fa4b3dc2a7a757c57e3f9778d678cf4a; selected plugin files are untracked in this working tree.',
    environment: 'Windows x64; Node v24.14.1; local project root D:\\Projects\\Unone; public CLI and JSON-line calls.',
  },
  trial: {
    mode: 'blind',
    entryPoints: [
      'plugins/org.unone.ai-native/README.md',
      'node cli.mjs recommend/describe/init/catalog/snapshot/evaluate',
      'node plugin.mjs JSON-line recommend/describe/call',
      'node scripts/record-probe.mjs with explicitly reviewed local probes',
    ],
    steps: 27,
    firstSuccessStep: 26,
    sourceFallbackStep: null,
    wrongGuesses: 1,
    limitations: [
      'No src/ or test/ file contents were inspected; conclusions cover only the public README, docs, manifest, CLI, describe output, callable operations, and their selected-file hashes.',
      'No ai_native.register call or registry write was performed; the write authorization route is described but not runtime-tested.',
      'No remote host, live MCP transport, GUI, external network, account, or real target was used.',
      'Recorder probes used only local synthetic requests. Reported durations are local process wall time, not model-token, production-target, or resource-cost measurements.',
    ],
  },
  subject: [
    { path: 'plugins/org.unone.ai-native/README.md', sha256: 'a0e6e0c3fce233a8cd1090755e9a01525dae91bd21bc178bce0701b994be06a8' },
    { path: 'plugins/org.unone.ai-native/docs/discovery.md', sha256: '2729fff911604a70c0da7276fca3c13b381231981a978b54be78a9fc8a05dca2' },
    { path: 'plugins/org.unone.ai-native/docs/report.md', sha256: 'aed7a2738c9793927a09b7ed90774993ff636744e97e266ac3cf117fae6fa959' },
    { path: 'plugins/org.unone.ai-native/package.json', sha256: 'd07d7a8b947c682dc34e09d0f09e84fffb265afeaf4fc72a1bd7ea669e2edf16' },
    { path: 'plugins/org.unone.ai-native/plugin.json', sha256: '751e8b82c56d11e3dd8f7d53a472d98bc8ae06d7f00e5b5f1ea1a6d1b2163251' },
    { path: 'plugins/org.unone.ai-native/cli.mjs', sha256: '54db5ffe0df3a19af6da74586ab609541c2d0cdeafb61e009d2d3114133f4e1c' },
    { path: 'plugins/org.unone.ai-native/plugin.mjs', sha256: '1aab474aba641ad7077b5eea18f6f6fe516fb47fcade6e8cb02e8400f396f154' },
  ],
  evidence: [
    {
      id: 'doc-readme', kind: 'document', path: 'plugins/org.unone.ai-native/README.md',
      sha256: 'a0e6e0c3fce233a8cd1090755e9a01525dae91bd21bc178bce0701b994be06a8',
      quote: '衡量「陌生 AI 是否能自己找到、用對、看懂結果、修復錯誤」的開發插件。',
    },
    {
      id: 'doc-discovery', kind: 'document', path: 'plugins/org.unone.ai-native/docs/discovery.md',
      sha256: '2729fff911604a70c0da7276fca3c13b381231981a978b54be78a9fc8a05dca2',
      quote: '新建／自評意圖同時符合 init 與 evaluate 時，init 固定排第一',
    },
    {
      id: 'doc-report', kind: 'document', path: 'plugins/org.unone.ai-native/docs/report.md',
      sha256: 'aed7a2738c9793927a09b7ed90774993ff636744e97e266ac3cf117fae6fa959',
      quote: '最高 4 需要執行證據',
    },
    {
      id: 'doc-manifest', kind: 'document', path: 'plugins/org.unone.ai-native/plugin.json',
      sha256: '751e8b82c56d11e3dd8f7d53a472d98bc8ae06d7f00e5b5f1ea1a6d1b2163251',
      quote: '"version": "0.3.0"',
    },
    {
      id: 'exec-call', kind: 'execution', path: 'plugins/org.unone.ai-native/audits/scout-self-2026-09-16/probe-capture-blind-20260916T0120Z.json',
      sha256: 'b9f5ea567290372261ad9c6594be83b6c35a417385308a3292ef85eb8893a52f',
      quote: 'AUDIT_PATH_OUTSIDE_ROOT',
    },
    {
      id: 'exec-cli', kind: 'execution', path: 'plugins/org.unone.ai-native/audits/scout-self-2026-09-16/probe-cli-capture-blind-20260916T0120Z.json',
      sha256: 'f94ecbf75b4a0b6e51c07f3a17da4e97c562455acf0e27f1371c1526aabdf6a5',
      quote: 'ai_native.init',
    },
    {
      id: 'exec-register-describe', kind: 'execution', path: 'plugins/org.unone.ai-native/audits/scout-self-2026-09-16/probe-register-describe-capture-blind-20260916T0120Z.json',
      sha256: '3b60879f9c6559cda3cee40829c308362756363b0075dc2a338dbecbd01eaaa8',
      quote: 'Explicit CLI register or trusted-host registryWrite opt-in',
    },
  ],
  checks: [],
  issues: [
    {
      id: 'registry-write-unverified', checkId: 'boundaries', severity: 'P2',
      summary: 'The write route is documented but intentionally excluded from runtime verification.',
      cause: 'The task forbids calling register or performing registry writes. Describe shows a non-read-only operation requiring explicit CLI use or trusted-host registryWrite opt-in, while this trial verified only read-only calls and rejection of a traversal path.',
      fix: 'Expose a read-only host capability/status query for registry-write availability, then test denial and authorized append in a separate isolated host test.',
      verification: 'Use a temporary project root and a test host: confirm a read-only permission query reports disabled/enabled correctly, denial creates no record, and one explicitly authorized append creates exactly one record.',
      evidence: ['exec-register-describe', 'exec-call'],
    },
    {
      id: 'local-performance-only', checkId: 'performance', severity: 'P2',
      summary: 'Timing is observable, but only for local plugin/process work.',
      cause: 'Telemetry explicitly labels elapsed_ms as plugin wall time and returns null for GPU time; there is no cost or resource measurement for a real host/target in this scoped trial.',
      fix: 'Keep unavailable measures null and, if host-backed work is added, expose host-level duration/resource fields with clear scope labels.',
      verification: 'Run a representative host-backed operation and verify timings/resources are present only when measured, while unsupported metrics remain null rather than zero.',
      evidence: ['doc-report', 'exec-cli'],
    },
  ],
};

const rows = [
  ['purpose', 4, 'README states the tool measures whether an unfamiliar AI can find, use, understand results, and repair errors; recommend returned init and evaluate in that order.', 'The public entry explains what Scout is and is not, and captured recommendation output selected init before evaluate with explicit keyword-match limitations.', 'Keep the short purpose/limitation statement visible at first discovery; regression-check representative English and Chinese intents when keywords change.', ['doc-readme', 'doc-discovery', 'exec-cli', 'exec-call']],
  ['capabilities', 4, 'Recommend identifies available operations and next steps; catalog lists all ten criteria, weights, caps, statuses, and non-goals; describe returns one selected contract.', 'The captured outputs expose the ten checks, operation names, requirements, and deterministic keyword limitations without claiming semantic discovery.', 'Add a small bilingual query set for intended candidates, no-match cases, and ambiguous tasks, then verify ranking and explanations.', ['doc-readme', 'doc-discovery', 'exec-cli']],
  ['operation', 3, 'The documented recommend → describe → call sequence returned a usable init skeleton, and evaluate exposes a complete in-memory report contract with report/report_path exclusivity.', 'CLI and JSON-line calls succeeded for discovery, describe, init, catalog, and snapshot. A complete evaluation is being exercised through this public call now.', 'Preserve the direct in-memory report path and the CLI stdin alternative; keep one end-to-end completed report in a repeatable capture.', ['doc-report', 'exec-cli', 'exec-call']],
  ['context', 3, 'The report contract carries target identity, scope, package and operation versions, revision, environment, trial, selected subject hashes, evidence, and unresolved issues.', 'Describe makes per-operation version scope explicit; the completed report binds selected docs/CLI/entry hashes and states the limits of this local run.', 'Keep scope and environment required, and show unresolved host/write paths as limitations rather than implied coverage.', ['doc-report', 'doc-manifest', 'exec-cli']],
  ['observation', 3, 'The evaluator output is designed to return score bounds, coverage, gate, gaps, issues, and diagnostics; operation outputs also label their own elapsed time as plugin wall time.', 'The public contract and captured failures distinguish ok/value/diagnostics/effects/telemetry; the completed score output will be captured by this call.', 'Keep gate, index/range, coverage, issues, and execution limitations in the same response so callers can act without inferring status.', ['doc-report', 'exec-cli', 'exec-call']],
  ['diagnostics', 2, 'A stale contract returned DISCOVERY_CONTRACT_STALE with expected and actual hashes plus a describe-and-retry action; incomplete report and traversal attempts returned concrete error codes and facts.', 'The negative cases were actionable, but at this point the captured report contains no successful corrected evaluation result.', 'After each failure class, rerun the corrected request and record its successful result with the same subject and current contract hash.', ['exec-call', 'exec-cli']],
  ['recovery', 3, 'Stale contracts direct the caller to describe again; invalid report and out-of-root paths explain the required correction. No write retry was attempted.', 'The recovery instruction is explicit and operations are read-only; the successful corrected report call will exercise recovery without invoking register.', 'Keep safe retries tied to refreshed hashes and preserve the report/evidence unchanged while correcting only identified fields or paths.', ['doc-report', 'exec-call', 'exec-register-describe']],
  ['boundaries', 3, 'An out-of-root traversal was rejected as AUDIT_PATH_OUTSIDE_ROOT with expected and actual path details; describe register marks it non-read-only and requires explicit trusted-host opt-in.', 'The read-only flow produced no effects. The write operation itself was intentionally not called, so the result is scoped to read-only discovery/evaluation and path confinement.', 'Add a read-only authorization-status query and verify register denial/allowance only in a separately authorized temporary-root test.', ['exec-call', 'exec-register-describe', 'doc-readme']],
  ['performance', 3, 'CLI and callable outputs expose local elapsed time and explicitly report GPU time as null; recorder captures also preserve local wall durations.', 'The plugin does not claim these values are target performance or cost; no target/resource workload was run.', 'Retain explicit scope labels and null for unavailable measures; add host-level metrics only if heavier host-backed operations are introduced.', ['doc-report', 'exec-cli', 'exec-call']],
  ['reproducibility', 3, 'Snapshot returns selected-file SHA-256 hashes; recorder captures preserve command/input/output, environment, probe hash, subject hashes, duration, exit code, truncation, and source-change state.', 'The selected subject was exactly the same seven files in all captures; all captures completed untruncated with sourceChanged=false.', 'Keep each capture immutable and rerun with a new output path after any subject/probe change; do not refresh old hashes in place.', ['doc-report', 'exec-cli', 'exec-call']],
];

report.checks = rows.map(([id, rating, answer, reason, nextAction, evidence]) => ({
  id,
  status: rating >= 3 ? 'verified' : rating > 0 ? 'partial' : 'failed',
  rating,
  access: 'public',
  answer,
  reason,
  nextAction,
  evidence,
}));

const request = {
  protocol: 'unone.plugin.v1',
  action: 'call',
  plugin: 'org.unone.ai-native',
  tool: 'ai_native.call',
  input: {
    operation: 'ai_native.evaluate',
    contractHash: evaluateContractHash,
    arguments: { report },
  },
};
const stdin = `${JSON.stringify(request)}\n`;
const started = process.hrtime.bigint();
const child = spawnSync(process.execPath, [entry], {
  cwd: pluginDir,
  env: { ...process.env, UNONE_PROJECT_ROOT: projectRoot },
  input: stdin,
  encoding: 'utf8',
  timeout: 10_000,
  maxBuffer: 2 * 1024 * 1024,
});

process.stdout.write(`${JSON.stringify({
  schema: 'org.unone.ai-native-audit.evaluation-observation.v1',
  projectRoot,
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  command: [process.execPath, entry],
  cwd: pluginDir,
  environment: { UNONE_PROJECT_ROOT: projectRoot },
  request,
  stdout: child.stdout ?? '',
  stderr: child.stderr ?? '',
  exitCode: child.status,
  signal: child.signal,
  elapsedMs: Number(process.hrtime.bigint() - started) / 1_000_000,
  spawnError: child.error?.message ?? null,
})}\n`);
