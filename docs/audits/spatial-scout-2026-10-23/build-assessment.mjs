// Assemble an evidence-backed proposed Scout report; never changes the product.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
const rel=path=>relative(root,path).replaceAll('\\','/');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const load=async path=>JSON.parse(await readFile(resolve(root,path),'utf8'));
const base=rel(here);
const initial=await load(base+'/informed/capture-initial-current.json');
const corrected=await load(base+'/informed/capture-workaround-current.json');
const design=await load(base+'/design/capture-current.json');
assert.equal(initial.exitCode,1);assert.equal(corrected.exitCode,0);assert.equal(design.exitCode,0);
for(const capture of [initial,corrected,design]){
 assert.equal(capture.sourceChanged,false);assert.equal(capture.timedOut,false);assert.equal(capture.outputTruncated,false);
 assert.deepEqual(capture.subject,initial.subject);
 for(const entry of capture.subject)assert.equal(digest(await readFile(resolve(root,entry.path))),entry.sha256,'subject changed: '+entry.path);
}
const blindRoot=resolve(here,'blind');
const manifestBytes=await readFile(resolve(blindRoot,'SHA256SUMS.json'));
assert.equal(digest(manifestBytes),'17f65c726903c1c4011b69c7f261c18675806463c186022083d6d9103f9ede73');
const manifest=JSON.parse(manifestBytes);
for(const file of manifest.files){
 const path=resolve(blindRoot,file.path);
 assert.ok(!relative(blindRoot,path).startsWith('..'),'blind seal path escape');
 assert.equal(digest(await readFile(path)),file.sha256,'blind artifact changed: '+file.path);
}
await writeFile(resolve(here,'blind-verification.json'),JSON.stringify({ok:true,files:manifest.files.length,manifestSha256:digest(manifestBytes),scope:'Hash consistency, not independent execution or semantic certification'},null,2)+'\n',{flag:'wx'});

const evidence=[];
async function ref(id,kind,path,quote){
 const bytes=await readFile(resolve(root,path)),content=bytes.toString('utf8');
 assert.ok(content.includes(quote),'missing excerpt '+id);
 evidence.push({id,kind,path,sha256:digest(bytes),quote});return id;
}
await ref('guide','document','docs/spatial-batches.md','The API neither reads nor changes scene entities or rigid bodies.');
await ref('types','document','docs/engine.d.luau','info: () -> {[string]: ObservationValue},');
await ref('blind','observation',base+'/blind/report.json','"sourceFallbackStep": null');
await ref('blind-types','observation',base+'/blind/report.json','SpatialBatchResult is not assignable to ObservationValue; direct result publication fails official typecheck.');
await ref('blind-detail','observation',base+'/blind/report.md','The final example passes the official strict Luau typecheck (operation 23)');
await ref('seal','observation',base+'/blind-verification.json','"ok": true');
await ref('initial','execution',base+'/informed/capture-initial-current.json','observation integer is outside the portable Luau integer range');
await ref('public','execution',base+'/informed/capture-workaround-current.json','representative completed');
await ref('public-workaround','execution',base+'/informed/capture-workaround-current.json','Only info.limits.safe_integer is converted with tostring before observation publication.');
await ref('edge','execution',base+'/design/capture-current.json','spatial result[0] contains invalid contact geometry');
await ref('design','observation',base+'/design/source-review.md','Static source tracing confirms SDK packing takes compiled');
await ref('sdk-source','source','crates/unone-cli/src/sdk.rs',"fn authoring_files() -> [(&'static str, &'static str); 4]");
await ref('normal-source','source','crates/unone-engine/src/spatial.rs','fn normal_or_z');

const checks=[
 {id:'purpose',rating:3,answer:'A fresh AI followed README to the spatial guide and correctly explained generic geometry, CPU default, fixed delivery, and the absence of movement policy or speedup claims.',reason:'The first-use report used public docs without a method-name or geometry-field guess. Cross-API publication friction prevents calling the whole onboarding path effortless.',nextAction:'Retain the explicit ownership and v1 limits; add a minimal typed observation example that works without adapters.',evidence:['guide','blind','public']},
 {id:'capabilities',rating:3,answer:'The spatial namespace, eight operations, canonical types, backend names and limits are publicly discoverable from repository entrypoints. Ordinary collision and Chinese query phrases return no matches.',reason:'Repository discovery succeeds; the informed probe preserves exact query text/UTF-8 and returned candidates. This does not demonstrate SDK-only discovery; the static SDK omission is a separate finding.',nextAction:'Add scoped collision/CCD and bilingual discovery terms, link the complete guide from descriptors, and include the guide in SDK inventory.',evidence:['guide','blind-detail','public','design']},
 {id:'operation',rating:3,answer:'The independent AI completed masked nearest, ordered overlap and moving-target sweep at operation 17, and a strictly typed final example at operations 23–24. The informed packed/table scenario also completes.',reason:'Geometry, next-tick delivery and frozen versions work through public APIs, but direct typed result publication required a manual serialization adapter. Successful scoped cases do not validate every accepted numeric input.',nextAction:'Make result publication compose with the official ObservationValue contract, then rerun a new independent first-use trial.',evidence:['blind','blind-types','blind-detail','public']},
 {id:'context',rating:3,answer:'Versioned query results retain their submitted geometry after replacement and index destruction. The corrected public probe verifies version 2 results after a version 3 replacement and checks stable same-seed digests.',reason:'IDs, query order, immutable snapshots and versions are observable. Handles are explicitly ephemeral; persistent saves, checkpoints and GPU state restoration were not tested.',nextAction:'Keep snapshot/version contracts explicit and add public context for faulted tickets without implying durable handle restoration.',evidence:['guide','public','blind']},
 {id:'observation',rating:2,answer:'Selected results and portable scalar info fields publish correctly, but two natural observation paths fail: SpatialBatchResult fails official typecheck, and info() is typed as publishable but its safe_integer field fails native observation serialization.',reason:'The initial recorder probe failed before intended geometry/overflow verification. A separate successful probe changes only info.safe_integer publication to a string. That is a fixture workaround, not a product fix.',nextAction:'Align spatial return types and numeric domains with the observation boundary; require unadapted info/result publication to pass both check --types and native/Web runtime tests.',evidence:['types','blind-types','blind','initial','public-workaround']},
 {id:'diagnostics',rating:3,answer:'Duplicate IDs, negative radius, same-tick take, consumed/cancelled tickets and stale destruction produce usable failures; valid repairs succeed. Direct info publication gives a generic portable-integer error requiring field isolation.',reason:'Public-only repairs were possible and preserved state. Error strings do not consistently expose structured field/actual/expected/recovery information; array locations also use zero-based body indexes.',nextAction:'Add field-level diagnostics for publication failures and consistent documented array indexing; preserve stable existing error codes.',evidence:['blind','blind-detail','initial','public']},
 {id:'recovery',rating:3,answer:'Caught early-take errors do not consume tickets; later take succeeds, consumed tickets reject retries, and cancelled work is absent. After the declared terminal 65-contact overflow, a fresh corrected 64-contact run succeeds.',reason:'The successful probe asserts the overflow-specific cause, unlike the initial failed probe whose generic false result was caused by observation serialization. Device loss, stalled GPU jobs and dropped host replies are outside this trial.',nextAction:'Keep per-call validation versus terminal executor faults distinct in discovery; add a small public recovery example and separately test GPU interruption.',evidence:['guide','public','blind','initial']},
 {id:'boundaries',rating:3,answer:'The isolated probe uses only new synthetic projects, rejects invalid/stale operations and verifies an unrelated scene entity remains unchanged after batch queries.',reason:'This supports the geometry-versus-gameplay boundary and runtime handle lifecycle, not OS sandboxing, external account permissions or cross-project security.',nextAction:'Retain synthetic boundary tests and opaque handles; do not add domain-specific selection or response rules to these primitives.',evidence:['guide','public','blind']},
 {id:'performance',rating:2,answer:'Capacity and actual selected CPU backend are observable; both docs and probes keep full-scan/readback limits explicit. The recorded command wall times cannot isolate upload, dispatch, readback or VM apply cost.',reason:'This audit performed no GPU timing or acceleration benchmark. Current spatial info provides usage rather than work-phase cost, so it cannot support a conclusion about when GPU execution is beneficial.',nextAction:'Expose measured backend work/transfer costs or explicit unavailability, and benchmark end-to-end batches before choosing automatic execution thresholds.',evidence:['guide','public']},
 {id:'reproducibility',rating:3,answer:'The audit pins the existing executable by SHA-256, freezes 33 selected subject files, retains failed and workaround captures, verifies the blind evidence seal, and repeats the same-seed scenario with equal digests.',reason:'These are local CPU/public-interface and bounded source-review results. Source HEAD is not substituted for executable identity; no clean SDK build or cross-device reproduction is claimed.',nextAction:'After fixes, preserve these failed cases and run a new captured retest plus a new SDK-only blind author; do not relabel an informed retest as blind.',evidence:['seal','blind','public','edge']},
].map(check=>({...check,status:check.rating>=3?'verified':'partial',access:'public'}));
const binary=await load(base+'/informed/binary.json');
const ledger=(await readFile(resolve(blindRoot,'operations.ndjson'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
const report={
 schema:'unone.ai-native.audit.v1',rubricVersion:'1.0.0',
 target:{id:'unone-spatial-v1',name:'Unone spatial batch API',surface:'mixed',scope:'Repository public CLI/docs/canonical types and headless CPU spatial authoring, supplemented by independent bounded source/design review. Excludes fresh SDK-only authoring, GPU runtime execution, rendering, performance speedup, device-loss and cross-platform certification.',version:'spatial api_version 1 / USB1; '+binary.version,revision:'Existing debug executable SHA256 '+binary.sha256+'; checkout '+spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).stdout.trim()+' with preserved uncommitted changes; selected hashes identify the reviewed source.',environment:'Windows x64, existing game.exe and Node '+process.version+'; synthetic local CPU projects only; no build/install/network/accounts or product/game changes.'},
 trial:{mode:'informed',entryPoints:['README.md','target/debug/game.exe --help','README link -> docs/spatial-batches.md','game api search / describe / typings and public check --types / run'],steps:Math.max(...ledger.map(entry=>entry.operation)),firstSuccessStep:17,sourceFallbackStep:null,wrongGuesses:2,limitations:[
  'Aggregate assessment is informed: the root implemented the feature and read source. Only blind/ is a fresh-context public-interface subtrial; independent source findings are separately labelled.',
  'Trial counters refer only to the preserved blind lane; parallel informed recorder commands are not added to that exploration sequence. The two wrong guesses are natural cross-API assumptions, not deliberate negatives or the later shell-quoting failure.',
  'Blind first geometry succeeded at operation 17; final strictly typed example at 23–24. Initial bootstrap stdout was durably recaptured later and is not mislabelled original recorder output.',
  'The initial informed capture genuinely failed. Its generic 65-case failure is not overflow evidence because observation serialization failed first. The corrected capture explicitly projects one info field and verifies overflow-specific diagnostics.',
  'No engine/source fixes were applied. Workaround success is not a repaired product or a fresh blind retest.',
  'No actual GPU execution or new SDK pack in this audit. Previous implementation validation is not substituted for this public-interface trial. SDK guide omission is based on complete source inventory tracing.',
  'One fresh AI author is a single trial, not a statistical usability result. Evidence coverage refers to the ten scoped rubric questions, not all engine features.',
 ]},subject:initial.subject,evidence,checks,
 issues:[
  {id:'SPATIAL-SCOUT-001',checkId:'observation',severity:'P2',summary:'Officially typed spatial.info() cannot be directly published through observation.set on the native CLI.',cause:'limits.safe_integer is 2^53-1; the observation integer branch permits only signed 32-bit values. The declared ObservationValue dictionary and runtime numeric behavior disagree.',fix:'Align the diagnostic value representation or shared serialization contract; retain numeric bounds explicitly without a caller-only undocumented workaround.',verification:'The unadapted info() value must pass official typecheck and direct observation publication on native and Web hosts; retain the failing blind/info-probe.',evidence:['types','blind','initial','public-workaround']},
  {id:'SPATIAL-SCOUT-002',checkId:'operation',severity:'P2',summary:'A SpatialBatchResult cannot be passed directly to typed observation.set.',cause:'Canonical result records do not compose with the recursive ObservationValue type accepted by the observation API; the fresh author had to write an explicit typed adapter.',fix:'Provide compatible canonical types or a generic supported serialization path and a working typed result-observation example.',verification:'The preserved first example should pass check --types and publish without local casts, any stubs or a bespoke spatial adapter.',evidence:['blind-types','blind-detail','types']},
  {id:'SPATIAL-SCOUT-003',checkId:'operation',severity:'P2',summary:'A valid tiny coordinate faults the CPU manager with an invalid result produced by its own executor.',cause:'normal_or_z squares a 3e-23 displacement; f32 subnormal rounding produces a normal with length squared about 0.642, which validate_result rejects.',fix:'Use scale-safe normalization across CPU/WGSL or reject a clearly documented unsupported minimum scale before accepting the batch.',verification:'A body at {3e-23,0,0}, radius0, queried from origin must complete with finite validated contact geometry; add nearby tiny/zero/scaled cases.',evidence:['edge','normal-source','design']},
  {id:'SPATIAL-SCOUT-004',checkId:'capabilities',severity:'P2',summary:'The complete spatial guide is omitted by portable SDK packing.',cause:'The SDK authoring/runtime-package inventory has no spatial-batches.md entry, and spatial descriptors do not link to the full guide. Repository README discovery is not SDK-only validation.',fix:'Bundle the canonical guide, link selected contracts to it, and add an inventory test before fresh SDK authoring.',verification:'Inspect a newly packed SDK, then let a fresh agent discover host policy and moving-sphere semantics without repository source.',evidence:['sdk-source','design']},
 ],
};
await writeFile(resolve(here,'audit.proposed.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({proposed:base+'/audit.proposed.json',checks:checks.length,subject:report.subject.length,blindOperations:report.trial.steps,blindSealedFiles:manifest.files.length}));
