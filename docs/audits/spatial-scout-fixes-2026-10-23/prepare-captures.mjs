// Select bounded explicit inputs for the actual recorder executions.
import {readFile,writeFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
const base='docs/audits/spatial-scout-fixes-2026-10-23';
const sdk='artifacts/spatial-p2-sdk';
async function identity(path){const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return {path,bytes:(await stat(path)).size,sha256:h.digest('hex')};}
const environment={sdk:resolve(root,sdk),binary:await identity(resolve(root,sdk,'bin/game.exe')),analyzer:await identity(resolve(root,'.toolcache/luau-0.734/luau-analyze.exe'))};
await writeFile(resolve(here,'environment.json'),JSON.stringify(environment,null,2)+'\n',{flag:'wx'});
assert.equal(await readFile(resolve(root,sdk,'docs/spatial-batches.md'),'utf8'),await readFile(resolve(root,'docs/spatial-batches.md'),'utf8'));
assert.equal(await readFile(resolve(root,sdk,'docs/engine.d.luau'),'utf8'),await readFile(resolve(root,'docs/engine.d.luau'),'utf8'));
const subjects=[
 'docs/spatial-batches.md','docs/sdk-readme.md','docs/engine.d.luau','crates/unone-engine/src/engine.d.luau',
 'crates/unone-engine/src/spatial.rs','crates/unone-engine/src/runtime/spatial.rs',
 'crates/unone-engine/src/runtime/bindings/spatial.rs','crates/unone-engine/src/runtime/bindings/value.rs','crates/unone-engine/src/runtime/bindings/state.rs',
 'crates/unone-engine/src/api.rs','crates/unone-cli/src/sdk.rs',
 'crates/unone-engine/tests/spatial_core.rs','crates/unone-engine/tests/spatial_runtime.rs',
 'crates/unone-spatial-gpu/src/lib.rs','crates/unone-spatial-gpu/tests/differential.rs',
 'web/shared/spatial.wgsl','web/shared/spatial-gpu.mjs','web/shared/spatial-host.mjs',
 'web/shared/runtime-core.mjs','web/shared/runtime-backend.mjs','web/shared/runtime-worker.js',
 'scripts/verify-spatial-runtime.mjs',
 'plugins/org.unone.ai-native/src/rubric.mjs','plugins/org.unone.ai-native/src/audit.mjs',
 sdk+'/README.md',sdk+'/sdk.json',sdk+'/docs/spatial-batches.md',sdk+'/docs/engine.d.luau',
 'artifacts/spatial-p2-runtime/runtime.json',base+'/environment.json',
];
await writeFile(resolve(here,'subject-paths.json'),JSON.stringify(subjects,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({subjects:subjects.length,environment,sdkGuideAndTypes:'byte-identical'}));
