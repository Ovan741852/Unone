// Assemble the scoped retest from actual final captures and sealed first-use evidence.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
const base='docs/audits/spatial-scout-fixes-2026-10-23';
const digest=b=>createHash('sha256').update(b).digest('hex');
const read=async p=>JSON.parse(await readFile(resolve(here,p),'utf8'));
const captures=await Promise.all(['capture-public-final.json','capture-web-final.json','capture-blind-replay.json'].map(read));
for(const c of captures){
 assert.equal(c.exitCode,0);assert.equal(c.sourceChanged,false);assert.equal(c.timedOut,false);assert.equal(c.outputTruncated,false);
 assert.deepEqual(c.subject,captures[0].subject);
 for(const f of c.subject)assert.equal(digest(await readFile(resolve(root,f.path))),f.sha256,'changed subject '+f.path);
}
const blind=resolve(here,'blind/scout-sdk-blind-v2');
const manifestBytes=await readFile(resolve(blind,'SHA256SUMS.json'));
const seal=(await readFile(resolve(blind,'SEAL.txt'),'utf8')).trim();
assert.ok(seal.includes(digest(manifestBytes)),'detached manifest hash');
const manifest=JSON.parse(manifestBytes);
const files=Array.isArray(manifest)?manifest:manifest.files;
assert.ok(Array.isArray(files));
for(const f of files){
 const file=resolve(blind,f.path);assert.ok(!relative(blind,file).startsWith('..'));
 const bytes=await readFile(file);assert.equal(digest(bytes),f.sha256);
 assert.equal(bytes.length,f.bytes??f.length??f.size);
}
const first=await read('blind/scout-sdk-blind-v2/FIRST-USE.json');
const steps=Number((await readFile(resolve(blind,'sequence.txt'),'utf8')).trim());
const verification=JSON.stringify({ok:true,files:files.length,manifestSha256:digest(manifestBytes),scope:'Artifact hash/length consistency, not independent authorship certification'},null,2)+'\n';
try { await writeFile(resolve(here,'blind-verification.json'),verification,{flag:'wx'}); }
catch(error) { if(error.code!=='EEXIST')throw error;assert.equal(await readFile(resolve(here,'blind-verification.json'),'utf8'),verification); }
const evidence=[];
async function ref(id,kind,path,quote){
 const bytes=await readFile(resolve(root,path));assert.ok(bytes.toString('utf8').includes(quote),id+' missing quote');
 evidence.push({id,kind,path,sha256:digest(bytes),quote});
}
await ref('guide','document','artifacts/spatial-p2-sdk/docs/spatial-batches.md','Publish complete info and result records directly');
await ref('sdk-entry','document','artifacts/spatial-p2-sdk/README.md','For generic batched geometry');
await ref('types','document','artifacts/spatial-p2-sdk/docs/engine.d.luau','export type SpatialQueryResult');
await ref('blind','observation',base+'/blind/scout-sdk-blind-v2/FIRST-USE.json','luauTypeFailures');
await ref('blind-detail','observation',base+'/blind/scout-sdk-blind-v2/FIRST-USE.md','First delivered geometry: 028');
await ref('public','execution',base+'/capture-public-final.json','strict types without adapters');
await ref('web','execution',base+'/capture-web-final.json','webgpu');
await ref('replay','execution',base+'/capture-blind-replay.json','emptyShapes');
await ref('seal','observation',base+'/blind-verification.json','"ok": true');
await ref('validation','observation',base+'/validation.json','"passed": 318');
await ref('review','observation',base+'/source-review.md','No new blocking finding was confirmed');
const checks=[];
function check(id,rating,answer,reason,nextAction,refs){checks.push({id,rating,status:rating>=3?'verified':'partial',access:'public',answer,reason,nextAction,evidence:refs});}
check('purpose',3,
 'A fresh AI used only the newly packed SDK entrypoints and linked public guide, correctly distinguishing generic geometry/execution from caller-owned movement and selection policy.',
 'Its first-use explanation preserves CPU default, fixed delivery, full-scan/readback and GPU documentation-only limits. Repository source and prior audits were not used; this is one author trial.',
 'Retain the clear ownership and v1 limits, and keep SDK entrypoints synchronized with the canonical guide.', ['sdk-entry','guide','blind-detail','replay']);
check('capabilities',3,
 'The actual new SDK contains the complete canonical guide and types. Public descriptors link it, and collision/Chinese queries now find spatial methods.',
 'SDK-only discovery succeeded. An unrelated broad scene-entity phrase missed and the author recovered with canonical EntityApi/narrower search; a no-match does not establish missing functionality.',
 'Preserve package inventory/link regressions and improve unrelated discovery only when backed by concrete author intent.', ['sdk-entry','guide','types','blind','public']);
check('operation',4,
 'The original authored Luau passed its first actual official analyzer invocation and both native runs. At operation 28 it delivered masked nearest, ID-sorted overlap and moving-target sweep with no casts, adapters or source fallback.',
 'Independent double-precision oracle and informed replay verify geometry/order, zero/max-u32 IDs, frozen data and packed repair. The initial check failure was JSON BOM before analyzer execution, not a spatial type failure. This rating covers the bounded representative CPU task, not every input/device.',
 'Keep the independent example and oracle as a regression; add a new fresh trial after future contract changes.', ['blind','blind-detail','replay','public']);
check('context',3,
 'Frozen body/query inputs survive caller mutation, failed replacement, packed version-2 repair and index destruction. Version-1 and version-2 results arrive in order and ticket usage returns to zero.',
 'Both first-use records and actual replay expose versions, usage and original geometry. Persistent handles, device restoration and reload are not part of this authoring task.',
 'Keep version and lifetime semantics discoverable without implying persistent handle restoration.', ['guide','blind-detail','replay','public']);
check('observation',3,
 'Complete info, batch and individual result records now publish directly with canonical strict types; max-u32 ID and numeric safe_integer survive native and fresh WASM execution.',
 'The two former publication blockers are reproduced as successful unadapted paths. Empty Lua hits tables still become {} in generic observation JSON; Luau #hits=0 works, but external JSON consumers must not assume [] identity. Web full info is captured in start before external-backend setup; update/host reports separately verify WebGPU selection.',
 'Define a generic empty-array observation representation before promising stable JSON array identity, and retain direct publication/type-negative regressions.', ['types','blind-detail','replay','public','web']);
check('diagnostics',3,
 'Duplicate replacement, negative radius, same-tick take and consumed ticket produce actionable errors, and the respective continuation/repair succeeds.',
 'The fresh author also recovered from invalid project JSON encoding. Errors remain strings and sometimes require caller field/context interpretation; a helper-verifier syntax failure is not an engine diagnostic failure.',
 'Retain stable spatial error codes and consider structured field/actual/expected recovery details.', ['blind','blind-detail','public','replay']);
check('recovery',3,
 'Rejected replacement preserves version 1; a packed repair returns exactly version 2. Caught early take does not consume work; next-tick delivery succeeds, and consumed-ticket reuse is rejected without corrupting state.',
 'Actual first-use and replay demonstrate per-call validation/lifecycle recovery. GPU device loss, terminal overflow restart and stalled completions were not freshly exercised by this SDK author.',
 'Keep validation versus terminal executor faults distinct and schedule separate device-interruption coverage when that scope is requested.', ['guide','blind','public','replay']);
check('boundaries',3,
 'Only new synthetic local projects and engine/SDK artifacts are used. The fresh example and replay verify an unrelated scene entity remains unchanged through queries, mutation of caller tables and index destruction.',
 'This supports the geometry-versus-scene boundary and explicit lifetime rules; it does not establish operating-system sandboxing or account/security isolation.',
 'Retain geometry-only APIs and opaque handles; keep movement, policy and game responses in caller Luau.', ['guide','blind-detail','replay','public']);
check('performance',2,
 'The release CLI exposes measured CPU phase/frame/resource telemetry and actual backend/usage. Guide and author correctly retain O(B×Q), per-dispatch upload/readback and no speedup promise.',
 'Generic CPU telemetry is real, but these small correctness fixtures do not isolate spatial execution/transfer/application costs or establish an acceleration threshold. Actual WebGPU execution is not a GPU benchmark.',
 'Expose spatial-cost attribution or explicit unavailability and profile bounded end-to-end workloads before choosing automatic thresholds.', ['guide','blind-detail','public','web']);
check('reproducibility',3,
 'The SDK executable/analyzer are identified by hash, 33 selected inputs are fingerprinted, all three final probes use identical subjects, and the sealed blind evidence is verified. The informed public case also confirms nonempty equal same-seed digests.',
 'The fresh trial and later informed replay remain distinct. Original failed helper/probe/build attempts are preserved. Hashes are not immutable source copies, authorship certification, a clean source-to-binary proof or cross-device determinism.',
 'Retain this failed/successful evidence and use another fresh author for future first-use claims.', ['seal','blind','public','replay','validation']);
const report={schema:'unone.ai-native.audit.v1',rubricVersion:'1.0.0',target:{
 id:'unone-spatial-v1-sdk-retest',name:'Unone spatial SDK public authoring',surface:'mixed',
 scope:'SDK-only public CLI/docs/canonical types and headless CPU spatial authoring, with supplementary informed native/tiny-input and freshly built WASM CPU/WebGPU main/Worker regression. Excludes renderer, speedup benchmark, device-loss, persistent saves and cross-platform certification.',
 version:'spatial api_version 1 / USB1; game 0.1.0',
 revision:'New release SDK CLI SHA256 b05484098012607e5e65f9d5926711061eda94de0f31d7d7ddbaaa188853111d; checkout 7b9424cf42d0409633c9ce782503075bd09018f9 with preserved concurrent changes; selected hashes identify bounded reviewed inputs.',
 environment:'Windows x64, official Luau 0.734, new release CLI/WASM, Edge 155.0.4283.62 with actual WebGPU; synthetic local fixtures; existing local toolchains, no install/account/deployment/game edits.'},
 trial:{mode:'retest',entryPoints:['artifacts/spatial-p2-sdk/README.md','artifacts/spatial-p2-sdk/sdk.json','artifacts/spatial-p2-sdk/bin/game.exe --help'],steps,firstSuccessStep:first.firstDeliveredGeometryStep,sourceFallbackStep:first.sourceFallbackStep,wrongGuesses:first.naturalWrongGuesses.length,limitations:[
  'Aggregate is an informed implementation retest. Only the separately sealed SDK author is fresh-context/blind. Source review, tests and later replay are not relabelled as blind authorship.',
  'Trial counters use the fresh author positive operation IDs, excluding recorder bootstrap 000. First actual strict analyzer passes at 026, first submission at 027 and delivered geometry at 028. Later verifier/tool repairs are retained and separate from the first-use task.',
  'The first official check attempt failed on PowerShell-generated JSON BOM before analyzer invocation. Later no-Python, process-policy and PowerShell vector-syntax failures are retained. No Luau type or native run failed before first delivered geometry.',
  'Root informed probes also retain a pcall contextual-type/local-shadow failure and a Node entities-shape assertion mistake. The repaired probe-v3 changes only fixture/verification code, not the product. Final probes were actually rerun with expanded identical inputs, not legitimized by replacing hashes.',
  'The recorder replay copies only the three sealed headless inputs, not presentation/AGENTS files, to fresh OS temp and checks geometry again. It is not another fresh author trial.',
  'Empty Lua table array identity is not preserved by generic observation JSON. This is a retained follow-up limitation; no promise of [] for zero-hit tables or every nested array type is inferred.',
  'The prior sparse-vector validator finding for direct malformed JavaScript callers remains outside this canonical Luau authoring scope; it is not claimed fixed by these four P2 changes.',
  'Full Web info is published during start, before external-backend configuration, so that snapshot names cpu. Update and host reports verify actual WebGPU backend; the evidence does not claim the start snapshot already names WebGPU.',
  'Numeric normalization fixes invalid contact normals. Existing f32 tiny-distance/selection arithmetic and GPU tolerance limits remain; no exact cross-device geometry/digest promise is made.',
  'Scores cover all ten scoped questions only. This SDK/release task differs from the prior repository/debug scope; do not present a numerical before/after comparison or a universal AI-native certification.',
  'Source fingerprints are selected inputs, not immutable source snapshots. Only the blind artifacts have a detached seal. One author and bounded fixtures do not establish statistical usability or full engine/device coverage.'
 ]},subject:captures[0].subject,evidence,checks,issues:[]};
await writeFile(resolve(here,'audit.proposed.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({subjects:report.subject.length,blindFiles:files.length,steps,firstSuccess:first.firstDeliveredGeometryStep,wrongGuesses:first.naturalWrongGuesses.length,manifestSha256:digest(manifestBytes)}));
