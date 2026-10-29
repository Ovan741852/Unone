// Assemble a scoped informed retest; the separately sealed author is blind.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
const base='docs/audits/spatial-observation-profile-2026-10-23';
const blind=base+'/blind/scout-arrays-profile';
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=async p=>JSON.parse(await readFile(resolve(here,p),'utf8'));
const names=['public','web','native','kernel','blind-replay'];
const capturePath=n=>'capture-'+n+(n==='blind-replay'?'-v2':'')+'.json';
const captures=await Promise.all(names.map(n=>read(capturePath(n))));
for(const c of captures){
 assert.equal(c.exitCode,0);assert.equal(c.timedOut,false);assert.equal(c.outputTruncated,false);assert.equal(c.sourceChanged,false);
 assert.deepEqual(c.subject,captures[0].subject);
 for(const f of c.subject)assert.equal(hash(await readFile(resolve(root,f.path))),f.sha256,f.path);
 assert.equal(hash(await readFile(resolve(root,c.probe.path))),c.probe.sha256,c.probe.path);
}
const seal=await read('blind-verification.json');assert.equal(seal.ok,true);
const manifest=await readFile(resolve(root,blind,'SHA256SUMS.json'));assert.equal(hash(manifest),seal.manifestSha256);
for(const f of JSON.parse(manifest)){const b=await readFile(resolve(root,blind,f.path));assert.equal(b.length,f.bytes);assert.equal(hash(b),f.sha256);}
const operations=await read('blind/scout-arrays-profile/operations.json');assert.equal(operations.length,39);
const milestones=await read('blind/scout-arrays-profile/milestones.json');
assert.equal(milestones.firstStrictSuccess.id,'032');assert.equal(milestones.firstDeliveredResult.operation,'030');
const logs=[
 ['.cache/spatial-observation-profile-tests-final.log','325 library +2 array +15 geometry +10 runtime passed; 3 library and1 external-analyzer tests ignored in default run'],
 ['.cache/spatial-observation-profile-types-final.log','Ignored official strict positive/negative regression explicitly run:1 passed'],
 ['.cache/spatial-observation-profile-bridge-tests.log','Native Web bridge regression:11 passed'],
 ['.cache/spatial-observation-profile-sdk-tests.log','SDK packing regression:1 passed'],
 ['.cache/spatial-observation-profile-cli-release.log','Release CLI build succeeded'],
 ['.cache/spatial-observation-profile-cli-debug.log','Debug CLI build succeeded'],
 ['.cache/spatial-observation-profile-web-build.log','Fresh release player WASM build and both five-frame parity fixtures passed'],
 ['.cache/spatial-observation-profile-sdk-pack.json','Fresh SDK pack succeeded; canonical embedded guide/types checked against sources'],
];
const logEvidence=[];for(const [path,result]of logs){const b=await readFile(resolve(root,path));logEvidence.push({path,sha256:hash(b),bytes:b.length,result});}
const validation={completedLocalDate:'2026-10-24 Asia/Taipei',startedLocalDate:'2026-10-23',passed:true,
 productScope:'Generic engine observation serialization and spatial execution diagnostics only; no YesSir/game content, install, commit or push.',
 regressionLogs:logEvidence,
 actualRecorderRuns:captures.map((c,i)=>({name:names[i],path:base+'/'+capturePath(names[i]),exitCode:c.exitCode,timedOut:c.timedOut,outputTruncated:c.outputTruncated,sourceChanged:c.sourceChanged,subjectFiles:c.subject.length})),
 preservedDevelopmentAttempts:[
  {path:'.cache/spatial-observation-profile-tests.log',result:'Initial Rust format-string brace compile failure, corrected.'},
  {path:'.cache/spatial-observation-profile-tests-v2.log',result:'Accidentally embedded Rust test inside raw Lua string; moved outside and actually registered in final test run.'},
  {path:'.cache/spatial-observation-profile-types.log',result:'Rejected unsafe table-intersection type design; final plain {T} preserves indexed writes and setArray publishes typed arrays.'},
  {path:'.cache/spatial-observation-profile-types-v2.log',result:'Redundant zero-arg/nil overload ambiguity; final nil overload already permits omitted argument.'},
  {path:base+'/capture-blind-replay.json',result:'Owner wrapper compared the LF starter block with CRLF api typings bytes. Verified newline-normalized content equality; new wrapper and actual capture-blind-replay-v2.json pass. Sealed author and product unchanged.'},
 ],
 independentReview:'source-review.md records corrected weak typing, misplaced test and Web getter/snapshot intake findings; no unresolved source defect reported. Fresh blind author and semantic review are separate.',
 limitations:['Selected source fingerprints are not immutable copies or a full compiler dependency graph. Executable/analyzer hashes and runtime manifest pin tested binaries.','Native GPU integration is a cold2body4query correctness/profile case; fresh WASM uses4096x128 on CPU/GPU main/Worker. Fresh blind author uses CPU3x4 and4096x256.','Host phases exclude Luau/bridge/caller application and setup; no kernel timestamps, speedup/threshold benchmark, rendered player or other-device claim.']};
await writeFile(resolve(here,'validation.json'),JSON.stringify(validation,null,2)+'\n',{flag:'wx'});
const evidence=[];
async function ref(id,kind,path,quote){const b=await readFile(resolve(root,path));assert.ok(b.toString('utf8').includes(quote),id+' quote');evidence.push({id,kind,path,sha256:hash(b),quote});}
await ref('entry','document','artifacts/spatial-observation-profile-sdk/README.md','For generic batched geometry');
await ref('guide','document','artifacts/spatial-observation-profile-sdk/docs/spatial-batches.md','gpu_kernel_unavailable_reason');
await ref('types','document','artifacts/spatial-observation-profile-sdk/docs/engine.d.luau','export type SpatialProfile');
await ref('blind','observation',blind+'/REPORT.txt','sourceFallbackStep is null');
await ref('milestones','observation',blind+'/milestones.json','firstStrictSuccess');
await ref('author-failure','observation',blind+'/029-first-strict-check.stdout','LUAU_TYPECHECK_FAILED');
await ref('author-summary','observation',blind+'/measured-summary.json','pair_tests_upper_bound');
await ref('seal','observation',base+'/blind-verification.json','"ok": true');
await ref('validation','observation',base+'/validation.json','"passed": true');
await ref('source-review','observation',base+'/source-review.md','No remaining blocking runtime/serialization');
for(const n of names)await ref(n,'execution',base+'/'+capturePath(n),'task_result');
const checks=[];
function check(id,rating,answer,reason,nextAction,refs){checks.push({id,status:rating>=3?'verified':'partial',rating,access:'public',answer,reason,nextAction,evidence:refs});}
check('purpose',3,
 'A fresh SDK-only author found the linked generic geometry guide, used canonical types and preserved caller-owned movement/application policy.',
 'The sealed explanation distinguishes CPU default, fixed-tick delivery, host selection and unavailable GPU measurements without source fallback. One representative author does not establish universal first-use behavior.',
 'Retain the SDK guide links and engine/caller ownership boundary.', ['entry','guide','blind','blind-replay']);
check('capabilities',3,
 'Public search/descriptors expose array/setArray, spatial query limits and profile semantics, with the complete guide/types inside the actual new SDK.',
 'The fresh author discovered these surfaces and actual CPU execution. One broad entity search returned no matches and a narrower public search recovered; native/browser GPU use is supplementary informed regression.',
 'Keep public descriptors, complete packaged docs and canonical types synchronized.', ['entry','guide','types','blind','public']);
check('operation',4,
 'The fresh author independently implemented typed numeric/record publication, nearest/overlap/sweep, invalid replacement and repair, next-tick delivery and ticket/index boundaries through public APIs.',
 'First runtime delivery occurred at030 before strict repair; canonical SpatialNearestQuery annotation repaired literal widening, strict check passed032 and final native run033. Reviewed independent geometric/JSON oracle and recorded fresh-temp replay pass, with no casts, publication adapters or source fallback. This rating allows ordinary public-contract authoring repair; it does not claim first-attempt strict success.',
 'Retain failed029, original/final scripts and replay; use another fresh author after future contract changes.', ['blind','milestones','author-failure','blind-replay','public']);
check('context',3,
 'Ticket/version records distinguish frozen version1 work from repaired version2 work; rejected replacement preserves the original body geometry and unrelated entity.',
 'The sealed author and actual replay verify ordered tick1/tick2 delivery, unchanged version after invalid update, version increment after repair and zero remaining tickets. Persistent handles and cross-device restore are outside this case.',
 'Keep snapshot/version/lifetime contracts explicit without implying save persistence.', ['guide','blind','blind-replay','public']);
check('observation',4,
 'Canonical complete results/info/profile publish directly. Empty query results and no-contact hits remain JSON[], authored typed numeric/record/empty/nested arrays work, and plain{} stays an object.',
 'Fresh author JSON assertions check every nested hit vector; owner recorder also verifies clearing a marked typed array and failed publication preserving state. Fresh hash-verified WASM repeats empty/nonempty shapes on CPU/WebGPU main and Worker. Read-only profile does not consume work or change canonical replay digest.',
 'Preserve generic marker validation, array/object distinction and read-only digest regressions.', ['types','blind','blind-replay','public','web','native']);
check('diagnostics',3,
 'Duplicate bodyID11 identifies the invalid replacement; same-tick, consumed-ticket and destroyed-index calls expose stable spatial error codes. The corrected replacement and later delivery succeed.',
 'The blind run retains actual errors and confirms geometry/version survived rejection. Official type diagnostics identify widened kind:string and the canonical typed local repairs it. Some spatial errors remain strings rather than uniform field/actual/expected records.',
 'Retain actionable codes and repair examples; consider structured field diagnostics only as a separate generic extension.', ['blind','author-failure','blind-replay','public']);
check('recovery',3,
 'Caught early take leaves the ticket usable next tick; rejected replacement preserves version1, repair produces version2, and consumed or destroyed resources reject reuse safely.',
 'Public author and replay establish these bounded per-call/lifecycle recovery paths. Fresh author did not exercise device loss, terminal executor recovery or interrupted host completion.',
 'Keep validation rejection distinct from terminal execution faults; add device interruption tests when that scope is requested.', ['guide','blind','blind-replay','public']);
check('boundaries',3,
 'Only local synthetic fixtures and reusable engine APIs are used. Same-tick access, consumed-ticket reuse and destroyed-index submission are rejected; the unrelated scene entity remains unchanged.',
 'This demonstrates the geometry/scene and resource lifetime boundaries. It is not an operating-system sandbox or account/security isolation audit; gameplay policy stays in caller Luau.',
 'Keep geometry queries independent of game movement, targeting policy and hit responses.', ['guide','blind','blind-replay','public']);
check('performance',3,
 'Public spatial.profile exposes bounded work counts, equivalent input bytes, transfer bytes, manager timings and executor host phases. Missing GPU kernel time has an explicit reason, not a fabricated zero.',
 'Fresh CPU author compares3x4 and4096x256 using per-batch and cumulative deltas; formal WASM runs4096x128 on CPU/WebGPU main/Worker with preparation/queue/packing/upload/encode/readback/decode. Native GPU cold2x4 separately confirms actual adapter, bytes and absent kernel timing. These locate measured costs but omit Luau/bridge/application/setup and do not establish speedup or a crossover point.',
 'Use representative application measurements before selecting thresholds; retain exclusions, overlap semantics and unavailability reasons.', ['guide','author-summary','blind','blind-replay','public','web','native','kernel']);
check('reproducibility',3,
 'All five actual recorder executions share44 selected input hashes, verify current probe hashes and complete without source changes/truncation/timeouts. The126-file blind seal and pinned SDK/analyzer/runtime identities are retained.',
 'A fresh author and later informed replay remain distinct, failures are preserved, and read-only profile/control runs have equal nonempty digests. Selected hashes are not immutable snapshots, full source-to-binary attestation, proof of authorship or cross-device determinism.',
 'Retain this evidence unchanged; create a new audit directory and fresh author for future first-use claims.', ['seal','validation','milestones','blind-replay','public','web','native','kernel']);
const report={schema:'unone.ai-native.audit.v1',rubricVersion:'1.0.0',target:{
 id:'unone-spatial-observation-profile-v1',name:'Unone spatial arrays and cost diagnostics',surface:'mixed',
 scope:'Public SDK generic typed JSON-array publication and spatial CPU authoring/cost diagnostics; supplementary informed actual native GPU and fresh WASM CPU/WebGPU main/Worker regression. Excludes gameplay, renderer appearance, speedup/threshold benchmark, device-loss and cross-device certification.',
 version:'spatial/profile api_version1 / USB1; game0.1.0; Luau0.734',
 revision:'checkout7b9424cf42d0409633c9ce782503075bd09018f9 with preserved concurrent dirty changes; SDK CLI SHA2564fedf99a941c82009272f2ef4315fe809648e4a216d0043408f4331c7a55f180; selected hashes identify bounded inputs.',
 environment:'Windows x64; preinstalled toolchains; NVIDIA GeForce RTX5080 native Vulkan, Edge155.0.4283.62 WebGPU; new release SDK and hash-verified WASM. Audit started2026-10-23 and completed2026-10-24 Asia/Taipei; no game edits/install/commit/push.'},
 trial:{mode:'retest',entryPoints:['artifacts/spatial-observation-profile-sdk/README.md','artifacts/spatial-observation-profile-sdk/sdk.json','artifacts/spatial-observation-profile-sdk/bin/game.exe --help'],steps:operations.length,firstSuccessStep:30,sourceFallbackStep:null,wrongGuesses:0,limitations:[
  'Aggregate is informed/retest; only the separately sealed SDK author is fresh-context/blind. Owner source review, regression tests and replay are not blind authorship.',
  'Trial steps are39 recorded author subprocess operations,24 public CLI plus2 nested replay CLI. Zero unsupported API/flag guesses; one natural-language search miss, one Node inspection helper syntax failure and one Luau query-literal widening error are retained. Four deliberate API negatives are separate.',
  'First strict attempt029 failed. Native delivery030 occurred before repair and is not represented as strict-checked. Typed local repair031, strict success032, final run033, independent JSON verification035/036 and fresh-temp replay038 are retained in order.',
  'Owner capture-blind-replay.json failed a CRLF-versus-LF canonical-block assertion. The byte-normalized content was independently verified equal; only the wrapper was repaired and actually rerun as capture-blind-replay-v2.json with the same subject set. Failed capture and original probe remain unchanged.',
  'The author used only public SDK/docs/CLI, actual CPU and the external official analyzer. GPU is explicitly untested by that author; actual native/WebGPU checks here are separate informed regressions.',
  'Native GPU integration is a cold2body4query case;4096x128 is the informed SDK/WASM case;4096x256 is the blind CPU case. They are not a backend speed comparison.',
  'Unmeasured GPU kernel time is nil in Luau/null in host JSON with an explicit reason. Host phases may overlap/nest; do not sum them or relabel readback wait as kernel duration. Timings exclude Luau/bridge/caller application/setup.',
  'Publishing wall-clock profile values intentionally makes those observations nondeterministic. Digest equality is asserted only for control versus profile-read-only runs with no diagnostic publication.',
  'All files read by each small probe wrapper are selected in the same44-subject set, including sealed final fixture inputs and oracle. Executable/analyzer/WASM files are pinned by explicit binary/manifest hashes rather than exceeding the recorder2MiB subject limit.',
  'Selected source fingerprints are not immutable source copies or a full compiler dependency graph; only blind evidence has a detached manifest seal. Local hashes do not certify authorship or a clean source-to-binary build.',
  'The10 questions cover this declared scope, not the whole engine. The changed SDK/task scope is not a formal numeric before/after comparison with previous audits, and no renderer, universal speedup or cross-device safety certification is claimed.',
 ]},subject:captures[0].subject,evidence,checks,issues:[]};
await writeFile(resolve(here,'audit.proposed.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({subjects:report.subject.length,captures:names.length,blindFiles:seal.files,steps:operations.length,firstSuccess:30,strictSuccess:32}));
