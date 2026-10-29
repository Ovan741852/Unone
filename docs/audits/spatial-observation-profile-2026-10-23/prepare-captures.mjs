// Pin the fresh SDK/runtime and explicitly selected public/implementation inputs.
import assert from 'node:assert/strict';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
const base='docs/audits/spatial-observation-profile-2026-10-23',sdk='artifacts/spatial-observation-profile-sdk';
async function identity(path){const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return {path,bytes:(await stat(path)).size,sha256:h.digest('hex')};}
const environment={sdk:resolve(root,sdk),binary:await identity(resolve(root,sdk,'bin/game.exe')),analyzer:await identity(resolve(root,'.toolcache/luau-0.734/luau-analyze.exe'))};
await writeFile(resolve(here,'environment.json'),JSON.stringify(environment,null,2)+'\n',{flag:'wx'});
for(const file of ['docs/engine.d.luau','docs/spatial-batches.md'])assert.equal(await readFile(resolve(root,sdk,file),'utf8'),await readFile(resolve(root,file),'utf8'));
const subjects=[
 'docs/spatial-batches.md','docs/sdk-readme.md','docs/engine.d.luau','crates/unone-engine/src/engine.d.luau',
 'crates/unone-engine/src/spatial.rs','crates/unone-engine/src/runtime/spatial.rs','crates/unone-engine/src/runtime.rs',
 'crates/unone-engine/src/runtime/bindings/value.rs','crates/unone-engine/src/runtime/bindings/state.rs','crates/unone-engine/src/runtime/bindings/spatial.rs',
 'crates/unone-engine/src/api.rs','crates/unone-cli/src/sdk.rs','crates/unone-web-live-smoke/src/main.rs',
 'crates/unone-engine/tests/observation_arrays.rs','crates/unone-engine/tests/spatial_runtime.rs',
 'crates/unone-spatial-gpu/src/lib.rs','crates/unone-spatial-gpu/tests/runtime.rs','crates/unone-spatial-gpu/Cargo.toml','crates/unone-spatial-gpu/Cargo.lock',
 'web/shared/spatial-gpu.mjs','web/shared/spatial-host.mjs','web/shared/spatial.wgsl',
 'web/shared/runtime-core.mjs','web/shared/runtime-backend.mjs','web/shared/runtime-worker.js','web/shared/load-project.js',
 'web/shared/job-binary.mjs','web/shared/job-pool.mjs','web/shared/instance-transfer.mjs',
 'scripts/verify-spatial-runtime.mjs','plugins/org.unone.ai-native/src/rubric.mjs','plugins/org.unone.ai-native/src/audit.mjs',
 sdk+'/README.md',sdk+'/sdk.json',sdk+'/docs/engine.d.luau',sdk+'/docs/spatial-batches.md',
 'artifacts/spatial-observation-profile-runtime/runtime.json',base+'/environment.json',
 'scripts/verify-spatial-webgpu.mjs','crates/unone-spatial-gpu/examples/browser_fixtures.rs',
];
await writeFile(resolve(here,'subject-paths.json'),JSON.stringify(subjects,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({subjects:subjects.length,sdkGuideAndTypes:'exact canonical bytes',binary:environment.binary}));
