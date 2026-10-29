// Explicit current native GPU integration test. Uses preinstalled offline tools.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const at=process.argv.indexOf('--root'),root=resolve(process.argv[at+1]);
const binary=resolve(root,'.toolcache/cargo/bin/cargo.exe');
const argv=['test','--manifest-path','crates/unone-spatial-gpu/Cargo.toml','--offline','--test','runtime','--','--nocapture'];
const env={...process.env,CARGO_HOME:resolve(root,'.toolcache/cargo'),RUSTUP_HOME:resolve(root,'.toolcache/rustup'),PATH:resolve(root,'.toolcache/cargo/bin')+';'+resolve(root,'.toolcache/w64devkit/bin')+';'+process.env.PATH,LIBRARY_PATH:resolve(root,'.toolcache/rustup/toolchains/1.95.0-x86_64-pc-windows-gnu/lib/rustlib/x86_64-pc-windows-gnu/lib/self-contained')};
const r=spawnSync(binary,argv,{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:55000,maxBuffer:150*1024});
console.log(JSON.stringify({event:'native',argv:[binary,...argv],status:r.status,error:r.error?.message,stdout:r.stdout,stderr:r.stderr}));
assert.ok(!r.error);assert.equal(r.status,0);
assert.match(r.stdout,/test result: ok\. 1 passed/);assert.match(r.stderr,/Luau spatial GPU adapter:/);
console.log(JSON.stringify({event:'task_result',complete:true,scope:'required actual native GPU; measured host phases/bytes and canonical profile-read purity; cold2body4query correctness case, no speedup or rendering claim; selected source fingerprints are not a full compiler dependency graph'}));
