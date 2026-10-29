// Launch only the reviewed synthetic CPU/WebGPU main/Worker regression.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const at=process.argv.indexOf('--root'),root=resolve(process.argv[at+1]);
const argv=['scripts/verify-spatial-runtime.mjs','artifacts/spatial-observation-profile-runtime','docs/audits/spatial-observation-profile-2026-10-23/web-result.json'];
const r=spawnSync(process.execPath,argv,{cwd:root,encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:200*1024});
console.log(JSON.stringify({event:'browser',argv:[process.execPath,...argv],status:r.status,error:r.error?.message,stdout:r.stdout,stderr:r.stderr}));
assert.ok(!r.error);assert.equal(r.status,0);
const value=JSON.parse(r.stdout);assert.equal(value.ok,true);
console.log(JSON.stringify({event:'task_result',complete:true,browser:value.browser,runs:Object.fromEntries(Object.entries(value.runs).map(([name,v])=>[name,{backend:v.observations.profile.backend,last:v.observations.profile.last,counts:v.observations.profile.totals}])),scope:'fresh hash-verified WASM CPU/WebGPU in main/Worker; empty arrays and bounded4096x128 diagnostic attribution, no GPU kernel/speedup/rendering claim'}));
