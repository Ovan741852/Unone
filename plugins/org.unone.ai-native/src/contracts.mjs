import { reportSchema } from './report-schema.mjs';
const objectSchema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const string = { type:'string', minLength:1 };
const path = { type:'string', description:'Forward-slash project-relative UTF-8 file path. Absolute paths and escaping symlinks are rejected.' };
const reportArgumentSchema = structuredClone(reportSchema);
delete reportArgumentSchema.$schema;
reportArgumentSchema.description = 'Complete report JSON from ai_native.init. Pass this in memory to evaluate without writing an audit file.';
function contract(id, summary, keywords, input_schema, example, output, errors) {
  return { id, version:'0.1.0', versionScope:'Per-operation input/output contract version; independent of the installed plugin/package release version.', summary, keywords, available: { status:'available', requirements:['Node.js >=20'], scope:'Local read-only audit; no actual AI or target execution.' }, readOnly:true, permissions:['project.read'], input_schema, output, examples:[example], errors };
}
const evidenceErrors = [
  { code:'AUDIT_EVIDENCE_STALE', cause:'The subject or artifact changed since capture.', fix:'Rerun the original probe and review affected answers; do not just replace hashes.' },
  { code:'AUDIT_PATH_OUTSIDE_ROOT', cause:'Absolute, traversal or escaping symlink path.', fix:'Select the correct project root and use approved relative evidence files.' },
  { code:'AUDIT_INVALID', cause:'A required answer, field or evidence reference is missing/invalid.', fix:'Read diagnostics.facts.field/expected/actual and supply a concrete answer.' },
];
const registryContracts = [
  contract('ai_native.register', '重新核對評測並追加版本化紀錄，保存分數與時間；不執行探針、不覆蓋歷史。', ['register','save assessment','登錄','登記','保存評測','紀錄分數'], objectSchema({assessment_id:{type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,79}$'},report_path:path,manifest_path:path},['assessment_id','report_path']), {assessment_id:'equipment-20260915-01',report_path:'audits/equipment/audit.json',manifest_path:'plugins/org.example.equipment/plugin.json'}, 'Immutable local assessment receipt: historicalScore/gate, target version/scope/environment, evaluatedAt/recordedAt, actual probe startedAt/durationMs, subject fingerprint, evidence references. created=false on an exact ID retry; currentChecked=false, call status for a current badge. This is not a fresh probe run or signed certification.', [
    {code:'AUDIT_REGISTRY_WRITE_DENIED',cause:'Host has not opted into registry writes.',fix:'Explicit local CLI register, or trusted host UNONE_AI_NATIVE_REGISTRY_WRITE=1. Payload flags cannot grant access.'},
    {code:'AUDIT_REGISTRY_ID_CONFLICT',cause:'Assessment ID already belongs to another report.',fix:'Keep old record; new report uses a new ID. Retry uncertain writes with the original ID and request.'},
    {code:'AUDIT_REGISTRY_MANIFEST_MISMATCH',cause:'Manifest ID/version or captured hash does not match.',fix:'Include the actual plugin manifest in the subject before running probes. Do not retrofit hashes into historical evidence.'},
    {code:'AUDIT_REGISTRY_MANIFEST_REQUIRED',cause:'Plugin surface lacks a manifest binding.',fix:'Capture plugin.json as a subject and provide manifest_path.'},
    {code:'AUDIT_REGISTRY_WRITE_FAILED',cause:'Atomic publication unavailable.',fix:'Use a writable local hard-link-capable filesystem; inspect history before retry.'},
  ]),
  contract('ai_native.history', '查詢目標的歷次評測分數、時間、版本與範圍；歷史成績不代表新版通過。', ['history','assessment records','認證紀錄','評測紀錄','歷史','分數時間'], objectSchema({target_id:string},['target_id']), {target_id:'org.example.equipment'}, 'Bounded unranked history records with historicalScore, evaluatedAt, recordedAt, probes, scope, version, evaluator and currentChecked=false. Empty records means not registered. Call status per assessment; never pick the highest score as current.', [{code:'AUDIT_REGISTRY_LIMIT',cause:'More than 256 records or 16 MiB total.',fix:'Explicitly archive bounded historical registries; no entries were silently omitted.'},{code:'AUDIT_REGISTRY_CORRUPT',cause:'Record integrity is invalid.',fix:'Restore original backup or register new evidence; no score is trusted.'}]),
  contract('ai_native.status', '核對紀錄與目前版本／檔案，顯示限定範圍通過、未達標、證據不足或待重驗。', ['certification','certified','current score','freshness','status','認證','目前分數','待重驗','是否通過','有效期'], objectSchema({assessment_id:string,current_version:string},['assessment_id','current_version']), {assessment_id:'equipment-20260915-01',current_version:'1.0.0'}, 'state/label, checkedAt, score (null when stale), historicalScore, scope/environment, exact reasons with code/field/expected/actual/fix. Compares selected files, evidence, evaluator and caller-supplied version. Not a live deployment/platform check, not an automatic watcher. No global plugin badge or commercial/security certification.', [{code:'AUDIT_REGISTRY_NOT_FOUND',cause:'No registered assessment ID in this project.',fix:'Call history or register a valid evaluated report first.'},{code:'AUDIT_REGISTRY_CORRUPT',cause:'Stored record checksum/format invalid.',fix:'Restore original record; never edit checksum to bless content.'}]),
];

export const contracts = [
  contract('ai_native.catalog', '取得 AI-native 評測問題、權重、證據與評分規則。', ['rubric','checklist','criteria','catalog','清單','標準','用途','能力','規則','評估'], objectSchema({}), {}, 'Ten weighted questions, rating anchors, evidence caps and explicit limits.', []),
  contract('ai_native.init', '回傳未填的逐題評測 JSON 範本；唯讀，不寫檔、不評分。新評測可從這裡開始。', ['start','init','template','begin audit','new assessment','self assess','score myself','score','audit','ai native','評分','評測','評估','開始','建立','盲測','體驗','新評測','新評估','自評','自我評分','我要評估','評估自己'], objectSchema({id:string,name:string,surface:{type:'string',enum:['plugin','http','cli','mcp','ui','library','mixed']}},['id','name']), {id:'equipment-planner',name:'Equipment planning',surface:'http'}, 'Returns an unverified JSON skeleton on stdout only. No file is created and no score is assigned. Fill every answer; incomplete skeletons fail evaluation.', [{code:'AUDIT_INVALID',cause:'Missing target ID/name or unknown field.',fix:'Supply id/name and optional surface from the schema.'}]),
  contract('ai_native.snapshot', '計算明確選定檔案的 SHA-256 與版本指紋，不掃描整個專案。', ['hash','snapshot','fingerprint','source version','preserve','reproduce','checksum','證據','指紋','版本','檔案'], objectSchema({paths:{type:'array',minItems:1,maxItems:64,items:path}},['paths']), {paths:['README.md']}, 'File path, SHA-256, bytes, line count and selected-file fingerprint; never file content.', evidenceErrors),
  contract('ai_native.evaluate', '核對逐題答案及本機證據，產生分數下限、覆蓋率、缺口與修復項目。可直接傳 report JSON，不必先寫評測檔。', ['score','evaluate','validate','audit','ai native','ai-native','評分','評測','檢查','除錯','錯誤','驗證','評估自己','自評'], {
    type:'object', properties:{report_path:path,report:reportArgumentSchema},
    oneOf:[{required:['report_path'],not:{required:['report']}},{required:['report'],not:{required:['report_path']}}],
    additionalProperties:false,
  }, {report_path:'audits/planner/audit.json'}, 'Supply exactly one of report_path (an existing project-relative JSON file) or report (the complete JSON value returned/filled from ai_native.init). The plugin remains read-only; evaluation reads referenced evidence from the host-selected project root.', evidenceErrors.concat([{code:'AUDIT_RUN_TARGET_MISMATCH',cause:'Probe captured a different source/version.',fix:'Capture the same subject selection and create a matching report.'},{code:'AUDIT_QUOTE_NOT_FOUND',cause:'Claimed excerpt is not in the evidence.',fix:'Reference actual output verbatim; keep interpretation in the answer.'}])),
  contract('ai_native.compare', '比較相同目標與範圍的兩份有效評測，保留未知值與環境差異。', ['compare','regression','改善','比較','回歸','前後'], objectSchema({before_path:path,after_path:path},['before_path','after_path']), {before_path:'audits/before/audit.json',after_path:'audits/after/audit.json'}, 'Per-dimension deltas, source/environment differences. Historical sources need their original snapshot; a stale report is not silently accepted.', evidenceErrors.concat([{code:'AUDIT_COMPARISON_MISMATCH',cause:'Target, rubric or scope differs.',fix:'Compare the same declared scenario; otherwise report separately.'}])),
  ...registryContracts,
];

Object.assign(contracts.find(c=>c.id==='ai_native.register'), {
  version:'0.2.0', readOnly:false, permissions:['project.read','project.write_staging'],
  available:{status:'available',requirements:['Node.js >=20','Explicit CLI register or trusted-host registryWrite opt-in'],scope:'Only create new .unone/ai-native/assessments/<id>.json inside the host-selected project. Local records, not marketplace publication.'},
  sideEffects:['Creates registry directories and one new assessment file; exact retries do not append or reevaluate. No target source edits, command execution, downloads or uploads.'],
  preparation:'Read ai_native.evaluate reportSchema/preparation first. For plugin targets the actual manifest must be in the captured subject. register reevaluates existing evidence; probe times remain unchanged. History is never automatically imported from old score files.',
});
for (const c of registryContracts) { c.version='0.2.0'; c.errors.push(...evidenceErrors); }

// The selected API must reveal its artifact contract too, not merely "a JSON file".
contracts.find(c=>c.id==='ai_native.init').version='0.3.0';
Object.assign(contracts.find(c=>c.id==='ai_native.evaluate'), {
  version:'0.3.0',
  reportSchema,
  runtimeInvariants:['checks must contain every catalog criterion ID exactly once (the JSON Schema alone does not enforce ID uniqueness).','Evidence references must resolve, hashes/quotes must match and execution captures must have the same subject; schema validity is not evidence validity.'],
  preparation: [
    {operation:'ai_native.init',purpose:'Get a JSON report skeleton on stdout. This operation does not write a file; the caller may pass the completed report directly to ai_native.evaluate.'},
    {operation:'ai_native.catalog',purpose:'Read the ten questions, weights and evidence caps.'},
    {operation:'ai_native.snapshot',purpose:'Record real selected source and evidence hashes.'},
    {entry:'scripts/record-probe.mjs',purpose:'Explicit, reviewed isolated probe recording; not callable as a plugin operation and not a sandbox.'},
  ],
});
Object.assign(contracts.find(c=>c.id==='ai_native.compare'), {
  preparation:'Both reports are evaluated against ONE selected root. Preserve each historical source and capture in immutable snapshot subdirectories under that root, with the original report paths pointing into its own snapshot. Do not rewrite hashes to match changed source. The tool does not checkout, download or migrate snapshots; see docs/report.md#前後比較.',
});
for(const c of contracts) {
  const commands={catalog:'catalog',init:'init --id <id> --name <name> [--surface http]',snapshot:'snapshot --path <relative> [--path <relative> ...]',evaluate:'evaluate --report <relative-report>',compare:'compare --before <relative-report> --after <relative-report>',register:'register --assessment <new-id> --report <relative-report> [--manifest <relative-plugin.json>]',history:'history --target <target-id>',status:'status --assessment <id> --version <current-version>'};
  c.standaloneCli=`node cli.mjs ${commands[c.id.slice('ai_native.'.length)]} --root <selected-project>`;
}
Object.assign(contracts.find(c=>c.id==='ai_native.evaluate'), {
  standaloneCliAlternatives:[
    'ai_native.call with arguments.report for a read-only in-memory evaluation.',
    'node cli.mjs evaluate --report - --root <selected-project>, with the completed report JSON on stdin.',
  ],
});
