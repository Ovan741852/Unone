import {readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
const sdk=resolve(root,'artifacts/spatial-hardening-sdk-v2');
const hash=b=>createHash('sha256').update(b).digest('hex');
async function identity(path){const b=await readFile(path);return {path,bytes:(await stat(path)).size,sha256:hash(b)};}
const environment={sdk,binary:await identity(resolve(sdk,'bin/game.exe')),analyzer:await identity(resolve(root,'.toolcache/luau-0.734/luau-analyze.exe')),runtime:'artifacts/spatial-hardening-runtime',node:process.version,platform:process.platform,architecture:process.arch,scope:'Pinned preinstalled SDK/analyzer and fresh release WASM; no installation, accounts, game content, commit or push.'};
await writeFile(resolve(here,'environment.json'),JSON.stringify(environment,null,2)+'\n',{flag:'wx'});
const paths=[
 'crates/unone-engine/src/diagnostics.rs','crates/unone-engine/src/spatial.rs','crates/unone-engine/src/runtime.rs','crates/unone-engine/src/runtime/spatial.rs','crates/unone-engine/src/runtime/spatial_metrics.rs','crates/unone-engine/src/runtime/bindings/spatial.rs','crates/unone-engine/src/engine.d.luau','crates/unone-engine/src/api.rs',
 'docs/engine.d.luau','docs/spatial-batches.md','docs/sdk-readme.md','crates/unone-cli/src/sdk.rs','crates/unone-cli/src/export.rs','crates/unone-web-live-smoke/src/main.rs',
 'crates/unone-engine/tests/spatial_diagnostics.rs','crates/unone-engine/tests/spatial_diagnostic_boundaries.rs','crates/unone-engine/tests/spatial_faults.rs','crates/unone-engine/tests/spatial_metrics.rs','crates/unone-engine/tests/spatial_runtime.rs',
 ...['spatial-host.mjs','spatial-metrics.mjs','spatial-gpu.mjs','spatial.wgsl','runtime-core.mjs','runtime-backend.mjs','runtime-worker.js','load-project.js','job-binary.mjs','job-pool.mjs','instance-transfer.mjs','spatial-faults.test.mjs','spatial-metrics.test.mjs','spatial-host.test.mjs','spatial-gpu.test.mjs','runtime-core.test.mjs'].map(p=>'web/shared/'+p),
 'scripts/verify-spatial-runtime.mjs','scripts/benchmark-spatial.mjs','crates/unone-spatial-gpu/Cargo.toml','crates/unone-spatial-gpu/Cargo.lock','crates/unone-spatial-gpu/src/lib.rs','crates/unone-spatial-gpu/examples/benchmark.rs','crates/unone-spatial-gpu/tests/runtime.rs','Cargo.toml','Cargo.lock',
 ...['README.md','sdk.json','docs/spatial-batches.md','docs/engine.d.luau','examples/spatial-diagnostics/main.luau','examples/spatial-diagnostics/project.unone.json','examples/spatial-diagnostics/scene.json','examples/spatial-diagnostics/README.md','tools/benchmark-spatial.mjs'].map(p=>'artifacts/spatial-hardening-sdk-v2/'+p),
 'artifacts/spatial-hardening-runtime/runtime.json','plugins/org.unone.ai-native/src/rubric.mjs','plugins/org.unone.ai-native/src/audit.mjs','docs/audits/spatial-diagnostics-recovery-2026-10-24/environment.json',
];
// Save actual selected source bytes as an additional immutable local archive,
// not just a hash list. This is still not a complete compiler dependency graph.
const archive=[];for(const path of paths.filter(p=>!p.startsWith('artifacts/')&&!p.includes('/audits/'))){const bytes=await readFile(resolve(root,path));archive.push({path,sha256:hash(bytes),bytes:bytes.length,text:bytes.toString('utf8')});}
const snapshot={schema:'unone.selected-source-snapshot.v1',createdAt:new Date().toISOString(),limitations:'Selected text source bytes, not a full source-to-binary build/dependency attestation or independent signature.',files:archive};
const snapshotBytes=Buffer.from(JSON.stringify(snapshot)+'\n');if(snapshotBytes.length>2*1024*1024)throw Error('snapshot exceeds audit file limit');
await writeFile(resolve(here,'source-snapshot.json'),snapshotBytes,{flag:'wx'});
paths.push('docs/audits/spatial-diagnostics-recovery-2026-10-24/source-snapshot.json');
await writeFile(resolve(here,'subject-paths.json'),JSON.stringify(paths,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({subjectsBeforeBlind:paths.length,sourceArchiveFiles:archive.length,sourceArchiveBytes:snapshotBytes.length,binary:environment.binary}));
