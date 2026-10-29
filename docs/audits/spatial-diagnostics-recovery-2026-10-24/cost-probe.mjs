import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),env=JSON.parse(await readFile(resolve(here,'environment.json'),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
for(const f of [env.binary,env.analyzer])assert.equal(sha(await readFile(f.path)),f.sha256);
const argv=[resolve(env.sdk,'tools/benchmark-spatial.mjs'),'--sdk',env.sdk,'--bodies','4096','--queries','128','--warmup','3','--samples','9','--analyzer',env.analyzer.path];
const r=spawnSync(process.execPath,argv,{encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:200*1024});assert.ok(!r.error);assert.equal(r.status,0,r.stderr);
const report=JSON.parse(r.stdout);assert.equal(report.ok,true);assert.equal(report.samples.length,9);assert.equal(report.configuration.warmup,3);assert.equal(report.backend,'cpu');
for(const sample of report.samples){assert.equal(sample.batch.bodies,4096);assert.equal(sample.batch.queries,128);assert.equal(sample.batch.pair_tests_upper_bound,524288);assert.equal(sample.submit_boundary.operation,'spatial.submit');assert.equal(sample.take_boundary.operation,'spatial.take');}
const sorted=report.samples.map(v=>v.batch.executor.total_ms).sort((a,b)=>a-b);assert.equal(report.summary.executor_ms.p50,sorted[4]);assert.equal(report.summary.executor_ms.p95,sorted[8]);
for(const f of [env.binary,env.analyzer])assert.equal(sha(await readFile(f.path)),f.sha256);
console.log(JSON.stringify({event:'task_result',complete:true,argv:[process.execPath,...argv],report,scope:'Actual packaged public CPU benchmark with official strict check; repeated samples and explicit process/binding/executor scopes, no speedup/threshold/rendering claim.'}));
