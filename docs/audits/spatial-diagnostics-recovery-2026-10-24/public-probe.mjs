// Reviewed informed public SDK trial. All fixture inputs are selected subjects.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));const env=JSON.parse(await readFile(resolve(here,'environment.json'),'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
async function identity(v){assert.equal(hash(await readFile(v.path)),v.sha256);assert.equal((await stat(v.path)).size,v.bytes);}
await identity(env.binary);await identity(env.analyzer);
const temp=await mkdtemp(resolve(tmpdir(),'unone-hardening-public-'));
for(const file of ['main.luau','project.unone.json','scene.json'])await writeFile(resolve(temp,file),await readFile(resolve(env.sdk,'examples/spatial-diagnostics',file)));
function cli(label,args,success=true){
 const argv=['--sdk',env.sdk,'--project',temp,...args,'--json'];const r=spawnSync(env.binary.path,argv,{cwd:temp,encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:2*1024*1024,env:{...process.env,UNONE_LUAU_ANALYZER:env.analyzer.path}});
 console.log(JSON.stringify({event:'command',label,argv:[env.binary.path,...argv],status:r.status,error:r.error?.message,stdout:r.stdout,stderr:r.stderr}));assert.ok(!r.error);assert.equal(r.status===0,success,label);const v=JSON.parse(r.stdout);assert.equal(v.ok,success);return v.value;
}
const canonical=cli('canonical types',['api','typings']).typings;
const source=await readFile(resolve(temp,'main.luau'),'utf8');const normalize=s=>s.replaceAll('\r\n','\n');assert.ok(normalize(source).includes(normalize(canonical).trimEnd()));
cli('official strict example',['check','--types']);
const result=cli('actual complete packaged example',['run','--frames','3','--seed','42']);const o=result.world.observations;
assert.equal(o.complete,true);assert.equal(o.rejected_input.code,'SPATIAL_INPUT_INVALID');assert.equal(o.rejected_input.path,'queries[1].radius');assert.equal(o.rejected_input.actual,-1);assert.equal(o.rejected_input.recovery.retry,'after_correction');
assert.deepEqual(o.rejected_input.expected,{finite:true,min:0,max:1000000});
assert.deepEqual(o.empty_batch.results,[]);assert.deepEqual(o.result.results[3].hits,[]);assert.deepEqual(o.empty_array,[]);assert.deepEqual(o.plain_object,{});assert.deepEqual(o.numbers,[1,2,3]);
assert.equal(o.profile.bindings.calls,6);assert.equal(o.profile.bindings.failed_calls,1);assert.equal(o.profile.totals.completed_batches,2);
for(const p of ['input_decode_ms','output_encode_ms'])assert.ok(Number.isFinite(o.profile.bindings[p])&&o.profile.bindings[p]>=0);
// Public type negatives preserve the canonical block and alter authored code only.
for(const [label,replacement]of [['typed info field',"info.limits.queries_per_batch = 'wrong'"],['typed diagnostic retry',"local d = api.spatial.lastDiagnostic(); if d then d.recovery.retry = 'tomorrow' end"],['typed bindings sample',"local p = api.spatial.profile(); if p.bindings.last then p.bindings.last.success = 'wrong' end"]]){
 await writeFile(resolve(temp,'main.luau'),source.replace('local capacity: number = info.limits.queries_per_batch',replacement+'\n        local capacity: number = info.limits.queries_per_batch'));
 cli('reject '+label,['check','--types'],false);
}
await writeFile(resolve(temp,'main.luau'),source);
for(const query of ['structured spatial diagnostic','空間查詢 錯誤診斷','spatial profile']){const v=cli('discover '+query,['api','search',query]);assert.ok(v.matches.length>0);}
await identity(env.binary);await identity(env.analyzer);
console.log(JSON.stringify({event:'task_result',complete:true,profile:o.profile,diagnostic:o.rejected_input,temp,scope:'Informed public packaged example and strict positive/negative checks. Fresh author is separate; no rendering, device loss, speedup or general dynamic-key alias type-safety claim.'}));
