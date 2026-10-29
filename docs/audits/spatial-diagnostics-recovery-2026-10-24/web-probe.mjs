import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const root=resolve(process.argv[process.argv.indexOf('--root')+1]);
const argv=['scripts/verify-spatial-runtime.mjs','artifacts/spatial-hardening-runtime','docs/audits/spatial-diagnostics-recovery-2026-10-24/web-result.json'];
const r=spawnSync(process.execPath,argv,{cwd:root,encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:200*1024});assert.ok(!r.error);assert.equal(r.status,0,r.stderr);
const report=JSON.parse(r.stdout);assert.equal(report.ok,true);assert.equal(Object.keys(report.runs).length,4);
console.log(JSON.stringify({event:'task_result',complete:true,argv:[process.execPath,...argv],report,scope:'Actual fresh hash-verified WASM CPU/WebGPU main/Worker; structured input/timing boundaries, binding/setup/bridge metrics and geometry/[] assertions; no real device-loss or speedup claim.'}));
