import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const root=resolve(process.argv[process.argv.indexOf('--root')+1]);
const binary=resolve(root,'.toolcache/cargo/bin/cargo.exe');
const env={...process.env,CARGO_HOME:resolve(root,'.toolcache/cargo'),RUSTUP_HOME:resolve(root,'.toolcache/rustup'),LIBRARY_PATH:resolve(root,'.toolcache/rustup/toolchains/1.95.0-x86_64-pc-windows-gnu/lib/rustlib/x86_64-pc-windows-gnu/lib/self-contained')};
for(const key of Object.keys(env))if(key.toUpperCase()==='PATH')delete env[key];env.PATH=resolve(root,'.toolcache/cargo/bin')+';'+resolve(root,'.toolcache/w64devkit/bin')+';'+process.env.PATH;
for(const argv of [['test','--offline','--manifest-path','crates/unone-spatial-gpu/Cargo.toml','--test','runtime','--','--nocapture'],['run','--offline','--manifest-path','crates/unone-spatial-gpu/Cargo.toml','--example','benchmark','--','--bodies','4096','--queries','128','--warmup','3','--samples','9','--backend','both']]){
 const r=spawnSync(binary,argv,{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:50000,maxBuffer:150*1024});assert.ok(!r.error);assert.equal(r.status,0,r.stderr);
 if(argv[0]==='run'){
  const report=JSON.parse(r.stdout);assert.equal(report.ok,true);assert.equal(report.build_profile,'debug');assert.equal(report.configuration.samples,9);assert.equal(report.runs.length,2);assert.match(report.adapter,/NVIDIA/);
  for(const run of report.runs){assert.equal(run.samples.length,9);assert.ok(run.setup_ms>=0);const sorted=run.samples.map(v=>v.executor_wall_ms).sort((a,b)=>a-b);assert.equal(run.executor_wall_ms.p50,sorted[4]);assert.equal(run.executor_wall_ms.p95,sorted[8]);}
  console.log(JSON.stringify({event:'benchmark',argv:[binary,...argv],status:r.status,report,stderr:r.stderr}));
 }else{assert.match(r.stdout,/test result: ok\. 1 passed/);assert.match(r.stderr,/Luau spatial GPU adapter:/);console.log(JSON.stringify({event:'integration',argv:[binary,...argv],status:r.status,stdout:r.stdout,stderr:r.stderr}));}
}
console.log(JSON.stringify({event:'task_result',complete:true,scope:'Required real native GPU. Cold2x4 Luau fixed-tick integration and debug direct-executor4096x128 benchmark, warmup3 samples9, setup separate. CPU release SDK and native debug runs are not a matched end-to-end speed comparison; no full dependency graph, rendering or GPU kernel timestamp claim.'}));
