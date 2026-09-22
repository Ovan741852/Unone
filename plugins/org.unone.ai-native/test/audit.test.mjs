import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CHECKS, RUN_SCHEMA, template, catalog } from '../src/rubric.mjs';
import { evaluate, compare, validateShape } from '../src/audit.mjs';
import { fingerprint, readProjectFile, sha256 } from '../src/files.mjs';
import { discovery, handle, handleRequest } from '../src/api.mjs';
import { createDiscovery } from '../src/discovery.mjs';
import { contracts } from '../src/contracts.mjs';

const pluginRoot = fileURLToPath(new URL('../',import.meta.url));
const probeRecorder = path.join(pluginRoot,'scripts','record-probe.mjs');
const clone = structuredClone;
const code = expected => error => error.code === expected;
test('discovery exposes CLI recovery and separates bootstrap tools from describable operations',()=>{
  const goals=['Preserve the source version','reproduce selected file checksums'];
  for(const query of goals)assert.ok(discovery.recommend({query}).candidates.some(c=>c.operation==='ai_native.snapshot'));
  for(const id of catalog().tools)assert.ok(discovery.describe(id).standaloneCli.startsWith('node cli.mjs '));
  assert.ok(catalog().bootstrapTools.includes('plugin.test'));
  assert.match(discovery.describe('ai_native.compare').preparation,/ONE selected root/);
  assert.ok(discovery.describe('ai_native.evaluate').runtimeInvariants.some(s=>s.includes('exactly once')));
});
test('new self-assessment requests surface init and explain the read-only report flow',()=>{
  const result=discovery.recommend({query:'評估 Scout 自己的 AI native 可用性，產生有證據的分數'});
  assert.ok(result.candidates.some(c=>c.operation==='ai_native.init'));
  assert.equal(result.candidates[0].operation,'ai_native.init');
  assert.match(result.nextAction,/no file is written/i);
  assert.match(discovery.describe('ai_native.init').summary,/唯讀，不寫檔/);
});
test('English self-audit intent prioritizes init but an existing report still prioritizes evaluate',()=>{
  const fresh=discovery.recommend({query:'Assess Scout itself for AI-native usability and give it an evidence-based score'});
  assert.equal(fresh.candidates[0]?.operation,'ai_native.init');
  const existing=discovery.recommend({query:'Evaluate the completed report for Scout'});
  assert.equal(existing.candidates[0]?.operation,'ai_native.evaluate');
});
test('operation contract versions explain their scope and changed evaluation contracts track the release',()=>{
  const init=discovery.describe('ai_native.init'),evaluate=discovery.describe('ai_native.evaluate');
  assert.equal(init.version,'0.3.0');assert.equal(evaluate.version,'0.3.0');
  assert.match(evaluate.versionScope,/independent of the installed plugin\/package release version/);
  assert.equal(discovery.describe('ai_native.register').version,'0.2.0');
});
test('misspelled operation IDs suggest a concrete repair',()=>{
  assert.throws(()=>discovery.describe('ai_native.evalute'),e=>e.code==='DISCOVERY_OPERATION_UNKNOWN' && /ai_native\.evaluate/.test(e.fix));
});
// Deliberately synthetic capture objects test the validator, not a real product score.
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(),'ai-native-unit-'));
  const source='export const fixture = true;\n';
  const doc='Synthetic test-only capability and error contract.\n';
  const probe='console.log("SYNTHETIC_TEST_PROBE");\n';
  await writeFile(path.join(root,'source.mjs'),source); await writeFile(path.join(root,'README.md'),doc); await writeFile(path.join(root,'probe.mjs'),probe);
  const report=template({id:'synthetic-only',name:'Synthetic validator fixture',surface:'http'});
  Object.assign(report.target,{scope:'Test validator behavior only, not an actual audit',version:'fixture-1',revision:'synthetic-test-not-git',environment:'Node test fixture'});
  report.trial={mode:'blind',entryPoints:['README.md'],steps:5,firstSuccessStep:3,sourceFallbackStep:null,wrongGuesses:0,limitations:['All report answers and the initial capture are synthetic validator fixtures.']};
  report.subject=[{path:'source.mjs',sha256:sha256(source)},{path:'README.md',sha256:sha256(doc)}];
  const run={schema:RUN_SCHEMA,mode:'fixture',limitations:['Synthetic validator fixture, not real execution.'],startedAt:new Date().toISOString(),command:['node','probe.mjs'],node:process.version,platform:process.platform,durationMs:1,exitCode:0,signal:null,timedOut:false,outputTruncated:false,sourceChanged:false,stdout:'SYNTHETIC_TEST_PROBE',stderr:'',subject:report.subject,probe:{path:'probe.mjs',sha256:sha256(probe)}};
  const runText=JSON.stringify(run,null,2);
  await writeFile(path.join(root,'capture.json'),runText);
  report.evidence=[{id:'doc',kind:'document',path:'README.md',sha256:sha256(doc),quote:'Synthetic test-only capability'}, {id:'source',kind:'source',path:'source.mjs',sha256:sha256(source),quote:'export const fixture'}, {id:'run',kind:'execution',path:'capture.json',sha256:sha256(runText),quote:'SYNTHETIC_TEST_PROBE'}];
  report.checks=CHECKS.map(c=>({id:c.id,status:'verified',rating:4,access:'public',answer:`Synthetic affirmative answer for ${c.id}; not product evidence.`,reason:'This is generated solely to exercise validation and score boundaries.',nextAction:'Replace all synthetic evidence with actual observations for a real product audit.',evidence:['doc','run']}));
  return {root,report,run};
}
async function rewriteRun(f,patch) {
  Object.assign(f.run,patch); const raw=JSON.stringify(f.run,null,2); await writeFile(path.join(f.root,'capture.json'),raw); f.report.evidence.find(e=>e.id==='run').sha256=sha256(raw);
}

test('fixed rubric has ten unique questions and weights totaling 100',()=>{
  assert.equal(CHECKS.length,10);assert.equal(new Set(CHECKS.map(c=>c.id)).size,10);assert.equal(CHECKS.reduce((n,c)=>n+c.weight,0),100);
});
test('catalog callers cannot alter internal weights or future audit denominators',async()=>{
  const f=await fixture();f.report.checks.forEach(c=>{c.evidence=['doc'];});
  const before=await evaluate(f.report,f.root), external=catalog();external.checks[0].weight=1000;external.checks[0].runtime=true;external.checks.pop();
  assert.throws(()=>{CHECKS[0].weight=1000;},TypeError);
  const after=await evaluate(f.report,f.root);assert.equal(after.index,before.index);assert.equal(after.coveragePercent,100);assert.equal(catalog().checks[0].weight,10);assert.equal(catalog().checks.length,10);
});
test('complete, internally consistent synthetic evidence can reach the top bound',async()=>{
  const f=await fixture(), r=await evaluate(f.report,f.root);
  assert.equal(r.index,100);assert.equal(r.coveragePercent,100);assert.equal(r.publicExecutionCoveragePercent,100);assert.equal(r.gate,'supported_within_scope');
  assert.equal(r.evidenceIntegrity.semanticClaimsIndependentlyProven,false);
});
test('missing, duplicate and placeholder answers reject instead of returning a score',async()=>{
  const f=await fixture(); let r=clone(f.report);r.checks.pop();assert.throws(()=>validateShape(r),code('AUDIT_INVALID'));
  r=clone(f.report);r.checks[1]=clone(r.checks[0]);assert.throws(()=>validateShape(r),code('AUDIT_INVALID'));
  r=clone(f.report);r.checks[0].answer='TODO';assert.throws(()=>validateShape(r),code('AUDIT_INVALID'));
  r=clone(f.report);r.checks[0].rating=5;assert.throws(()=>validateShape(r),code('AUDIT_INVALID'));
  r=clone(f.report);r.checks[0].status='unverified';assert.throws(()=>validateShape(r),code('AUDIT_INVALID'));
});
test('unknown fields, unresolved references and duplicate issue IDs fail closed',async()=>{
  const f=await fixture();let r=clone(f.report);r.execute='shell';assert.throws(()=>validateShape(r),code('AUDIT_INVALID'));
  r=clone(f.report);r.checks[0].evidence=['fabricated'];assert.throws(()=>validateShape(r),code('AUDIT_INVALID'));
  r=clone(f.report);const issue={id:'same',checkId:'operation',severity:'P1',summary:'Fixture finding',cause:'Fixture cause',fix:'Fixture fix',verification:'Fixture reproduction',evidence:['run']};r.issues=[issue,clone(issue)];assert.throws(()=>validateShape(r),code('AUDIT_INVALID'));
});
test('source, document and source-assisted evidence have deterministic caps',async()=>{
  const f=await fixture();f.report.checks.forEach(c=>{c.evidence=['doc'];});let r=await evaluate(f.report,f.root);
  assert.equal(r.index,35);assert.equal(r.executionCoveragePercent,0);assert.equal(r.gate,'needs_work');
  assert.equal(r.dimensions.find(d=>d.id==='operation').status,'partial');assert.equal(r.dimensions.find(d=>d.id==='operation').claimedStatus,'verified');
  f.report.trial.sourceFallbackStep=2;f.report.checks.forEach(c=>{c.evidence=['run'];c.access='source-assisted';});r=await evaluate(f.report,f.root);
  assert.equal(r.index,50);assert.equal(r.publicExecutionCoveragePercent,0);assert.ok(r.dimensions.every(d=>d.accepted===2));
});
test('unverified is null, never omitted from denominator or marked ready',async()=>{
  const f=await fixture();f.report.checks.forEach(c=>{c.status='unverified';c.rating=null;c.access='none';c.evidence=[];c.answer='No permission to execute this synthetic test scenario.';});
  let r=await evaluate(f.report,f.root);assert.equal(r.index,null);assert.deepEqual(r.possibleRange,[0,100]);assert.equal(r.gate,'insufficient_evidence');
  Object.assign(f.report.checks[0],{status:'verified',rating:3,access:'public',evidence:['doc']});r=await evaluate(f.report,f.root);assert.equal(r.index,7.5);assert.deepEqual(r.possibleRange,[7.5,97.5]);assert.equal(r.coveragePercent,10);
});
test('stale subject and changed evidence reject; exact excerpts are checked',async()=>{
  let f=await fixture();await writeFile(path.join(f.root,'source.mjs'),'changed');await assert.rejects(evaluate(f.report,f.root),code('AUDIT_EVIDENCE_STALE'));
  f=await fixture();await writeFile(path.join(f.root,'capture.json'),'changed');await assert.rejects(evaluate(f.report,f.root),code('AUDIT_EVIDENCE_STALE'));
  f=await fixture();f.report.evidence[0].quote='made-up result';await assert.rejects(evaluate(f.report,f.root),code('AUDIT_QUOTE_NOT_FOUND'));
});
test('a source file cannot be labeled execution, nor can a run from another target',async()=>{
  let f=await fixture();f.report.evidence[1].kind='execution';await assert.rejects(evaluate(f.report,f.root),code('AUDIT_INVALID'));
  f=await fixture();await rewriteRun(f,{subject:[{path:'other.mjs',sha256:'a'.repeat(64)}]});await assert.rejects(evaluate(f.report,f.root),code('AUDIT_RUN_TARGET_MISMATCH'));
  f=await fixture();await writeFile(path.join(f.root,'probe.mjs'),'different probe');await assert.rejects(evaluate(f.report,f.root),code('AUDIT_EVIDENCE_STALE'));
});
test('failure, timeout or truncated execution cannot support a passing claim',async()=>{
  for(const patch of [{exitCode:1},{timedOut:true},{outputTruncated:true}]) {
    const f=await fixture();await rewriteRun(f,patch);const r=await evaluate(f.report,f.root);assert.equal(r.index,25);assert.equal(r.gate,'needs_work');
  }
  const f=await fixture();await rewriteRun(f,{sourceChanged:true});await assert.rejects(evaluate(f.report,f.root),code('AUDIT_INVALID'));
});
test('absolute, traversal, cross-drive and escaping symlink evidence is refused',async()=>{
  const f=await fixture();for(const p of ['../README.md','C:/secrets.txt','/etc/passwd','folder\\file.txt','a/../../README.md']) await assert.rejects(readProjectFile(f.root,p),code('AUDIT_PATH_OUTSIDE_ROOT'));
  const outside=await mkdtemp(path.join(tmpdir(),'ai-native-outside-'));await writeFile(path.join(outside,'private.txt'),'must not be read');
  await symlink(outside,path.join(f.root,'escape'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(readProjectFile(f.root,'escape/private.txt'),code('AUDIT_PATH_OUTSIDE_ROOT'));
});
test('regular-file byte bound, encoding and missing paths have actionable diagnostics',async()=>{
  const f=await fixture();await writeFile(path.join(f.root,'too-big.txt'),'x'.repeat(30));await assert.rejects(readProjectFile(f.root,'too-big.txt',10),code('AUDIT_FILE_LIMIT'));
  await writeFile(path.join(f.root,'invalid.txt'),Buffer.from([0xff]));await assert.rejects(readProjectFile(f.root,'invalid.txt'),code('AUDIT_FILE_UNAVAILABLE'));
  await assert.rejects(readProjectFile(f.root,'missing.txt'),e=>e.code==='AUDIT_FILE_UNAVAILABLE' && e.actual.reason==='ENOENT' && Boolean(e.fix));
});
test('comparison rejects changed scope and preserves unknown deltas',async()=>{
  const f=await fixture();const before=await evaluate(f.report,f.root),after=clone(before);after.target.scope='A different scenario';assert.throws(()=>compare(before,after),code('AUDIT_COMPARISON_MISMATCH'));
  after.target.scope=before.target.scope;after.index=null;after.dimensions[0].accepted=null;const diff=compare(before,after);assert.equal(diff.delta,null);assert.equal(diff.dimensions[0].delta,null);
});
test('recommendation is bounded, relevant, schema-free and truthful about no match',()=>{
  for(const query of ['我要評分 AI native','score this tool','取得版本指紋','建立新評測']) {
    const r=discovery.recommend({query});assert.ok(r.candidates.length>0 && r.candidates.length<=3);assert.ok(r.candidates.every(c=>!('input_schema'in c)&&c.next.tool==='ai_native.describe'));
  }
  const empty=discovery.recommend({query:'pizza teleportation'});assert.deepEqual(empty.candidates,[]);assert.match(empty.nextAction,/No matching/);
  assert.throws(()=>discovery.recommend({query:'score',limit:100}),code('DISCOVERY_LIMIT_INVALID'));
  assert.throws(()=>discovery.recommend({query:'score',execute:true}),code('AUDIT_INVALID'));
});
test('selected contract is isolated, version-bound and independently availability checked',()=>{
  const description=discovery.describe('ai_native.evaluate');description.input_schema.oneOf.push({required:['injected']});assert.equal(discovery.describe(description.id).input_schema.oneOf.length,2);
  assert.throws(()=>discovery.selected(description.id,'stale'),code('DISCOVERY_CONTRACT_STALE'));
  const changed=clone(contracts);changed[0].version='next';const next=createDiscovery(changed);assert.notEqual(next.describe(changed[0].id).contractHash,discovery.describe(changed[0].id).contractHash);
  changed[0].available.status='not_installed';const missing=createDiscovery(changed);const selected=missing.describe(changed[0].id);assert.throws(()=>missing.selected(selected.id,selected.contractHash),code('DISCOVERY_UNAVAILABLE'));
  const recommendation=missing.recommend({query:'catalog'});recommendation.candidates[0].available.status='available';
  assert.equal(missing.describe(selected.id).available.status,'not_installed');assert.throws(()=>missing.selected(selected.id,selected.contractHash),code('DISCOVERY_UNAVAILABLE'));
});
test('selected evaluation describes the complete artifact schema without eager loading it in recommendations',()=>{
  const selected=discovery.describe('ai_native.evaluate');
  assert.deepEqual(selected.reportSchema.properties.checks.items.properties.access.enum,['public','source-assisted','internal','none']);
  assert.deepEqual(selected.reportSchema.properties.checks.items.properties.id.enum,CHECKS.map(c=>c.id));
  assert.equal(selected.reportSchema.properties.checks.minItems,CHECKS.length);
  assert.ok(selected.preparation.some(p=>p.operation==='ai_native.init'));
  assert.ok(!JSON.stringify(discovery.recommend({query:'評分'})).includes('reportSchema'));
});
test('API rejects guessed direct operations, stale contracts and missing inputs with repair details',async()=>{
  const smoke=await handle('plugin.test',{},pluginRoot);assert.equal(smoke.ok,true);assert.ok(smoke.value.checks.includes('in_memory_report_evaluation'));
  let r=await handle('ai_native.evaluate',{},pluginRoot);assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,'PLUGIN_TOOL_NOT_FOUND');
  r=await handle('ai_native.call',{operation:'ai_native.evaluate',contractHash:'bad',arguments:{}},pluginRoot);assert.equal(r.diagnostics[0].code,'DISCOVERY_CONTRACT_STALE');
  const c=discovery.describe('ai_native.evaluate');r=await handle('ai_native.call',{operation:c.id,contractHash:c.contractHash,arguments:{}},pluginRoot);assert.equal(r.diagnostics[0].facts.field,'input.arguments');assert.match(r.diagnostics[0].suggested_actions[0].description,/pass the completed report JSON directly/);assert.equal(r.value,null);
});
test('evaluation accepts an in-memory report without writing a report file',async()=>{
  const f=await fixture(), contract=discovery.describe('ai_native.evaluate');
  assert.deepEqual(contract.input_schema.oneOf,[{required:['report_path'],not:{required:['report']}},{required:['report'],not:{required:['report_path']}}]);
  const result=await handle('ai_native.call',{operation:contract.id,contractHash:contract.contractHash,arguments:{report:f.report}},f.root);
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.index,100);assert.deepEqual(result.effects,[]);
  const both=await handle('ai_native.call',{operation:contract.id,contractHash:contract.contractHash,arguments:{report:f.report,report_path:'audit.json'}},f.root);
  assert.equal(both.ok,false);assert.equal(both.diagnostics[0].facts.field,'input.arguments');
  const neither=await handle('ai_native.call',{operation:contract.id,contractHash:contract.contractHash,arguments:{}},f.root);
  assert.equal(neither.ok,false);assert.match(neither.diagnostics[0].suggested_actions[0].description,/pass the completed report JSON directly/);
});
test('protocol envelope is strict and payload project cannot redirect host root',async()=>{
  const f=await fixture();let r=await handleRequest({tool:'plugin.test',input:{}},f.root);assert.equal(r.ok,false);
  const c=discovery.describe('ai_native.snapshot');const request={protocol:'unone.plugin.v1',action:'call',plugin:'org.unone.ai-native',project:'C:/not-authoritative',tool:'ai_native.call',input:{operation:c.id,contractHash:c.contractHash,arguments:{paths:['README.md']}}};
  r=await handleRequest(request,f.root);assert.equal(r.ok,true);assert.equal(r.value.files[0].sha256,f.report.subject[1].sha256);assert.deepEqual(r.effects,[]);
});
test('real stdio accepts multiple requests, recovers malformed/oversized lines and emits only JSON',()=>{
  const valid=JSON.stringify({protocol:'unone.plugin.v1',action:'call',plugin:'org.unone.ai-native',tool:'plugin.test',input:{}});
  const child=spawnSync(process.execPath,[path.join(pluginRoot,'plugin.mjs')],{input:'bad-json\n'+'x'.repeat(2*1024*1024+1)+'\n'+valid+'\n',encoding:'utf8',timeout:15000,maxBuffer:4*1024*1024,windowsHide:true});
  assert.equal(child.status,0,child.stderr);const lines=child.stdout.trim().split('\n').map(JSON.parse);assert.equal(lines.length,3);assert.equal(lines[0].diagnostics[0].code,'PLUGIN_JSON_INVALID');assert.equal(lines[1].diagnostics[0].code,'PLUGIN_REQUEST_TOO_LARGE');assert.equal(lines[2].ok,true);assert.equal(child.stderr,'');
});
test('real recorder captures an explicit fixture probe; repeat output refuses before another execution',async()=>{
  const f=await fixture();const script='import {appendFileSync} from "node:fs"; appendFileSync("count.txt","x"); console.log("REAL_CAPTURE_SMOKE");';await writeFile(path.join(f.root,'probe.mjs'),script);
  const args=[probeRecorder,'--root',f.root,'--script','probe.mjs','--output','recorded/run.json','--subject','README.md','--subject','source.mjs','--mode','fixture','--limitation','This is a synthetic recorder regression, not product execution.'];
  let child=spawnSync(process.execPath,args,{encoding:'utf8',timeout:15000,windowsHide:true});assert.equal(child.status,0,child.stderr);const run=JSON.parse(await readFile(path.join(f.root,'recorded/run.json'),'utf8'));assert.equal(run.exitCode,0);assert.match(run.stdout,/REAL_CAPTURE_SMOKE/);assert.equal(run.sourceChanged,false);assert.equal(fingerprint(run.subject),fingerprint(f.report.subject));
  child=spawnSync(process.execPath,args,{encoding:'utf8',timeout:15000,windowsHide:true});assert.equal(child.status,2);assert.equal(await readFile(path.join(f.root,'count.txt'),'utf8'),'x');
});
test('real CLI reports invalid report as nonzero and supports the discovery path',async()=>{
  const f=await fixture();await writeFile(path.join(f.root,'audit.json'),JSON.stringify(f.report));
  let child=spawnSync(process.execPath,[path.join(pluginRoot,'cli.mjs'),'evaluate','--root',f.root,'--report','audit.json'],{encoding:'utf8',timeout:15000,windowsHide:true});assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(child.stdout).value.index,100);
  f.report.checks=[];await writeFile(path.join(f.root,'audit.json'),JSON.stringify(f.report));child=spawnSync(process.execPath,[path.join(pluginRoot,'cli.mjs'),'evaluate','--root',f.root,'--report','audit.json'],{encoding:'utf8',timeout:15000,windowsHide:true});assert.equal(child.status,2);assert.equal(JSON.parse(child.stdout).value,null);
});
test('CLI help is discoverable and evaluate accepts JSON from stdin',async()=>{
  const help=spawnSync(process.execPath,[path.join(pluginRoot,'cli.mjs'),'--help'],{encoding:'utf8',timeout:15000,windowsHide:true});
  assert.equal(help.status,0,help.stderr);assert.match(help.stdout,/init returns a JSON template but does not write a file/i);assert.match(help.stdout,/evaluate --report - \(JSON from stdin\)/);
  const f=await fixture();
  const child=spawnSync(process.execPath,[path.join(pluginRoot,'cli.mjs'),'evaluate','--root',f.root,'--report','-'],{input:JSON.stringify(f.report),encoding:'utf8',timeout:15000,windowsHide:true});
  assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(child.stdout).value.index,100);
});
test('recorder preserves execution evidence when a reviewed fixture probe deletes its own synthetic subject',async()=>{
  const f=await fixture();await writeFile(path.join(f.root,'probe.mjs'),'import {unlinkSync} from "node:fs"; unlinkSync("source.mjs"); console.log("SUBJECT_REMOVED_IN_SYNTHETIC_TEST");');
  const child=spawnSync(process.execPath,[probeRecorder,'--root',f.root,'--script','probe.mjs','--output','failure-capture.json','--subject','source.mjs','--mode','fixture','--limitation','Deliberate mutation of this unit test owned subject only.'],{encoding:'utf8',timeout:15000,windowsHide:true});
  assert.equal(child.status,1,child.stderr);const captured=JSON.parse(await readFile(path.join(f.root,'failure-capture.json'),'utf8'));
  assert.equal(captured.exitCode,0);assert.equal(captured.sourceChanged,true);assert.equal(captured.sourceCheckError.code,'AUDIT_FILE_UNAVAILABLE');assert.match(captured.stdout,/SUBJECT_REMOVED_IN_SYNTHETIC_TEST/);
});
