import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const root=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const ops=fs.readFileSync(path.join(root,'operations.ndjson'),'utf8').trim().split('\n').map(JSON.parse);
const raw=n=>ops.find(o=>o.operation===n);
const value=n=>JSON.parse(raw(n).stdout);
const one=value(16),two=value(17),three=value(24),info=value(21);
const a=one.value.world.observations,b=two.value.world.observations,c=three.value.world.observations;
const checks=[];
function check(name,fn){fn();checks.push({name,passed:true});}
const close=(actual,expected,tolerance=1e-6)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
check('official final typecheck passed',()=>assert.equal(value(23).value.type_check.passed,true));
check('one tick submits without publishing a geometry result',()=>{assert.equal(one.ok,true);assert.equal(a.tick,1);assert.equal(a.frozen_v1_result,undefined);assert.equal(a.repaired_v2_result,undefined);assert.equal(one.value.world.spatial.tickets[0].batch.version,1);assert.equal(one.value.world.spatial.indices[0].version,2);});
check('deliberate invalid radius rejected and repair version is exactly 2',()=>{assert.equal(c.invalid_replacement.accepted,false);assert.match(c.invalid_replacement.error,/bodies\[0\]\.radius must be finite/);assert.equal(c.repair_version,2);});
check('same tick is rejected without consuming ticket; next tick take succeeds',()=>{assert.equal(c.same_tick_take.accepted,false);assert.match(c.same_tick_take.error,/SPATIAL_RESULT_NEXT_TICK/);assert.equal(b.tick,2);assert.equal(b.frozen_v1_result.version,1);});
check('consumed ticket is stale',()=>{assert.equal(c.consumed_ticket_take.accepted,false);assert.match(c.consumed_ticket_take.error,/SPATIAL_TICKET_UNKNOWN/);});
check('masked nearest ignores closer category2 body and returns surface point',()=>{const hit=c.frozen_v1_result.results[0].hits[0];assert.equal(hit.id,10);assert.equal(hit.distance,2);assert.deepEqual(hit.point,[1.5,0,0]);assert.deepEqual(hit.normal,[-1,0,0]);});
check('sphere overlap returns ordered IDs and coincident +Z normal',()=>{const hits=c.frozen_v1_result.results[1].hits;assert.deepEqual(hits.map(h=>h.id),[10,40]);assert.deepEqual(hits[0].normal,[0,0,1]);});
const fraction=0.5-1/Math.sqrt(116);
check('moving sphere continuous query agrees with independent relative-motion equation',()=>{const hit=c.frozen_v1_result.results[2].hits[0];assert.equal(hit.id,30);close(hit.fraction,fraction);close(hit.distance,10*fraction);close(hit.normal[0],-10/Math.sqrt(116));close(hit.normal[1],-4/Math.sqrt(116));close(hit.point[0],5-5/Math.sqrt(116));close(hit.point[1],2/Math.sqrt(116));});
check('frozen version survives repair; subsequent query sees repaired state',()=>{assert.equal(c.frozen_v1_result.version,1);assert.equal(c.repaired_v2_result.version,2);assert.equal(c.repaired_v2_result.results[0].hits[0].id,40);assert.equal(c.repaired_v2_result.results[0].hits[0].distance,2.5);assert.deepEqual(c.repaired_v2_result.results[1].hits.map(h=>h.id),[40]);assert.deepEqual(three.value.world.spatial.indices[0].bodies.find(x=>x.id===10).position,[9,0,0]);});
check('actual CPU backend and no remaining tickets',()=>{assert.equal(c.final_info.backend,'cpu');assert.equal(c.final_info.pending,0);assert.equal(c.final_info.tickets,0);assert.deepEqual(three.value.world.spatial.tickets,[]);assert.equal(c.tick,3);});
check('public info failure isolated to safe_integer limit',()=>{const o=info.value.world.observations;assert.equal(o.all_limit_strings.safe_integer,'9007199254740991');assert.equal(o.complete_info_publication.accepted,false);assert.match(o['rejected/safe_integer'],/observation integer is outside the portable Luau integer range/);assert.equal(Object.keys(o).filter(k=>k.startsWith('rejected/')).length,1);});
const report={audit:'UNONE blind public spatial interface scout',date:'2026-10-23',scope:'Isolated generic CPU geometry, read-only engine/product assessment',sourceFallbackStep:null,firstSuccessfulSubmissionOperation:16,firstSuccessfulComputationResultOperation:17,firstSuccessfulComputationTick:2,finalTypecheckOperation:23,finalResultOperation:24,backend:'cpu',checks,findings:[{id:'F1',kind:'type ergonomics',natural:true,operation:8,summary:'SpatialBatchResult is not assignable to ObservationValue; direct result publication fails official typecheck.',repair:'New typed-example uses an explicit typed serialization adapter.'},{id:'F2',kind:'runtime contract incompatibility',natural:true,operations:[11,12,13,21],summary:'spatial.info is typed as ObservationValue dictionary, yet direct observation publication fails at runtime. Public-only isolation finds limits.safe_integer=9007199254740991 is rejected.',repair:'Final example publishes discovered scalar info fields and excludes the incompatible nested limit.'}],deliberateNegativeCases:['negative sphere radius in spatial.update','same-tick take','take consumed ticket'],naturalGuesses:['A serializable SpatialBatchResult can be passed directly to observation.set (typechecker rejected).','spatial.info official ObservationValue dictionary can be passed directly to observation.set (runtime rejected).','Luau pcall allows observation and continuation after a rejected validation/timing operation (confirmed).'],analytic:{movingSweepFraction:fraction,movingSweepDistance:10*fraction},actual:c,finalWorldSpatial:three.value.world.spatial,limitations:['No GPU/device/backend parity claim','No rendering or official player validation requested or performed','No performance conclusion from debug timings','No existing test, source, previous audit, or implementation JS read','Bootstrap full stdout was initially visible in tool output but durably recaptured later; see report.md','Intermediate portable-example info workaround stringified table addresses; its observation digests are not deterministic evidence. Final-example omits addresses.']};
fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
const chronology=ops.map(o=>`| ${o.operation} | ${o.label.replaceAll('|','/')} | ${o.status} |`).join('\n');
const text=String.raw`# Blind public spatial interface scout

The requested generic geometry example works on the existing CPU backend. The first delivered computation is operation 17, at the second update after submitting in the first update. The final example passes the official strict Luau typecheck (operation 23), and its three-tick run publishes verified frozen and repaired results (operation 24). Eleven independent assertions check saved engine outputs; their results are in report.json.

This was a fresh public-interface evaluation. Entry points were README.md and target/debug/game.exe --help. I read repository instructions, linked public docs, public JSON schemas, API search/describe output, and officially generated Luau typings. I did not read crates/**, engine implementation JavaScript, existing tests/probes, previous audits, or any other evaluator's findings. sourceFallbackStep = null. No installs, builds, network/account/model calls, commits, or existing game/product files were changed. All authored artifacts are new files under this blind directory; failed variants are preserved.

## Actual computation and delivery

Four generic spheres use category bits 1, 2, 4, 1. The closer category-2 sphere at x=0.5 is excluded by nearest mask=1. The category-1 sphere id10 at x=2 wins with center distance 2, surface point [1.5,0,0], normal [-1,0,0]. Overlap centered at [2,0,0], radius 0.5, mask=1 returns [10,40] in ID order; the coincident id10 hit uses +Z as documented.

The continuous query sphere moves from [0,0,0] to [10,0,0], radius 0.5, mask=4. The target id30 moves from previous_position [5,2,0] to position [5,-2,0], radius 0.5. Relative center displacement is (10t-5,4t-2,0); combined radius is 1. Earliest contact is t=0.5-1/sqrt(116)=0.40715233091147407. Actual f32 fraction is 0.40715232491493225, distance 4.071523189544678. Contact point and normal also agree within 1e-6. Treating the target as stationary at its current endpoint would miss this contact, so this exercises actual moving-target geometry.

Tick 1 deliberately attempts radius=-1. It is rejected with bodies[0].radius must be finite and in 0..=1000000. The old batch still submits as version 1. A same-tick take returns SPATIAL_RESULT_NEXT_TICK; catching that error preserves the ticket. A valid replacement moves id10 to x=9 and returns version 2. Tick 2 successfully takes the frozen version-1 result. Reusing that consumed ticket returns SPATIAL_TICKET_UNKNOWN. A new query sees version 2 at tick 3: nearest becomes id40 at distance 2.5, overlap becomes [40]. Actual world state shows id10 at [9,0,0], live version 2, and no outstanding tickets. The invalid update did not advance the version.

The one-tick output (operation 16) has no published geometric result. It shows a frozen version-1 ticket beside the repaired live version 2. Operation 17 is the first successful delivered geometric result. Operation 12's prospective label says first successful computation, but that run actually failed in start; its retained stdout is authoritative and it is not counted as success.

## Discoverability and natural failures

README links directly to the spatial batches guide. API search spatial returns all relevant methods, exact parameter shapes, lifecycle information, and usage examples. The guide clearly states array vectors, category/mask bitwise semantics, nearest center distance, surface point/normal semantics, moving target previous_position, frozen versions, update-only submission, N+1 delivery, one-shot tickets, and bounds. I did not have to guess a spatial method name or geometry field. Canonical generated typings were directly usable and the installed analyzer was discovered automatically.

Two natural cross-API assumptions failed before the first result. These are separate from the three deliberate negative cases:

1. Directly publishing api.spatial.take's SpatialBatchResult through observation.set fails official typechecking: expected ObservationValue, got SpatialBatchResult (operation 8). All fields are otherwise serializable. I preserved the first example and authored an explicit typed serialization adapter in a new variant, which passed (operation 10). This adds manual plumbing to the obvious AI observation path; a canonical conversion/example or compatible types would help.
2. Directly publishing api.spatial.info passes official typechecking because info returns {[string]: ObservationValue}, but fails at runtime with observation integer is outside the portable Luau integer range (operations 11-13). Public-only isolation reproduces the error specifically for limits.safe_integer, whose exposed string value is 9007199254740991 (operation 21); all other individual limit fields publish. I do not infer the internal numeric cause without source. A value officially described as ObservationValue should be publishable, or the contract should make this exclusion explicit. The final example publishes known scalar info fields.

Error messages made the repairs possible. The invalid body diagnostic uses zero-based bodies[0] although the caller supplied a Luau 1-based array; this is a minor location convention friction. API descriptors repeat broad side-effect text even for info/pack and list common errors without exact codes, so the focused guide is more useful than describe alone for detailed lifecycle recovery.

I assumed standard Luau pcall recovery for rejected validation/timing calls; successful later results confirm that assumption. I did not assume GPU performance or polling semantics: the public fixed-tick contract explicitly says no isReady branch and CPU uses the same delivery boundary.

The intermediate portable-example uses tostring on all info fields, including nested tables. That preserves enough scalar evidence to proceed but emits process-specific table addresses, so its observation digests must not be used as deterministic evidence. The final-example replaces this temporary adapter with scalar-only info publication.

## Evidence and reproducibility

- final-example/main.luau and project.unone.json: final generic example with canonical types and adapters.
- example/: preserved natural direct-result type failure.
- typed-example/: preserved natural info-publication runtime failure after fixing result typing.
- portable-example/: first delivered geometry with temporary string info workaround.
- info-probe/: small public API reproduction isolating safe_integer.
- operations.ndjson: chronological commands/argv, stdin, timestamps, exit status, stdout and stderr from operation 3 onward. Outputs are retained in full, including failures.
- command-transcript.md: readable exact argv and raw outputs from the ledger.
- engine-api.luau: generated official type contract.
- report.json: observations, conclusions, actual state and eleven assertion results.
- bootstrap-entrypoints-recapture.txt: durable recapture of initial public instructions/README/help.

Operation 1 was the initial PowerShell read of D:/AGENTS.md, D:/Projects/AGENTS.md and D:/Projects/Unone/AGENTS.md if present, followed by README.md and game.exe --help. Only Unone/AGENTS.md existed. The directory inventory branch emitted no output because blind did not yet exist. Exit was 0, stderr empty, and complete stdout was visible in the tool response. Operation 2 created the new blind directory and run-command.mjs recorder; exit was 0 with empty stdout/stderr. Their exact initial commands are recorded in bootstrap-operations.json. The recorder did not yet exist for operations 1-2, so I did not pretend a later recapture was the original timestamped stdout. Operation 25 was a separate shell-quoting error while recapturing this evidence; it is preserved and repaired by owned Node helper in operation 26. It happened after geometry success and is not an engine/API failure.

No GPU, rendering, performance, capacity stress, cancellation, or hot reload claim is made. The requested early/consumed/retry boundary and validation repair were exercised through actual results. No source fallback was needed.

## Chronological command ledger

| Operation | Purpose | Exit |
|---|---|---|
`+chronology+String.raw`

After this report is generated, the verifier invocation is appended as the next ledger operation. seal.mjs then writes SHA256SUMS.json and SEAL.txt once. The manifest covers every other artifact in this blind directory, including this report, source files, and the final ledger. No covered artifact is rewritten after sealing.
`;
fs.writeFileSync(path.join(root,'report.md'),text,{flag:'wx'});
const transcript=ops.map(o=>`## Operation ${o.operation}: ${o.label}\n\nCommand as exact argv (no shell reconstruction):\n\n~~~~json\n${JSON.stringify({cwd:o.cwd,command:o.command,args:o.args,stdin:o.stdin,status:o.status},null,2)}\n~~~~\n\nstdout:\n\n~~~~text\n${o.stdout}\n~~~~\n\nstderr:\n\n~~~~text\n${o.stderr}\n~~~~\n`).join('\n');
fs.writeFileSync(path.join(root,'command-transcript.md'),transcript,{flag:'wx'});
console.log(JSON.stringify({checksPassed:checks.length,checksTotal:checks.length,sourceFallbackStep:null,firstSuccessfulComputationResultOperation:17,report:path.join(root,'report.md'),finalResultOperation:24}));