// Finalize the reviewed assessment without altering the proposal or product.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = JSON.parse(await readFile(resolve(here, 'audit.proposed.json'), 'utf8'));
for (const file of [...report.subject, ...report.evidence]) {
  assert.equal(hash(await readFile(resolve(root, file.path))), file.sha256, `Changed evidence: ${file.path}`);
}
const reviewPath = 'docs/audits/spatial-scout-2026-10-23/semantic-review.md';
const review = await readFile(resolve(root, reviewPath));
report.evidence.push({id: 'semantic-review', kind: 'observation', path: reviewPath,
  sha256: hash(review), quote: 'No mandatory rating change is required.'});
const performance = report.checks.find(check => check.id === 'performance');
performance.answer = 'Public runs expose actual CPU script/physics/observe timings, frame statistics, counts and Luau memory, as well as capacity and selected backend. The successful two-frame sample reports total 1.006 ms and phase totals 0.767/0.027/0.130 ms. These target measurements are distinct from command wall times.';
performance.reason = 'Rating 2 reflects incomplete attribution of spatial execution/transfer/application work and the absence of a meaningful bounded spatial profiling workload. CPU telemetry exists with explicit debug-build caveats. Missing GPU metrics alone is not grounds for this rating; neither GPU runtime nor acceleration thresholds were evaluated.';
performance.nextAction = 'Expose spatial work costs or explicit unavailability, then profile a bounded end-to-end batch workload before choosing automatic execution thresholds.';
performance.evidence.push('semantic-review');
const reproducibility = report.checks.find(check => check.id === 'reproducibility');
reproducibility.answer = 'The audit pins the existing executable by SHA-256, fingerprints 33 selected subject files, retains failed and workaround captures, verifies the 26-file blind evidence seal, and repeats the same-seed scenario with equal digests.';
reproducibility.reason = 'These are local CPU/public-interface and bounded source-review results. Source fingerprints are not immutable source copies. The existing binary is identified independently of source HEAD. Three cases were actually rerun after a concurrent source change; old captures remain historical. No clean SDK build or cross-device reproduction is claimed.';
reproducibility.evidence.push('semantic-review');
report.trial.limitations.push(
  'After the original three captures, unrelated native-player source changed. All three cases were actually rerun as capture-initial-current.json, capture-workaround-current.json and capture-current.json against matching selected hashes. The original captures are retained as historical/stale evidence, not silently refreshed.',
  'The 33 source subjects are fingerprinted, not retained as immutable source copies. Only the 26-file blind directory has a separately verified seal. The fresh semantic reviewer independently checked that seal.',
  'A top-level --help subprocess timed out in the current informed captures. Narrower discovery and successful geometry scenarios completed; not every subprocess passed. This isolated timeout is not classified as a spatial-contract failure.',
  'The final assessment incorporates an independent semantic review. Performance 2 and 70.75 are retained for incomplete spatial-cost attribution; generic CPU observability could reasonably be calibrated as 3. The needs_work gate is unchanged.'
);
await writeFile(resolve(here, 'audit.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
const evaluated = spawnSync(process.execPath, [
  'plugins/org.unone.ai-native/cli.mjs', 'evaluate', '--root', root,
  '--report', 'docs/audits/spatial-scout-2026-10-23/audit.json'
], {cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024});
assert.ok(!evaluated.error, String(evaluated.error));
await writeFile(resolve(here, 'evaluation.json'), evaluated.stdout, {flag: 'wx'});
assert.equal(evaluated.status, 0, evaluated.stderr || evaluated.stdout);
const evaluation = JSON.parse(evaluated.stdout);
assert.equal(evaluation.ok, true);
assert.equal(evaluation.value.index, 70.75);
assert.equal(evaluation.value.gate, 'needs_work');
assert.deepEqual(evaluation.value.blockers, ['observation']);

const summary = `# Spatial v1 Scout audit — 2026-10-23

Scout result: **70.75/100, needs_work**, with observation as the critical blocker. This is the fixed ten-question rubric 1.0.0 applied to the repository public spatial API and headless CPU authoring task. It is not an overall engine score, statistical AI-usability estimate, GPU acceptance result or certification.

The generic engine boundary is sound in the reviewed paths. A fresh AI discovered the public API from the repository README and CLI, understood geometry versus gameplay ownership, and completed nearest, overlap and moving-target sphere sweep without reading implementation source. Two natural cross-API assumptions required workarounds. The correct conclusion is that the core contract is understandable, while return-value composition still creates avoidable authoring failures.

## Confirmed findings

| ID | Priority | Finding and evidence | Recommended correction |
|---|---|---|---|
| 001 | P2 | Officially typed spatial.info() passes typecheck but direct observation publication fails: limits.safe_integer is 2^53−1 while the native observation integer branch accepts signed 32-bit values. Reproduced independently and in the recorder. | Align the diagnostic representation and observation numeric contract; require direct publication to pass typecheck and runtime. |
| 002 | P2 | SpatialBatchResult cannot be passed directly to typed observation.set. The blind author needed an explicit typed adapter. | Provide compatible canonical types or a generic serialization path, with a working typed example. |
| 003 | P2 | Accepted body position {3e-23,0,0}, radius 0, queried from origin produces an invalid normal and faults the CPU manager. Both existing debug and release executables reproduce the failure. | Use scale-safe normalization on CPU and shared WGSL, or reject an explicitly documented unsupported scale before accepting input; add numeric regressions. |
| 004 | P2 | Static SDK inventory tracing finds that portable packing omits the complete spatial guide; descriptors do not link to it. This was not a newly packed SDK trial. | Include and link the canonical guide, verify package inventory, then run a fresh SDK-only authoring trial. |

The source review also records two lower-priority observations: direct JavaScript validation accepts sparse vectors and packs NaN; collision/Chinese discovery phrases miss the capability. The sparse-vector repro only executes Node validation/packing, not an actual GPU job; canonical Rust-generated Web batches are dense. No P1 lifecycle defect was confirmed in this bounded review.

## Fresh AI author trial

The fresh author received only repository README/CLI entrypoints, a generic geometry task and side-effect limits. It found the linked guide itself; it was not supplied implementation details or the rubric. First delivered geometry occurred at operation 17. The final strict typecheck passed at operation 23 and the final runtime at 24, with 11 independent geometry/lifecycle assertions. The retained lane has 27 operations, no source fallback, and two natural wrong assumptions: direct result publication and direct info publication. Deliberate negative cases and a shell-quoting failure are excluded from that count.

Nearest returned masked ID 10 at distance 2; overlap returned ordered IDs 10 and 40; the moving-target sweep returned ID 30 at fraction 0.4071523249 against analytic 0.4071523309. Early take, consumed tickets, invalid radius, atomic repair and frozen versions were exercised. This is one author trial, not evidence about every AI user.

The informed initial capture failed before its intended geometry and overflow checks because info publication failed. Its generic 65-contact failure is therefore not overflow evidence. The separate successful variant converts only info.limits.safe_integer to a string before publication. It exercises packed/table batches, snapshot versions after update/destruction, cancellation, same-seed digest equality, and a cause-specific 65-contact overflow followed by a new successful 64-contact runtime. This fixture workaround does not repair the product.

Public discovery in the current informed capture:

| Query | Matches | Response UTF-8 bytes |
|---|---:|---:|
| spatial | 9 | 13,962 |
| GPU spatial | 8 | 12,582 |
| batch collision | 0 | 2,499 |
| GPU collision | 0 | 2,495 |
| 空間查詢 | 0 | 2,493 |
| 批次碰撞查詢 | 0 | 2,505 |
| nearest | 1 | 1,904 |

The successful raw CPU run contains real script/physics/observe timings, counts and memory: one two-frame sample totals 1.006 ms, with phase totals 0.767/0.027/0.130 ms and 1,114,144 Luau heap bytes. These are debug-build target measurements, distinct from subprocess duration. Performance rating 2 reflects incomplete spatial-cost attribution and a meaningful profiling workload; it does not imply absent CPU telemetry. The independent reviewer considers 3 a reasonable alternative calibration for generic CPU observability. No GPU performance requirement or acceleration conclusion is inferred.

## Evidence and scope

- [Final structured assessment](audit.json) and [actual Scout evaluation](evaluation.json).
- [Fresh author's report](blind/report.md), [operation ledger](blind/operations.ndjson), [typed final example](blind/final-example/main.luau), and [seal verification](blind-verification.json).
- Current recorder executions: [original failing scenario](informed/capture-initial-current.json), [explicit workaround scenario](informed/capture-workaround-current.json), [bounded numeric/discovery probe](design/capture-current.json).
- [Independent source/design review](design/source-review.md) and [fresh semantic review](semantic-review.md).
- [Original proposal](audit.proposed.json) and [proposal evaluation](evaluation.proposed.json) remain preserved alongside the finalized, corrected wording.

The existing debug executable is pinned by SHA-256 a5da57e920476a7665aab1905f3e48f8c78f1693dbe6f3ac349fba1ad15c587f, independently of checkout HEAD. Thirty-three selected subject files are fingerprinted, not immutable source snapshots. The 26 blind files have a detached manifest hash; both aggregate checks and the fresh reviewer verified all covered hashes and lengths. This confirms artifact consistency, not semantic correctness or source-to-binary identity.

After the original three captures, an unrelated native-player source file changed in another task. All three cases were actually rerun against the current matching selected hashes; the old captures remain historical/stale and were not relabelled by updating hashes. The recorder envelopes were not timed out or truncated, but the current raw logs retain a timed-out top-level --help subprocess. Narrower help/discovery and the successful geometry scenarios completed. We do not claim every subprocess passed.

All ten rubric questions have attached evidence, yielding 100% scoped rubric execution/public-execution coverage. That is not code coverage or complete API/device coverage. This audit performs no new GPU runtime, device-loss, visual, cross-platform, clean SDK-pack or acceleration test. Prior implementation checks are not substituted for those missing trials. Source findings and informed public probes are not relabelled as blind behavior.

No engine or game source was changed, no tools installed, and no commit/push performed during this audit. Only new audit artifacts and synthetic local fixtures were written. Preserve the failures, fix the four P2 contracts, then run a captured regression and a new independent SDK-only author trial.
`;
await writeFile(resolve(here, 'README.md'), summary, {flag: 'wx'});
console.log(JSON.stringify({index: evaluation.value.index, gate: evaluation.value.gate,
  blockers: evaluation.value.blockers, coveragePercent: evaluation.value.coveragePercent,
  output: 'docs/audits/spatial-scout-2026-10-23/README.md'}));
