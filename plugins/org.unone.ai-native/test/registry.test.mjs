import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, cp, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CHECKS, RUN_SCHEMA, template } from '../src/rubric.mjs';
import { sha256 } from '../src/files.mjs';
import { register, history, status, REGISTRY } from '../src/registry.mjs';
import { handle, handleRequest, discovery } from '../src/api.mjs';

const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
const code = value => error => error.code === value && Boolean(error.fix);
// Synthetic score fixtures exercise state transitions, not the product's AI-native score.
async function fixture({ unknown = false, failed = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'ai-native-registry-'));
  const files = {
    'plugin.json': JSON.stringify({ id:'org.example.registry-fixture', version:'1.0.0' }),
    'source.mjs': 'export const value = "fixture only";\n',
    'README.md': 'SYNTHETIC_REGISTRY_CONTRACT: This fixture is not a product certification.\n',
    'probe.mjs': 'console.log("SYNTHETIC_REGISTRY_PROBE");\n',
  };
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(root, name), content);
  const report = template({ id:'org.example.registry-fixture', name:'Synthetic registry fixture', surface:'plugin' });
  Object.assign(report.target, { version:'1.0.0', revision:'synthetic-local-fixture', scope:'Registry state-machine regression only', environment:'Synthetic Node fixture; no product or platform certification' });
  report.trial = {mode:'informed',entryPoints:['README.md'],steps:5,firstSuccessStep:2,sourceFallbackStep:null,wrongGuesses:0,limitations:['Generated answers test registry behavior only; not an actual usability assessment.']};
  report.subject = ['plugin.json', 'source.mjs', 'README.md'].map(name => ({path:name,sha256:sha256(files[name])}));
  const run = {schema:RUN_SCHEMA,mode:'fixture',limitations:['Synthetic unit-test capture only.'],startedAt:'2026-09-11T00:00:00.000Z',durationMs:12.5,command:['node','probe.mjs'],node:process.version,platform:process.platform,exitCode:failed?1:0,timedOut:false,outputTruncated:false,sourceChanged:false,stdout:'SYNTHETIC_REGISTRY_PROBE',stderr:'',subject:report.subject,probe:{path:'probe.mjs',sha256:sha256(files['probe.mjs'])}};
  const capture = JSON.stringify(run);
  await writeFile(path.join(root,'capture.json'),capture);
  report.evidence = [{id:'doc',kind:'document',path:'README.md',sha256:sha256(files['README.md']),quote:'SYNTHETIC_REGISTRY_CONTRACT'}, {id:'run',kind:'execution',path:'capture.json',sha256:sha256(capture),quote:'SYNTHETIC_REGISTRY_PROBE'}];
  report.checks = CHECKS.map(c => ({id:c.id,status:unknown?'unverified':'verified',rating:unknown?null:4,access:unknown?'none':'public',answer:`Synthetic answer for ${c.id}, solely validating the registry.`,reason:'Generated validator input; not an assessment of a real tool.',nextAction:'Replace synthetic answers with evidence from a real scoped evaluation.',evidence:unknown?[]:['doc','run']}));
  await writeFile(path.join(root,'audit.json'),JSON.stringify(report));
  return {root,report,run,args:{assessment_id:'fixture-01',report_path:'audit.json',manifest_path:'plugin.json'}};
}
function input(operation, args) { const c=discovery.describe(operation); return {operation,contractHash:c.contractHash,arguments:args}; }
async function check(f, version='1.0.0') { return status(f.root,{assessment_id:f.args.assessment_id,current_version:version}); }
function cli(root, args) {
  const child=spawnSync(process.execPath,[path.join(pluginRoot,'cli.mjs'),...args,'--root',root],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.ok(child.stdout.trim(), child.stderr);
  return {exit:child.status,result:JSON.parse(child.stdout)};
}

test('registry operations are discoverable, side effects/grants and recovery are explicit',()=>{
  for (const [query,id] of [['保存評測','ai_native.register'],['評測紀錄','ai_native.history'],['認證是否通過','ai_native.status']]) {
    const candidate=discovery.recommend({query}).candidates.find(c=>c.operation===id);
    assert.ok(candidate); assert.ok(!('input_schema' in candidate));
    const c=discovery.describe(id); assert.match(c.standaloneCli,/node cli.mjs/); assert.ok(c.errors.length);
  }
  assert.equal(discovery.describe('ai_native.register').readOnly,false);
  assert.equal(discovery.describe('ai_native.history').readOnly,true);
  assert.match(discovery.describe('ai_native.register').preparation,/manifest/);
});
test('registration stores score, scope, evaluator and distinct probe/evaluation times',async()=>{
  const f=await fixture(), receipt=await register(f.root,f.args);
  assert.equal(receipt.historicalScore,100); assert.equal(receipt.created,true);
  assert.equal(receipt.currentChecked,false); assert.equal(receipt.probes[0].startedAt,f.run.startedAt);
  assert.equal(receipt.probes[0].durationMs,12.5);
  assert.ok(Date.parse(receipt.evaluatedAt)>Date.parse(f.run.startedAt));
  assert.equal(receipt.evaluator.version,'0.3.0');
  const current=await check(f); assert.equal(current.state,'verified_within_scope');assert.equal(current.score,100);assert.equal(current.reasons.length,0);
  assert.equal(current.environment,f.report.target.environment);
  const list=await history(f.root,{target_id:f.report.target.id});assert.equal(list.count,1);assert.equal(list.records[0].currentChecked,false);
  assert.equal((await history(f.root,{target_id:'unrelated'})).count,0);
});
test('exact retry preserves original bytes, times and single history entry even after source drift',async()=>{
  const f=await fixture(), first=await register(f.root,f.args);
  const file=path.join(f.root,first.recordPath), bytes=await readFile(file);
  await writeFile(path.join(f.root,'source.mjs'),'changed after registration');
  const second=await register(f.root,f.args);
  assert.equal(second.created,false);assert.equal(second.evaluatedAt,first.evaluatedAt);assert.equal(second.currentChecked,false);
  assert.deepEqual(await readFile(file),bytes);assert.equal((await history(f.root,{target_id:f.report.target.id})).count,1);
  assert.equal((await check(f)).state,'needs_revalidation');
});
test('changed version or selected source clears current score, retaining historical evidence and exact cause',async()=>{
  const f=await fixture();await register(f.root,f.args);
  let r=await check(f,'2.0.0');assert.equal(r.state,'needs_revalidation');assert.equal(r.score,null);assert.equal(r.historicalScore,100);assert.equal(r.reasons[0].code,'AUDIT_VERSION_CHANGED');
  await writeFile(path.join(f.root,'source.mjs'),'new bug without a version bump');
  r=await check(f);assert.equal(r.score,null);assert.equal(r.reasons[0].field,'source.mjs');assert.equal(r.reasons[0].code,'AUDIT_EVIDENCE_STALE');assert.ok(r.reasons[0].fix);
  // This is the negative control: a plain saved evaluation still says 100.
  const record=JSON.parse(await readFile(path.join(f.root,REGISTRY,'fixture-01.json'),'utf8'));
  assert.equal(record.payload.result.index,100);assert.equal(r.score,null);
});
test('manifest drift, evidence loss, changed probe and changed report all require revalidation',async()=>{
  for (const name of ['plugin.json','capture.json','probe.mjs','audit.json']) {
    const f=await fixture();await register(f.root,f.args);
    await unlink(path.join(f.root,name));
    const r=await check(f);assert.equal(r.score,null);assert.equal(r.state,'needs_revalidation');assert.ok(r.reasons.some(d=>d.field===name && d.code==='AUDIT_FILE_UNAVAILABLE'));
  }
});
test('failed and unverified assessments are retained without manufacturing a passing badge',async()=>{
  for (const [options,state,score] of [[{failed:true},'needs_work',25],[{unknown:true},'insufficient_evidence',null]]) {
    const f=await fixture(options);await register(f.root,f.args);const r=await check(f);
    assert.equal(r.state,state);assert.equal(r.score,score);assert.equal(r.reasons.length,0);
  }
});
test('manifest is required for plugins and must match captured subject, identity and version',async()=>{
  const f=await fixture();await assert.rejects(register(f.root,{assessment_id:'missing',report_path:'audit.json'}),code('AUDIT_REGISTRY_MANIFEST_REQUIRED'));
  for (const patch of [{id:'other'},{version:'2.0.0'}]) {
    await writeFile(path.join(f.root,'plugin.json'),JSON.stringify({id:f.report.target.id,version:'1.0.0',...patch}));
    await assert.rejects(register(f.root,f.args),code('AUDIT_REGISTRY_MANIFEST_MISMATCH'));
  }
  assert.equal((await history(f.root,{target_id:f.report.target.id})).count,0);
});
test('invalid or stale report creates no record and does not accept a claimed passing result file',async()=>{
  const f=await fixture();await writeFile(path.join(f.root,'source.mjs'),'drift');
  await assert.rejects(register(f.root,f.args),code('AUDIT_EVIDENCE_STALE'));
  await writeFile(path.join(f.root,'audit.json'),JSON.stringify({index:100,gate:'supported_within_scope'}));
  await assert.rejects(register(f.root,{...f.args,manifest_path:undefined}),code('AUDIT_INVALID'));
  assert.equal((await history(f.root,{target_id:f.report.target.id})).count,0);
});
test('same ID with different report conflicts, but a new ID preserves both declared scopes',async()=>{
  const f=await fixture();await register(f.root,f.args);
  f.report.target.scope='A different synthetic scope, not interchangeable';
  await writeFile(path.join(f.root,'second.json'),JSON.stringify(f.report));
  await assert.rejects(register(f.root,{...f.args,report_path:'second.json'}),code('AUDIT_REGISTRY_ID_CONFLICT'));
  await register(f.root,{...f.args,assessment_id:'fixture-02',report_path:'second.json'});
  const list=await history(f.root,{target_id:f.report.target.id});assert.equal(list.count,2);assert.notEqual(list.records[0].target.scope,list.records[1].target.scope);
});
test('concurrent duplicate registration atomically publishes only one complete receipt',async()=>{
  const f=await fixture(), results=await Promise.all(Array.from({length:5},()=>register(f.root,f.args)));
  assert.equal(results.filter(r=>r.created).length,1);
  assert.equal(new Set(results.map(r=>r.recordedAt)).size,1);
  assert.deepEqual(await readdir(path.join(f.root,REGISTRY)),['fixture-01.json']);
  assert.equal((await check(f)).state,'verified_within_scope');
});
test('checksum corruption fails closed; never return a trusted historical score',async()=>{
  const f=await fixture();await register(f.root,f.args);const name=path.join(f.root,REGISTRY,'fixture-01.json');
  const record=JSON.parse(await readFile(name,'utf8'));record.payload.result.index=99;
  await writeFile(name,JSON.stringify(record));
  await assert.rejects(check(f),code('AUDIT_REGISTRY_CORRUPT'));
  const response=await handle('ai_native.call',input('ai_native.status',{assessment_id:'fixture-01',current_version:'1.0.0'}),f.root);
  assert.equal(response.ok,false);assert.equal(response.value,null);assert.ok(response.diagnostics[0].suggested_actions[0].description);
});
test('registry denies path injection and escaping directory junctions without external writes',async()=>{
  const f=await fixture();
  for (const id of ['../escape','C:/escape','x/y','CON','nul','.hidden']) await assert.rejects(register(f.root,{...f.args,assessment_id:id}),code('AUDIT_REGISTRY_ID_INVALID'));
  await assert.rejects(register(f.root,{...f.args,report_path:'../audit.json'}),code('AUDIT_PATH_OUTSIDE_ROOT'));
  const outside=await mkdtemp(path.join(tmpdir(),'ai-native-registry-outside-'));
  await symlink(outside,path.join(f.root,'.unone'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(register(f.root,f.args),code('AUDIT_REGISTRY_PATH_UNSAFE'));
  assert.deepEqual(await readdir(outside),[]);
});
test('API write authority is host-only, with observable write effects and no retry effects',async()=>{
  const f=await fixture(); const request={protocol:'unone.plugin.v1',action:'call',plugin:'org.unone.ai-native',tool:'ai_native.call',input:input('ai_native.register',f.args)};
  let r=await handleRequest(request,f.root);assert.equal(r.diagnostics[0].code,'AUDIT_REGISTRY_WRITE_DENIED');
  r=await handleRequest({...request,registryWrite:true},f.root);assert.equal(r.ok,false);
  r=await handleRequest(request,f.root,{registryWrite:true});assert.equal(r.ok,true);assert.equal(r.effects.length,1);
  r=await handleRequest(request,f.root,{registryWrite:true});assert.equal(r.value.created,false);assert.deepEqual(r.effects,[]);
});
test('real CLI and stdio run discovery -> register -> status -> stale with host-root isolation',async()=>{
  const f=await fixture();
  const recommend=cli(f.root,['recommend','--query','保存評測']).result;
  const chosen=recommend.value.candidates.find(c=>c.operation==='ai_native.register');assert.ok(chosen);
  const contract=cli(f.root,['describe','--operation',chosen.operation]).result.value;
  const envelope={protocol:'unone.plugin.v1',action:'call',plugin:'org.unone.ai-native',project:'C:/not-authoritative',tool:'ai_native.call',input:{operation:contract.id,contractHash:contract.contractHash,arguments:f.args}};
  const run=grant=>spawnSync(process.execPath,[path.join(pluginRoot,'plugin.mjs')],{input:JSON.stringify(envelope)+'\n',encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,UNONE_PROJECT_ROOT:f.root,UNONE_AI_NATIVE_REGISTRY_WRITE:grant}});
  let child=run('0');assert.equal(JSON.parse(child.stdout).diagnostics[0].code,'AUDIT_REGISTRY_WRITE_DENIED');
  child=run('1');assert.equal(child.status,0);assert.equal(JSON.parse(child.stdout).value.created,true);
  assert.equal(cli(f.root,['status','--assessment','fixture-01','--version','1.0.0']).result.value.state,'verified_within_scope');
  const retry=cli(f.root,['register','--assessment','fixture-01','--report','audit.json','--manifest','plugin.json']);assert.equal(retry.exit,0);assert.equal(retry.result.value.created,false);
  await writeFile(path.join(f.root,'source.mjs'),'deliberate regression');
  const stale=cli(f.root,['status','--assessment','fixture-01','--version','1.0.0']);assert.equal(stale.exit,0);assert.equal(stale.result.value.score,null);assert.equal(stale.result.value.state,'needs_revalidation');
  const denied=cli(f.root,['register','--assessment','new-after-drift','--report','audit.json','--manifest','plugin.json']);assert.equal(denied.exit,2);assert.equal(denied.result.diagnostics[0].code,'AUDIT_EVIDENCE_STALE');
});
test('a missing assessment and an empty registry have explicit non-certified states',async()=>{
  const f=await fixture();assert.equal((await history(f.root,{target_id:f.report.target.id})).count,0);
  await assert.rejects(check(f),code('AUDIT_REGISTRY_NOT_FOUND'));
  assert.deepEqual((await readdir(f.root)).sort(),['README.md','audit.json','capture.json','plugin.json','probe.mjs','source.mjs'].sort());
});
test('upgrading the evaluator invalidates current badge without overwriting prior score',async()=>{
  const f=await fixture();await register(f.root,f.args);
  const copy=await mkdtemp(path.join(tmpdir(),'ai-native-evaluator-copy-'));
  for (const name of ['src','plugin.json','cli.mjs']) await cp(path.join(pluginRoot,name),path.join(copy,name),{recursive:true});
  const manifest=JSON.parse(await readFile(path.join(copy,'plugin.json'),'utf8'));manifest.version='0.2.1-test';
  await writeFile(path.join(copy,'plugin.json'),JSON.stringify(manifest));
  const child=spawnSync(process.execPath,[path.join(copy,'cli.mjs'),'status','--root',f.root,'--assessment','fixture-01','--version','1.0.0'],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(child.status,0,child.stderr);const r=JSON.parse(child.stdout).value;
  assert.equal(r.state,'needs_revalidation');assert.equal(r.score,null);assert.equal(r.historicalScore,100);
  assert.ok(r.reasons.some(d=>d.code==='AUDIT_EVALUATOR_CHANGED'));
});
test('concurrent different reports cannot both acquire the same assessment ID',async()=>{
  const f=await fixture();f.report.target.scope='Second competing synthetic scope';
  await writeFile(path.join(f.root,'second.json'),JSON.stringify(f.report));
  const results=await Promise.allSettled([register(f.root,f.args),register(f.root,{...f.args,report_path:'second.json'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const error=results.find(r=>r.status==='rejected').reason;assert.equal(error.code,'AUDIT_REGISTRY_ID_CONFLICT');
  assert.equal((await history(f.root,{target_id:f.report.target.id})).count,1);
});
