// Read-only isolated spatial source/design review repro.
// Run from any cwd. It executes only the existing engine binaries against the
// new generic numeric fixture in this directory; no real game is loaded.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pathToFileURL} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'../../../..');
const runs=[];
for(const profile of ['debug','release']) {
  const executable=resolve(root,'target',profile,'game.exe');
  const args=['--project',resolve(here,'tiny-normal'),'run','--frames','2','--json'];
  const run=spawnSync(executable,args,{cwd:root,encoding:'utf8',timeout:30000});
  assert.equal(run.error,undefined);
  const output=JSON.parse(run.stdout);
  assert.equal(output.ok,false);
  assert.ok(output.diagnostics.some(d=>d.explanation==='spatial result[0] contains invalid contact geometry'));
  runs.push({profile,executable,sha256:createHash('sha256').update(readFileSync(executable)).digest('hex'),args,status:run.status,signal:run.signal,stdout:run.stdout,stderr:run.stderr});
}
// Mirror only the exact f32 operations in normal_or_z, to expose why the CPU
// executor's own normal fails its post-execution envelope validation.
const f=Math.fround,x=f(3e-23),square=f(x*x),length=f(Math.sqrt(square)),normal=f(x/length),normalSquared=f(normal*normal);
assert.ok(Math.abs(normalSquared-1)>0.002);
const {validateSpatialGpuBatch,packSpatialGpuBatch}=await import(pathToFileURL(resolve(root,'web/shared/spatial-gpu.mjs')));
const sparseBatch={version:1,bodies:[{id:1,position:new Array(3),radius:0}],queries:[{kind:'nearest',point:[0,0,0],max_distance:1}]};
validateSpatialGpuBatch(sparseBatch);
const sparsePosition=Array.from(new Float32Array(packSpatialGpuBatch(sparseBatch).bodies.buffer).subarray(4,7));
assert.ok(sparsePosition.every(Number.isNaN));
const searchArgs=['api','search','batch collision','--json'];
const search=spawnSync(resolve(root,'target/debug/game.exe'),searchArgs,{cwd:root,encoding:'utf8',timeout:30000});
assert.equal(search.error,undefined);
const searchOutput=JSON.parse(search.stdout);
assert.deepEqual(searchOutput.value.matches,[]);
const report={scope:'independent source/design review; existing CLI execution, no rebuild',fixture:{position:[3e-23,0,0],radius:0,query:{kind:'nearest',point:[0,0,0],max_distance:1}},calculation:{x,square,length,normal,normalSquared},sparseVector:{accepted:true,packedPosition:sparsePosition.map(v=>Number.isNaN(v)?'NaN':v),scope:'direct public JavaScript executor input only; canonical Rust host tasks have dense arrays'},discovery:{args:searchArgs,status:search.status,stdout:search.stdout,stderr:search.stderr},runs};
writeFileSync(resolve(here,'numeric-repro-output.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
