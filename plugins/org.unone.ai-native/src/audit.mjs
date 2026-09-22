import { CHECKS, SCHEMA, RUBRIC_VERSION, RUN_SCHEMA } from './rubric.mjs';
import { AuditError, fingerprint, invalid, keys, list, object, readProjectFile, relativePath, text } from './files.mjs';

const STATUSES = ['verified', 'partial', 'failed', 'unverified'];
const ACCESSES = ['public', 'source-assisted', 'internal', 'none'];
const SHA = /^[0-9a-f]{64}$/;
const evidenceKinds = ['document', 'source', 'execution', 'observation'];
function oneOf(value, choices, field) {
  if (!choices.includes(value)) invalid(field, 'Unsupported value.', choices, value, 'Use an explicitly supported value from ai_native.catalog.');
}
function integer(value, field, min = 0, max = 100000) {
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid(field, 'Expected a bounded integer.', `${min}–${max}`, value, 'Record the actual count, not an estimate disguised as a measurement.');
}
function stringList(values, field, max = 40, min = 0) {
  list(values, field, max, min); values.forEach((v,i) => text(v, `${field}[${i}]`));
}
function digest(value, field) { if (!SHA.test(value ?? '')) invalid(field, 'Missing or invalid SHA-256.', '64 lowercase hexadecimal characters', value, 'Use ai_native.snapshot to record the actual file digest.'); }
function fileRef(value, field) {
  keys(value, ['path','sha256'], field); relativePath(value.path, `${field}.path`); digest(value.sha256, `${field}.sha256`);
}
function references(ids, known, field, min = 0) {
  stringList(ids, field, 24, min);
  if (new Set(ids).size !== ids.length) invalid(field, 'Duplicate evidence reference.', 'unique evidence IDs', ids, 'Keep each supporting evidence ID once.');
  for (const id of ids) if (!known.has(id)) invalid(field, 'Evidence reference does not exist.', [...known], id, 'Add a real artifact or use an existing evidence ID.');
}

export function validateShape(report) {
  keys(report, ['schema','rubricVersion','target','trial','subject','evidence','checks','issues'], '$');
  oneOf(report.schema, [SCHEMA], '$.schema'); oneOf(report.rubricVersion, [RUBRIC_VERSION], '$.rubricVersion');
  keys(report.target, ['id','name','surface','scope','version','revision','environment'], '$.target');
  for (const field of ['id','name','scope','version','revision','environment']) text(report.target[field], `$.target.${field}`);
  oneOf(report.target.surface, ['plugin','http','cli','mcp','ui','library','mixed'], '$.target.surface');
  keys(report.trial, ['mode','entryPoints','steps','firstSuccessStep','sourceFallbackStep','wrongGuesses','limitations'], '$.trial');
  oneOf(report.trial.mode, ['blind','informed','retest'], '$.trial.mode');
  stringList(report.trial.entryPoints, '$.trial.entryPoints', 20, 1);
  stringList(report.trial.limitations, '$.trial.limitations');
  integer(report.trial.steps, '$.trial.steps', 1);
  integer(report.trial.wrongGuesses, '$.trial.wrongGuesses', 0, report.trial.steps);
  for (const field of ['firstSuccessStep','sourceFallbackStep']) if (report.trial[field] !== null) integer(report.trial[field], `$.trial.${field}`, 1, report.trial.steps);
  list(report.subject, '$.subject', 64, 1);
  report.subject.forEach((s,i) => fileRef(s, `$.subject[${i}]`));
  if (new Set(report.subject.map(s => s.path)).size !== report.subject.length) invalid('$.subject', 'Duplicate source path.', 'unique paths', 'duplicate', 'List each selected source file once.');
  list(report.evidence, '$.evidence', 128, 1);
  const known = new Set();
  for (const [i,e] of report.evidence.entries()) {
    const f = `$.evidence[${i}]`;
    keys(e, ['id','kind','path','sha256','quote'], f);
    text(e.id, `${f}.id`, 100); oneOf(e.kind, evidenceKinds, `${f}.kind`);
    relativePath(e.path, `${f}.path`); digest(e.sha256, `${f}.sha256`); text(e.quote, `${f}.quote`, 1200);
    if (known.has(e.id)) invalid(`${f}.id`, 'Duplicate evidence ID.', 'unique ID', e.id, 'Assign stable, unique evidence IDs.');
    known.add(e.id);
  }
  list(report.checks, '$.checks', CHECKS.length, CHECKS.length);
  const checked = new Set();
  for (const [i,c] of report.checks.entries()) {
    const f = `$.checks[${i}]`;
    keys(c, ['id','status','rating','access','answer','reason','nextAction','evidence'], f);
    oneOf(c.id, CHECKS.map(x=>x.id), `${f}.id`);
    if (checked.has(c.id)) invalid(`${f}.id`, 'Duplicate criterion would hide an unanswered question.', 'each criterion exactly once', c.id, 'Answer every criterion from ai_native.init once.');
    checked.add(c.id);
    oneOf(c.status, STATUSES, `${f}.status`); oneOf(c.access, ACCESSES, `${f}.access`);
    for (const field of ['answer','reason','nextAction']) text(c[field], `${f}.${field}`);
    references(c.evidence, known, `${f}.evidence`, c.status === 'unverified' ? 0 : 1);
    const allowed = { verified: [3,4], partial: [1,2], failed: [0], unverified: [null] }[c.status];
    oneOf(c.rating, allowed, `${f}.rating`);
    if (c.status !== 'unverified' && c.access === 'none') invalid(`${f}.access`, 'An assessed item needs an actual access route.', ACCESSES.slice(0,3), c.access, 'Record whether you used public documentation, source assistance, or an internal API.');
    if (c.access === 'source-assisted' && report.trial.sourceFallbackStep === null) invalid('$.trial.sourceFallbackStep', 'Source-assisted evidence must disclose when source inspection began.', 'recorded step number', null, 'Record the fallback step; do not describe a source-guided trial as purely public use.');
  }
  list(report.issues, '$.issues', 40);
  const issueIds = new Set();
  for (const [i,issue] of report.issues.entries()) {
    const f = `$.issues[${i}]`;
    keys(issue, ['id','checkId','severity','summary','cause','fix','verification','evidence'], f);
    for (const field of ['id','summary','cause','fix','verification']) text(issue[field], `${f}.${field}`);
    oneOf(issue.checkId, CHECKS.map(x=>x.id), `${f}.checkId`); oneOf(issue.severity, ['P0','P1','P2'], `${f}.severity`);
    if (issueIds.has(issue.id)) invalid(`${f}.id`, 'Duplicate issue ID.', 'unique issue ID', issue.id, 'Assign one stable ID per finding.');
    issueIds.add(issue.id); references(issue.evidence, known, `${f}.evidence`, 1);
  }
  return report;
}

export async function evaluate(report, root) {
  validateShape(report);
  const cache = new Map(); let totalBytes = 0;
  async function verify(ref, field) {
    if (!cache.has(ref.path)) {
      const file = await readProjectFile(root, ref.path);
      totalBytes += file.bytes;
      if (totalBytes > 16 * 1024 * 1024) throw new AuditError('AUDIT_TOTAL_LIMIT', field, 'Selected evidence exceeds the total read budget.', '16 MiB', totalBytes, 'Split the audit into smaller scenarios.');
      cache.set(ref.path, file);
    }
    const file = cache.get(ref.path);
    if (file.sha256 !== ref.sha256) throw new AuditError('AUDIT_EVIDENCE_STALE', field, 'The file differs from the version this audit measured.', ref.sha256, { path: ref.path, sha256: file.sha256 }, 'Rerun the original probe and review affected answers. Do not merely replace the hash to make old evidence appear current.');
    return file;
  }
  for (const [i,s] of report.subject.entries()) await verify(s, `$.subject[${i}]`);
  const runs = new Map();
  for (const [i,e] of report.evidence.entries()) {
    const f = `$.evidence[${i}]`, file = await verify(e, f);
    if (!file.content.includes(e.quote)) throw new AuditError('AUDIT_QUOTE_NOT_FOUND', `${f}.quote`, 'The claimed excerpt is absent from the referenced artifact.', 'exact excerpt in artifact', { path: e.path, evidenceId: e.id }, 'Use a short verbatim excerpt from the actual output; put interpretation in the answer, not in the quote.');
    if (e.kind !== 'execution') continue;
    let run;
    try { run = JSON.parse(file.content); } catch { invalid(f, 'Execution evidence must be a recorded probe, not source code or prose.', RUN_SCHEMA, e.path, 'Run scripts/record-probe.mjs on a reviewed, isolated probe and reference its JSON capture.'); }
    if (!object(run) || run.schema !== RUN_SCHEMA) invalid(f, 'Invalid execution capture schema.', RUN_SCHEMA, run?.schema, 'Capture the probe with the provided recorder.');
    oneOf(run.mode, ['fixture','local','live'], `${f}.mode`); stringList(run.limitations, `${f}.limitations`);
    if (!Number.isFinite(run.durationMs) || run.durationMs < 0 || typeof run.stdout !== 'string' || typeof run.stderr !== 'string' || !Number.isFinite(Date.parse(run.startedAt))) invalid(f, 'Execution capture lacks measured output, time or environment.', 'recorder output', e.path, 'Recapture the probe; do not hand-author successful execution evidence.');
    if (!Array.isArray(run.command) || !run.command.length || typeof run.node !== 'string' || typeof run.platform !== 'string' || typeof run.timedOut !== 'boolean' || !(run.exitCode === null || Number.isInteger(run.exitCode))) invalid(f, 'Execution capture metadata is incomplete.', 'command, environment, exit code and timeout state', e.path, 'Use the unchanged recorder output.');
    if (typeof run.outputTruncated !== 'boolean' || typeof run.sourceChanged !== 'boolean' || run.sourceChanged) invalid(f, 'Source changed during capture or capture integrity state is missing.', 'stable source and explicit truncation state', e.path, 'Rerun the reviewed probe against an unchanged source snapshot.');
    list(run.subject, `${f}.subject`, 64, 1);
    run.subject.forEach((s,j) => fileRef(s, `${f}.subject[${j}]`));
    if (new Set(run.subject.map(s=>s.path)).size !== run.subject.length) invalid(f, 'Duplicate capture source paths.', 'unique paths', e.path, 'Recapture with each --subject once.');
    if (fingerprint(run.subject) !== fingerprint(report.subject)) throw new AuditError('AUDIT_RUN_TARGET_MISMATCH', f, 'The execution capture measured a different source selection/version.', fingerprint(report.subject), fingerprint(run.subject), 'Use a capture for exactly this target snapshot, or create a separate explicitly scoped audit.');
    fileRef(run.probe, `${f}.probe`); await verify(run.probe, `${f}.probe`);
    runs.set(e.id, run);
  }
  const evidence = new Map(report.evidence.map(e => [e.id,e]));
  let earned = 0, assessed = 0, unknown = 0, runtimeWeight = 0, publicRuntimeWeight = 0;
  const dimensions = CHECKS.map(criterion => {
    const check = report.checks.find(c=>c.id === criterion.id);
    if (check.status === 'unverified') { unknown += criterion.weight; return { ...criterion, status: check.status, claimed: null, accepted: null, points: null, caps: [], answer: check.answer, nextAction: check.nextAction }; }
    assessed += criterion.weight;
    const refs = check.evidence.map(id=>evidence.get(id));
    const executed = check.evidence.some(id=>runs.has(id));
    const successful = check.evidence.some(id=>runs.has(id) && runs.get(id).exitCode === 0 && !runs.get(id).timedOut && !runs.get(id).outputTruncated);
    if (executed) runtimeWeight += criterion.weight;
    if (executed && check.access === 'public') publicRuntimeWeight += criterion.weight;
    let accepted = check.rating; const caps = [];
    function cap(max, reason) { if (accepted > max) { accepted = max; caps.push(reason); } }
    if (check.access !== 'public') cap(2, '需要源碼或內部入口協助，不能算獨立公開契約使用。');
    if (refs.every(e => e.kind === 'source' || e.kind === 'observation')) cap(2, '只有源碼／審查者觀察，缺少可發現的契約或執行證據。');
    if (criterion.runtime && !executed) cap(1, '此題要求實際操作；文件與源碼不是執行證據。');
    if (!executed) cap(3, '最高分需要完成任務的執行證據，不只文件描述。');
    if (executed && !successful && check.rating > 0) cap(1, '引用的探針沒有完整成功的執行；仍可作為失敗證據。');
    const points = criterion.weight * accepted / 4; earned += points;
    return { ...criterion, status: accepted >= 3 ? 'verified' : accepted > 0 ? 'partial' : 'failed', claimedStatus: check.status, claimed: check.rating, accepted, points, caps, answer: check.answer, nextAction: check.nextAction };
  });
  const round = n=>Math.round(n*100)/100;
  const critical = dimensions.filter(d=>d.critical);
  const blockers = critical.filter(d=>d.accepted !== null && d.accepted < 3).map(d=>d.id);
  const missing = critical.filter(d=>d.accepted === null).map(d=>d.id);
  const gate = blockers.length ? 'needs_work' : missing.length || !assessed ? 'insufficient_evidence' : earned >= 80 ? 'supported_within_scope' : 'needs_work';
  return {
    schema: 'unone.ai-native.result.v1', rubricVersion: RUBRIC_VERSION, target: report.target, trial: report.trial,
    subjectFingerprint: fingerprint(report.subject),
    index: assessed ? round(earned) : null,
    meaning: '固定 rubric 的證據支持分數（0–100 下限），不是普遍有效的 AI-native 認證。未驗證項未從分母移除。',
    possibleRange: [round(earned), round(earned + unknown)],
    coveragePercent: assessed, executionCoveragePercent: runtimeWeight, publicExecutionCoveragePercent: publicRuntimeWeight,
    gate, blockers, unverifiedCritical: missing, dimensions,
    evidenceIntegrity: { checkedFiles: cache.size, bytesRead: totalBytes, hashAndExcerptVerified: true, semanticClaimsIndependentlyProven: false },
    executionScopes: [...new Set([...runs.values()].map(r=>r.mode))],
    limitations: [...new Set([...report.trial.limitations, ...[...runs.values()].flatMap(r=>r.limitations), '相同 rubric 可比較，但評測者判斷、任務與環境會影響分數；一次 subagent 盲測不是統計結果。'])],
    issues: report.issues,
  };
}

export function compare(before, after) {
  if (before.rubricVersion !== after.rubricVersion || before.target.id !== after.target.id || before.target.scope !== after.target.scope || before.target.surface !== after.target.surface) throw new AuditError('AUDIT_COMPARISON_MISMATCH', 'comparison', 'These audits do not measure the same target, scope and rubric.', 'matching target ID, scope, surface and rubric', { before: before.target.id, after: after.target.id }, 'Keep changed scope as a separate audit; do not advertise its score difference as an improvement.');
  return { schema: 'unone.ai-native.comparison.v1', before: before.index, after: after.index, delta: before.index === null || after.index === null ? null : Math.round((after.index-before.index)*100)/100,
    sameSubject: before.subjectFingerprint === after.subjectFingerprint,
    sameEnvironment: before.target.environment === after.target.environment,
    note: 'Descriptive difference, not causal proof. Retests know the tool; retain the original blind trial.',
    dimensions: before.dimensions.map(a => { const b = after.dimensions.find(x=>x.id===a.id); return { id:a.id, before:a.accepted, after:b.accepted, delta:a.accepted === null || b.accepted === null ? null : b.accepted-a.accepted }; }) };
}
