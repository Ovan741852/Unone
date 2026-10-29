// Only launch the reviewed synthetic browser verification with explicit inputs.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const i=process.argv.indexOf('--root');
const root=resolve(process.argv[i+1]);
const r=spawnSync(process.execPath,['scripts/verify-spatial-runtime.mjs','artifacts/spatial-p2-runtime','docs/audits/spatial-scout-fixes-2026-10-23/web-runtime-result-final.json'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:200*1024});
console.log(JSON.stringify({event:'browser',argv:[process.execPath,'scripts/verify-spatial-runtime.mjs','artifacts/spatial-p2-runtime','docs/audits/spatial-scout-fixes-2026-10-23/web-runtime-result-final.json'],status:r.status,error:r.error?.message,stdout:r.stdout,stderr:r.stderr}));
assert.ok(!r.error);assert.equal(r.status,0);
const result=JSON.parse(r.stdout);assert.equal(result.ok,true);
console.log(JSON.stringify({event:'task_result',complete:true,browser:result.browser,scope:'fresh WASM CPU/WebGPU, main and Worker; synthetic complete info/result u32/tiny-coordinate regression; no renderer or speedup claim'}));
