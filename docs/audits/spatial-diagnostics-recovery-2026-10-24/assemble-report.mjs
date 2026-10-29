import assert from 'node:assert/strict';
import {readFile, writeFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url)), root=resolve(here,'../../..');
const base='docs/audits/spatial-diagnostics-recovery-2026-10-24';
const sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=p=>readFile(resolve(root,p));
const json=async p=>JSON.parse(await bytes(p));
const identity=async path=>{const b=await bytes(path);return {path,bytes:b.length,sha256:sha(b)};};
const save=async(name,value)=>writeFile(resolve(here,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const names=['public','cost','web','fault','native','blind-replay'];
const captures=[];
let subject;
for(const name of names){
 const path=base+'/capture-'+name+'.json', c=await json(path);
 assert.equal(c.schema,'unone.ai-native.probe.v1');
 assert.equal(c.exitCode,0);assert.equal(c.timedOut,false);assert.equal(c.outputTruncated,false);assert.equal(c.sourceChanged,false);
 assert.equal(c.spawnError,null);assert.equal(c.sourceCheckError,null);assert.equal(c.subject.length,62);
 if(subject)assert.deepEqual(c.subject,subject);else subject=c.subject;
 assert.equal(sha(await bytes(c.probe.path)),c.probe.sha256);
 captures.push({...await identity(path),exitCode:c.exitCode,durationMs:c.durationMs,subjectCount:c.subject.length,probe:c.probe});
}
for(const f of subject)assert.equal(sha(await bytes(f.path)),f.sha256,'current selected subject '+f.path);
const archive=await json(base+'/source-snapshot.json');assert.equal(archive.files.length,46);
for(const f of archive.files){assert.equal(Buffer.byteLength(f.text),f.bytes);assert.equal(sha(Buffer.from(f.text)),f.sha256);assert.equal(sha(await bytes(f.path)),f.sha256);}
const seal=await json(base+'/blind-verification.json');assert.equal(seal.ok,true);assert.equal(seal.files,87);
const blind=base+'/blind/scout-diagnostics-sdk';
const manifestBytes=await bytes(blind+'/SHA256SUMS.json');assert.equal(sha(manifestBytes),seal.manifestSha256);
assert.ok((await bytes(blind+'/SEAL.txt')).toString().includes(seal.manifestSha256));
const manifest=JSON.parse(manifestBytes);assert.equal(manifest.files.length,87);
for(const f of manifest.files){const b=await bytes(blind+'/'+f.path);assert.equal(b.length,f.bytes);assert.equal(sha(b),f.sha256);}
async function walk(dir,prefix=''){let a=[];for(const d of await readdir(dir,{withFileTypes:true})){const p=prefix+d.name;if(d.isDirectory())a.push(...await walk(resolve(dir,d.name),p+'/'));else a.push(p);}return a;}
assert.deepEqual((await walk(resolve(root,blind))).filter(p=>!['SHA256SUMS.json','SEAL.txt'].includes(p)).sort(),manifest.files.map(f=>f.path).sort());
const env=await json(base+'/environment.json');
for(const f of [env.binary,env.analyzer]){const b=await readFile(f.path);assert.equal(b.length,f.bytes);assert.equal(sha(b),f.sha256);}
const passedLogs=[
 ['.cache/spatial-hardening-engine-first.log','369 passed across library/array/core/runtime/diagnostic/fault/metrics suites; 4 existing ignored'],
 ['.cache/spatial-hardening-types.log','Explicit official Luau 0.734 strict positive/negative regression passed'],
 ['.cache/spatial-hardening-bridge-v2.log','11 Web ABI tests passed'],
 ['.cache/spatial-hardening-sdk-tests-v2.log','Final release SDK packaging regression passed'],
 ['.cache/spatial-hardening-js-final.log','29 host/executor/core JavaScript tests passed'],
 ['.cache/spatial-hardening-release-v2.log','Final release CLI build passed'],
 ['.cache/spatial-hardening-debug.log','Debug CLI build passed for export parity'],
 ['.cache/spatial-hardening-web-build-v3.log','Fresh release WASM and official computation parity checks passed'],
 ['.cache/spatial-hardening-example-types.json','Packaged example strict analysis passed'],
 ['.cache/spatial-hardening-example-run.json','Packaged example completed 3 frames'],
];
const successfulDevelopment=[];for(const[path,result]of passedLogs)successfulDevelopment.push({...await identity(path),result});
const preservedNames=['.cache/spatial-hardening-bridge.log','.cache/spatial-hardening-cpu-first.stderr','.cache/spatial-hardening-public-first.stderr','.cache/spatial-hardening-public-v2.stdout','.cache/spatial-hardening-web-build.log','.cache/spatial-hardening-web-build-v2.log','.cache/spatial-faults-rust-first.log','.cache/spatial-faults-rust-final.log'];
const preserved=[];for(const p of preservedNames)preserved.push(await identity(p));
const validation={passed:true,completedDate:'2026-10-24 Asia/Taipei',scope:'Generic engine only; no game content, install, commit or push. Actual execution evidence is the six recorder JSON files, not this validation summary.',captures,selectedSubjects:{count:62,allCurrent:true},selectedSourceArchive:{...await identity(base+'/source-snapshot.json'),files:46,allArchivedBytesAndCurrentHashesMatch:true,limitation:'Selected exact text copies only; not a full dependency graph, source-to-binary attestation or external signature.'},blindSeal:{...seal,exactFileSetVerified:true},binaryIdentities:[await identity('artifacts/spatial-hardening-sdk-v2/bin/game.exe'),await identity('artifacts/spatial-hardening-sdk-v2/tools/benchmark-spatial.mjs'),await identity('artifacts/spatial-hardening-runtime/unone_player.wasm')],successfulDevelopment,preservedDevelopmentAttempts:preserved,developmentFailures:[
 'Transient compile failure from accidentally removed four pre-existing geometry helpers was repaired with exact earlier bytes; final geometry suite passed. No changed geometry behavior is retained.',
 'Initial fixtures expected one-based runtime frame and omitted Game.start; fixed test fixtures, not runtime contract. A 2 versus 2.0 JSON assertion was replaced by canonical typed result comparison.',
 'Draft PowerShell wrapper was execution-policy blocked; no policy change. Final commands were explicit installed PowerShell 7 commands. First bridge command used unsupported --lib for a binary target; corrected command passed.',
 'First Web build lacked Cargo PATH; next build had stale debug CLI parity. Debug CLI rebuild followed by actual v3 export/parity passed.',
 'Initial embedded benchmark used an unannotated inserted record and failed official strict analysis. Final Sample annotation, new SDK-v2, actual strict/benchmark and release packaging regression passed. Provisional artifacts/spatial-hardening-sdk is retained but is not the handoff SDK.',
 'Owner public probe v1 assumed every natural-language search matched. Combined Chinese search returned no matches; v2 followed full-index fallback but wrapper output was 282438 bytes, above recorder cap. v3 inspects the full index and logs bounded selected evidence; actual formal capture is complete, not truncated. No failed recorder capture was replaced.',
 'Fresh author first strict pass succeeded; first runtime completed but external checker passed 12/13 because stale-index probe was masked by per-tick quota. Author independently moved it to update2 and reached 13/13. Separate Node --import Windows path error was repaired to a file URL. All sealed attempts remain.',
 ],sourceReviewCutoffResolution:'source-review.md correctly states its native metadata-bearing rerun was pending at cutoff; final capture-native.json subsequently executes and validates debug/windows/x86_64 metadata, real NVIDIA GPU and 3+9 CPU/GPU samples.'};
await save('validation.json',validation);

const report=(await json(base+'/tooling/template.json')).result.value;
report.target={...report.target,scope:'Public SDK generic structured spatial diagnostics, canonical typed records/example, independent geometry authoring/repair and repeated CPU cost measurement. Supplementary informed synthetic fault matrix, actual native GPU and fresh WASM CPU/WebGPU main/Worker regressions. Excludes gameplay, rendered appearance, real driver/device-loss, universal speedup and cross-device certification.',version:'game0.1.0; spatial/diagnostic/profile api_version1; USB1; official Luau0.734',revision:'checkout7b9424cf42d0409633c9ce782503075bd09018f9 with preserved concurrent dirty changes; SDK CLI SHA256d59c051d00ad47616978b6c4352a67092555baecfb090fb6b3442ca929c3e028; selected source archive and 62 hashes bound this task.',environment:'Windows x64; preinstalled toolchains; NVIDIA GeForce RTX5080 native Vulkan and Edge155.0.4283.62 WebGPU; final release SDK-v2 and fresh hash-verified WASM. Completed2026-10-24 Asia/Taipei. No game edit/install/commit/push.'};
report.trial={mode:'retest',entryPoints:['artifacts/spatial-hardening-sdk-v2/README.md','artifacts/spatial-hardening-sdk-v2/sdk.json','artifacts/spatial-hardening-sdk-v2/bin/game.exe --help'],steps:53,firstSuccessStep:28,sourceFallbackStep:null,wrongGuesses:0,limitations:[
 'Aggregate is informed/retest. Only the separately sealed fresh SDK-only author is blind; source review, owner probes, replay and semantic review are informed. Author did not read example main.luau, repo implementation/tests, rubric or prior audits.',
 '53 ordered author ledger events plus initial bootstrap; events include reads/writes/copies/identity/seal, not 53 CLI calls. There are27 top-level runner child processes; nested benchmark calls are separately counted, not double-counted. Engine-internal analyzer launches are opaque. No token/time-to-user estimate is inferred.',
 'First strict check passed at event27. First runtime delivery28 completed but external verifier30 passed12/13: stale-index probe hit per-tick quota first. Author independently moved the probe; strict34, runtime35 and external36 passed13/13. A Windows Node --import invocation error and search miss are retained. No undocumented API/signature guesses.',
 'Counter gameplay_source_repairs:1 refers only to the synthetic trial Luau probe-placement correction. No actual game content was used or modified.',
 'Author executed CPU geometry and small16x4/large4096x128 benchmarks with3 warmups+9 retained samples. GPU, Web/Worker and host bridge/setup were not blind-authored; their actual runs here are supplementary informed regressions.',
 'Fault matrix uses supplied fake executors/hosts/devices and malformed envelopes. Actual GPU normal execution is separately verified. No actual hardware/driver device-loss event was exercised. Reload retains the executor and cannot repair a broken device; terminal recovery may require a new runtime and working executor.',
 'Native direct executor benchmark is debug; SDK CPU is release. Their timings are not a matched end-to-end speed comparison. Kernel timestamps remain unavailable with explicit reason. Host/setup/bridge/manager/binding phases overlap; no additive kernel, crossover, frame-rate or universal speedup claim.',
 'Returned records are detached snapshots. Official Luau0.734 still accepts some dynamic string-index/typeof-table alias mutations despite named fields remaining typed. Treat records as read-only; this task does not claim universal alias/type soundness. Empty arrays/plain objects and typed numeric/record arrays are actually checked.',
 'Structured diagnostics cover input/manager/executor/host failures; VM OOM, buffer allocation and output encoding failures are excluded. Structured paths are one-based, runtime frame is zero-based and legacy error strings retain old wording/indexing. recovery.action is human guidance; branch on code/retry/flags.',
 'Combined Chinese search 空間查詢 錯誤診斷 returns no matches in the owner public probe; structured full-index fallback recovers. Fresh author also recovered scene entity via entity. Search combinations are not universally recognized.',
 'All six actual captures share62 selected subjects, including the sealed final project and inspected independent oracle. Selected46 exact source copies are retained, but neither this archive nor pinned local binaries attest a full dependency graph, clean build or authorship. The87-file local blind seal is integrity evidence, not an external signature.',
 'Previous audits remain unchanged. Different SDK and expanded task scope mean this score is not a formal numeric before/after comparison. The ten questions assess this scope, not the entire engine or any game.'
 ]};
report.subject=subject;
async function evidence(id,kind,path,quote){const b=await bytes(path);assert.ok(b.toString().includes(quote),'missing quote '+id);report.evidence.push({id,kind,path,sha256:sha(b),quote});}
await evidence('entry','document','artifacts/spatial-hardening-sdk-v2/README.md','For generic batched geometry');
await evidence('guide','document','artifacts/spatial-hardening-sdk-v2/docs/spatial-batches.md','lastDiagnostic()');
await evidence('types','document','artifacts/spatial-hardening-sdk-v2/docs/engine.d.luau','export type EngineDiagnostic');
await evidence('example','document','artifacts/spatial-hardening-sdk-v2/examples/spatial-diagnostics/README.md','spatial');
await evidence('blind','observation',blind+'/REPORT.txt','First authored strict check passed');
await evidence('counters','observation',blind+'/operation-counters.json','intended_stale_probe_masked_by_quota');
await evidence('seal','observation',base+'/blind-verification.json','"ok": true');
await evidence('source-review','observation',base+'/source-review.md','Preserve detailed terminal diagnostics');
await evidence('source-archive','source',base+'/source-snapshot.json','"files"');
await evidence('validation','observation',base+'/validation.json','"passed": true');
for(const name of names)await evidence(name,'execution',base+'/capture-'+name+'.json','task_result');
const check=(id,rating,answer,reason,nextAction,evidence)=>({id,status:'verified',rating,access:'public',answer,reason,nextAction,evidence});
report.checks=[
 check('purpose',3,'Fresh SDK-only author found the generic sphere-batch API, canonical types, CPU default, fixed-tick delivery and engine/caller ownership boundary.','The sealed explanation and independent geometry execution use only public SDK entry points. Movement, targeting policy and hit responses stay outside the engine primitives; one trial is not universal usability.','Keep SDK entry links and generic ownership explicit.',['entry','guide','blind','blind-replay']),
 check('capabilities',3,'Public search, descriptors and complete packaged docs expose diagnostic fields, limits, query forms, typed observations and CPU/GPU availability.','Independent author needed no implementation source or invented API. Combined Chinese search returns no matches; full-index fallback succeeds. Fresh author also used a narrower entity search after a miss. These observed discovery frictions preclude a4.','Improve generic multi-term/synonym discovery in a separate bounded change; keep complete-index fallback.',['entry','guide','types','blind','public']),
 check('operation',4,'Fresh author independently implemented nearest/overlap/sweep, no-hit and empty batches, typed publication, invalid replacement/repair and resource delivery through public contracts.','First official strict check passed. First external checker exposed quota masking the stale-index probe; author corrected only its timing and reached13/13. Inspected independent oracle and recorded fresh-temp strict/runtime replay pass. No casts, any, handwritten stubs, publication adapters or source fallback.','Retain first failure and final replay; obtain a fresh author again after future contract changes.',['blind','counters','public','blind-replay']),
 check('context',3,'Frozen batch results retain source version1 after atomic rejection; repaired index is version2, and already submitted work survives index destruction until next-tick take.','Independent full-geometry checks distinguish original/rejected/repaired data. Complete initial/submitted/final info records and unrelated entity comparison preserve identities and state. Persistent handles and cross-device restore were not tested.','Keep version/lifetime/snapshot semantics explicit without implying save persistence.',['guide','blind','blind-replay']),
 check('observation',4,'Complete canonical info/result/profile/diagnostic records publish directly; no-hit/empty/typed empty arrays remain[], typed numbers/records work and plain{} remains an object.','Fresh external checker validates complete nested geometric records, all diagnostics, counters and unrelated entity. Actual fresh WASM repeats CPU/WebGPU main/Worker shapes and scoped binding/host observations. Observer purity and detached reads are independently checked; wall-clock publication is intentionally nondeterministic.','Preserve array/object, detached-copy and read-only observer regressions.',['types','blind','blind-replay','public','web','fault']),
 check('diagnostics',4,'Invalid second body radius=-2 returns SPATIAL_INPUT_INVALID, spatial.update, bodies[2].radius, actual=-2, expected finite0..1000000 and machine retry/terminal flags; correcting radius succeeds.','Fresh author branches on structured fields without parsing human errors, and external oracle proves original full geometry/version survived rejection. Same-tick, stale and consumed resources have distinct codes. Supplementary host tests preserve specific terminal result/profile diagnostics after tick failure and distinguish next_tick from after_release. Excluded VM/allocation failures remain documented.','Retain stable facts/retry policy and host-accessible terminal causes; keep human messages compatible.',['guide','types','blind','blind-replay','fault','web','source-review']),
 check('recovery',3,'Early take retries next tick, invalid update corrects without partial mutation, destroyed indices and consumed tickets reject reuse safely.','Fresh public author/replay exercise bounded recoverable paths. Supplementary fault injection covers atomic multi-batch failure, late replies, epochs, cancellation/reload and no fallback after execution fault. Actual broken-device recovery is untested and reload cannot promise to repair it.','Preserve recoverable versus terminal distinction; validate real interruption separately when required.',['guide','blind','blind-replay','fault']),
 check('boundaries',3,'Generic geometry calls affect only their bounded data/resources; same-tick access, destroyed-index submit and consumed-ticket reuse reject, while unrelated synthetic entity remains exactly unchanged.','Fresh author uses isolated synthetic data and public lifecycle boundaries. Synthetic host tests supplement invalid/duplicate/stale completions. This is not operating-system isolation or account/security authorization certification. No actual game is modified.','Keep geometry independent of gameplay movement, targeting and collision responses.',['guide','blind','blind-replay','fault']),
 check('performance',3,'Public SDK tool performs warmups and repeated samples with p50/p95, separate manager/executor/Lua input/output scopes; official host adds setup and UTF-8 bridge phase/byte counters.','Fresh author completed16x4 and4096x128 CPU runs, independently recomputed quantiles and distinguished process_total. Actual recorded native debug and fresh WASM WebGPU normal runs validate their own scopes. GPU kernel timestamps are absent with reason; overlaps and build modes prevent speedup/crossover conclusions.','Measure representative caller workloads before thresholds; retain warmup/distribution/build/scope metadata and unavailable reasons.',['guide','blind','counters','cost','native','web']),
 check('reproducibility',3,'Six actual recorder captures share62 selected hashes and complete without timeout/truncation/source change;46 exact selected text sources,87 sealed author files and pinned binary/analyzer/runtime identities are retained.','Blind authorship, later informed replay and source review stay distinct. All original author and development failures remain visible; semantic review is independent. Selected copies and local seals do not certify full compiler provenance or cross-device determinism.','Keep this audit immutable; use a new directory and fresh author for future first-use claims.',['seal','source-archive','validation','blind','public','cost','fault','native','web','blind-replay'])
];
report.issues=[{id:'combined-search-discovery',checkId:'capabilities',severity:'P2',summary:'Some natural-language multi-term search queries return no matches despite a discoverable public API.',cause:'Observed owner query 空間查詢 錯誤診斷 has matches=[]; actual complete-index fallback finds spatial descriptors. Fresh author scene entity also misses while entity succeeds. These observations bound the search-matching gap; its algorithmic root cause was not established in this task.',fix:'Follow-up generic API search matching/synonym improvement with these preserved cases, maintaining truthful no-match output and complete-index fallback. No game vocabulary or gameplay behavior is required.',verification:'Preserve current raw query outputs; after any matching change rerun these exact misses, narrower successful queries and unrelated negative queries, then a fresh discovery trial.',evidence:['public','blind']}];
await save('audit.proposed.json',report);
console.log(JSON.stringify({passed:true,captures:captures.length,subjects:subject.length,archivedSources:archive.files.length,sealedFiles:manifest.files.length,report:base+'/audit.proposed.json'}));
