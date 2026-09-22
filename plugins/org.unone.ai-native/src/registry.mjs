import { lstat, mkdir, realpath, open, link, unlink, opendir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { evaluate } from './audit.mjs';
import { AuditError, keys, text, relativePath, readProjectFile, readJson, sha256, within } from './files.mjs';

export const REGISTRY = '.unone/ai-native/assessments';
export const RECORD_SCHEMA = 'unone.ai-native.assessment.v1';
const MAX_RECORDS = 256;
const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
const evaluatorFiles = ['src/audit.mjs', 'src/rubric.mjs', 'src/files.mjs', 'src/registry.mjs'];

function fail(code, field, message, actual, fix) {
  throw new AuditError(code, field, message, 'Version-bound local assessment with intact evidence', actual, fix);
}
function assessmentId(id) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(id)) {
    fail('AUDIT_REGISTRY_ID_INVALID', 'assessment_id', 'Invalid assessment ID.', id, 'Use 1–80 lowercase letters, digits, underscores or hyphens; no Windows reserved names. Reuse the same ID only for the same registration intent.');
  }
  return id;
}
function recordPath(id) { return `${REGISTRY}/${assessmentId(id)}.json`; }

// No user-supplied output path. Reject directory links even when they point inside
// the project. This is not an OS sandbox against a hostile concurrent filesystem owner.
async function directory(root, create = false) {
  const base = await realpath(root);
  let current = base;
  for (const segment of REGISTRY.split('/')) {
    current = path.join(current, segment);
    let info;
    try { info = await lstat(current); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!create) return null;
      try { await mkdir(current, { mode: 0o700 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      info = await lstat(current);
    }
    if (!info.isDirectory() || info.isSymbolicLink() || !within(base, await realpath(current))) {
      fail('AUDIT_REGISTRY_PATH_UNSAFE', 'registry', 'Registry parents must be ordinary directories inside the selected root.', REGISTRY, 'Remove the redirection through your normal file-management workflow or use another approved project root. No link is followed for writing.');
    }
  }
  return current;
}

async function evaluator() {
  const manifest = await readJson(pluginRoot, 'plugin.json');
  const files = [];
  for (const file of evaluatorFiles) {
    const { path: name, sha256: hash } = await readProjectFile(pluginRoot, file);
    files.push({ path: name, sha256: hash });
  }
  return { id: manifest.id, version: manifest.version, fingerprint: sha256(JSON.stringify(files)) };
}
async function exists(root, id) {
  if (!await directory(root)) return false;
  try {
    const info = await lstat(path.join(root, recordPath(id)));
    if (info.isSymbolicLink() || !info.isFile()) fail('AUDIT_REGISTRY_PATH_UNSAFE', 'assessment_id', 'Assessment must be a regular, non-link file.', id, 'Inspect the selected entry; never overwrite or follow it.');
    return true;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function readRecord(root, id) {
  if (!await exists(root, id)) fail('AUDIT_REGISTRY_NOT_FOUND', 'assessment_id', 'No assessment exists with this ID in the selected project.', id, 'Call ai_native.history with the target ID, or register an actually evaluated report first.');
  const envelope = await readJson(root, recordPath(id));
  keys(envelope, ['payload', 'sha256'], 'record');
  const p = envelope.payload;
  if (!p || envelope.sha256 !== sha256(JSON.stringify(p)) || p.schema !== RECORD_SCHEMA || p.assessmentId !== id || !Number.isFinite(Date.parse(p.evaluatedAt)) || !p.result || !p.report || !Array.isArray(p.artifacts)) {
    fail('AUDIT_REGISTRY_CORRUPT', 'record', 'Assessment integrity or format is invalid. No historical score is trusted.', id, 'Recover the original record from version control/backup, or run a new assessment under a new ID. Do not edit the checksum to bless changed content.');
  }
  return p;
}
function summary(p) {
  return {
    assessmentId: p.assessmentId, target: p.result.target, evaluatedAt: p.evaluatedAt,
    recordedAt: p.recordedAt, probes: p.probes, evaluator: p.evaluator,
    historicalScore: p.result.index, historicalGate: p.result.gate,
    rubricVersion: p.result.rubricVersion, subjectFingerprint: p.result.subjectFingerprint,
    coveragePercent: p.result.coveragePercent, publicExecutionCoveragePercent: p.result.publicExecutionCoveragePercent,
    trialMode: p.result.trial.mode, recordPath: recordPath(p.assessmentId),
    reportPath: p.reportRef.path, manifest: p.manifest, limitations: p.result.limitations,
    trust: 'Local evidence-backed assessment, not signed third-party, security or commercial certification. Only the declared scope and selected files were assessed.',
  };
}
async function remember(root, refs, relative, expected) {
  const file = await readProjectFile(root, relative);
  if (expected && file.sha256 !== expected) fail('AUDIT_EVIDENCE_STALE', 'path', 'Evidence changed during registration.', relative, 'Keep the old record and recapture/review the changed evidence; do not replace old hashes.');
  refs.set(relative, { path: relative, sha256: file.sha256 });
  return file;
}

export async function register(root, args) {
  keys(args, ['assessment_id', 'report_path', 'manifest_path'], 'arguments');
  const id = assessmentId(args.assessment_id);
  relativePath(args.report_path, 'report_path');
  if (args.manifest_path !== undefined) relativePath(args.manifest_path, 'manifest_path');
  const reportFile = await readProjectFile(root, args.report_path);
  // Retry an uncertain write by ID; do not manufacture a new time or a fresh pass.
  if (await exists(root, id)) {
    const old = await readRecord(root, id);
    if (old.reportRef.path !== args.report_path || old.reportRef.sha256 !== reportFile.sha256 || (old.manifest?.path ?? null) !== (args.manifest_path ?? null)) {
      fail('AUDIT_REGISTRY_ID_CONFLICT', 'assessment_id', 'This assessment ID already belongs to a different registration intent.', id, 'Keep the original record. Use a new ID for a new report/version, or retry the exact original request.');
    }
    return { ...summary(old), created: false, currentChecked: false, nextOperation: 'ai_native.status' };
  }
  let report;
  try { report = JSON.parse(reportFile.content); }
  catch { fail('AUDIT_JSON_INVALID', 'report_path', 'Report is not JSON.', args.report_path, 'Repair the report syntax before registering.'); }
  if (report.target?.surface === 'plugin' && !args.manifest_path) {
    fail('AUDIT_REGISTRY_MANIFEST_REQUIRED', 'manifest_path', 'A plugin assessment must bind its actual manifest.', null, 'Include plugin.json in the recorded subject, recapture if needed, and pass its project-relative path. Historical captures must not be silently amended.');
  }
  let manifest = null;
  if (args.manifest_path) {
    const file = await readProjectFile(root, args.manifest_path);
    const value = await readJson(root, args.manifest_path);
    if (value.id !== report.target?.id || value.version !== report.target?.version || !report.subject?.some(s => s.path === args.manifest_path && s.sha256 === file.sha256)) {
      fail('AUDIT_REGISTRY_MANIFEST_MISMATCH', 'manifest_path', 'Manifest identity/version must match the report and its captured subject.', args.manifest_path, 'Audit the actual plugin ID/version and include the unchanged manifest in the subject before recording probes. Do not attach a new manifest to an old passing capture.');
    }
    manifest = { path: file.path, sha256: file.sha256, id: value.id, version: value.version };
  }
  const tool = await evaluator();
  const result = await evaluate(report, root);
  const evaluatedAt = new Date().toISOString();
  const refs = new Map();
  await remember(root, refs, args.report_path, reportFile.sha256);
  for (const ref of [...report.subject, ...report.evidence]) await remember(root, refs, ref.path, ref.sha256);
  const probes = [];
  const seen = new Set();
  for (const e of report.evidence.filter(e => e.kind === 'execution')) {
    if (seen.has(e.path)) continue;
    seen.add(e.path);
    const capture = JSON.parse((await remember(root, refs, e.path, e.sha256)).content);
    await remember(root, refs, capture.probe.path, capture.probe.sha256);
    probes.push({ path: e.path, startedAt: capture.startedAt, durationMs: capture.durationMs, mode: capture.mode, exitCode: capture.exitCode });
  }
  // Detect drift across evaluation and capture collection. No commands are executed.
  for (const ref of [...refs.values()]) await remember(root, refs, ref.path, ref.sha256);
  if (JSON.stringify(tool) !== JSON.stringify(await evaluator())) fail('AUDIT_EVIDENCE_STALE', 'evaluator', 'Evaluator changed during registration.', tool, 'Finish the tool update and reevaluate under a new assessment ID.');
  const payload = {
    schema: RECORD_SCHEMA, assessmentId: id, evaluatedAt, recordedAt: new Date().toISOString(),
    evaluator: tool, manifest, reportRef: { path: reportFile.path, sha256: reportFile.sha256 },
    report, result, probes, artifacts: [...refs.values()],
  };
  const encoded = JSON.stringify({ payload, sha256: sha256(JSON.stringify(payload)) }, null, 2) + '\n';
  if (Buffer.byteLength(encoded) > 2 * 1024 * 1024) fail('AUDIT_FILE_LIMIT', 'record', 'Combined report/result exceeds the registry record limit.', Buffer.byteLength(encoded), 'Split the audit into smaller declared scopes; no partial record is saved.');
  const dir = await directory(root, true);
  // Write+fsync a unique private temporary file, then publish with an exclusive hard
  // link. Readers never see a partially written .json; competing writers cannot replace it.
  const temporary = path.join(dir, `.${id}-${randomUUID()}.pending`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(encoded); await handle.sync(); await handle.close(); handle = null;
    await directory(root); // Recheck parents before publication.
    try { await link(temporary, path.join(dir, `${id}.json`)); }
    catch (error) {
      if (error.code === 'EEXIST') return await register(root, args);
      fail('AUDIT_REGISTRY_WRITE_FAILED', 'registry', 'Atomic no-overwrite publication failed.', error.code, 'Use a writable filesystem supporting local hard links (e.g. NTFS); inspect history before retrying with the same ID. No existing record was replaced.');
    }
  } finally {
    await handle?.close();
    if (handle !== undefined) await unlink(temporary).catch(() => {});
  }
  return { ...summary(payload), created: true, currentChecked: false, nextOperation: 'ai_native.status' };
}

export async function history(root, args) {
  keys(args, ['target_id'], 'arguments'); text(args.target_id, 'target_id', 4000);
  const dir = await directory(root), records = [];
  if (dir) {
    const entries = await opendir(dir);
    let count = 0, bytes = 0;
    for await (const entry of entries) {
      if (!entry.name.endsWith('.json')) continue;
      if (++count > MAX_RECORDS) fail('AUDIT_REGISTRY_LIMIT', 'registry', 'Registry exceeds the bounded history scan.', MAX_RECORDS, 'Archive an explicitly selected historical registry separately; nothing was silently omitted.');
      const info = await lstat(path.join(dir, entry.name)); bytes += info.size;
      if (bytes > 16 * 1024 * 1024) fail('AUDIT_REGISTRY_LIMIT', 'registry', 'Registry exceeds the total history read budget.', bytes, 'Keep bounded project registries; archive historical records explicitly.');
      const p = await readRecord(root, entry.name.slice(0, -5));
      if (p.result.target.id === args.target_id) records.push({ ...summary(p), currentChecked: false });
    }
  }
  records.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || a.assessmentId.localeCompare(b.assessmentId));
  return { schema: 'unone.ai-native.history.v1', targetId: args.target_id, records, count: records.length, nextOperation: 'ai_native.status', note: 'Historical scores only, not current badges. Different scopes/environments remain separate; no best-score selection.' };
}

export async function status(root, args) {
  keys(args, ['assessment_id', 'current_version'], 'arguments');
  text(args.current_version, 'current_version', 4000);
  const p = await readRecord(root, assessmentId(args.assessment_id));
  const reasons = [];
  if (p.result.target.version !== args.current_version) reasons.push({ code: 'AUDIT_VERSION_CHANGED', field: 'current_version', expected: p.result.target.version, actual: args.current_version, fix: 'Capture and evaluate this version under a new assessment ID. The old score remains historical.' });
  if (JSON.stringify(p.evaluator) !== JSON.stringify(await evaluator())) reasons.push({ code: 'AUDIT_EVALUATOR_CHANGED', field: 'evaluator', fix: 'Reevaluate intact evidence using the current evaluator under a new ID; this is not a new blind trial.' });
  for (const ref of p.artifacts) {
    try {
      const current = await readProjectFile(root, ref.path);
      if (current.sha256 !== ref.sha256) reasons.push({ code: 'AUDIT_EVIDENCE_STALE', field: ref.path, expected: ref.sha256, actual: current.sha256, fix: 'Preserve this historical record; rerun/review the affected scenario and register a new assessment. Do not update old hashes.' });
    } catch (error) {
      if (!(error instanceof AuditError)) throw error;
      reasons.push({ code: error.code, field: ref.path, actual: error.actual, fix: error.fix });
    }
  }
  const state = reasons.length ? 'needs_revalidation' : p.result.gate === 'supported_within_scope' ? 'verified_within_scope' : p.result.gate;
  return {
    schema: 'unone.ai-native.status.v1', ...summary(p), checkedAt: new Date().toISOString(),
    currentVersion: args.current_version, currentChecked: true, state,
    label: { needs_revalidation: '待重驗', verified_within_scope: '已通過（限定範圍）', needs_work: '未達標', insufficient_evidence: '證據不足' }[state],
    score: reasons.length ? null : p.result.index, reasons,
    environment: p.result.target.environment,
    nextOperation: reasons.length ? 'ai_native.init' : 'ai_native.history',
    freshnessScope: 'Checks the supplied version and recorded files now, not all project files, installed packages or another platform. Caller-supplied version is not proof of deployment. Query again after updates; no watcher or release gate runs automatically.',
  };
}
