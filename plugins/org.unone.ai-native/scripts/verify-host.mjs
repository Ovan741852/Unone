// Real, read-only Unone CLI transport smoke. No compiler, provider or network.
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { contracts } from '../src/contracts.mjs';
import { template } from '../src/rubric.mjs';
import { sha256 } from '../src/files.mjs';

const args=process.argv.slice(2);
assert.ok([4,6].includes(args.length),'Usage: node scripts/verify-host.mjs --host <game binary> --project <existing project> [--report <relative audit.json>]');
assert.equal(args[0],'--host');assert.equal(args[2],'--project');
if(args.length===6)assert.equal(args[4],'--report');
const pluginRoot=fileURLToPath(new URL('../',import.meta.url));
const scratch=await mkdtemp(path.join(tmpdir(),'unone-ai-native-host-smoke-'));
let requests=0;
async function host(command,tool,input) {
  const argv=['--project',path.resolve(args[3]),'--json','plugin',command,'--id','org.unone.ai-native'];
  if(tool) { const file=path.join(scratch,`request-${++requests}.json`);await writeFile(file,JSON.stringify(input));argv.push('--tool',tool,'--input',file); }
  const child=spawnSync(path.resolve(args[1]),argv,{encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024,windowsHide:true,shell:false,env:{...process.env,UNONE_AI_NATIVE_REGISTRY_WRITE:'0',UNONE_PLUGIN_PATHS:path.dirname(pluginRoot.endsWith(path.sep)?pluginRoot.slice(0,-1):pluginRoot)}});
  assert.ok(child.stdout?.trim(),child.stderr || child.error?.message);
  const result=JSON.parse(child.stdout);return result;
}
const inspect=await host('inspect');assert.equal(inspect.ok,true);assert.equal(inspect.value.manifest.tools.length,4);
const test=await host('test');assert.equal(test.ok,true);
const recommendation=await host('call','ai_native.recommend',{query:'我要評估 checklist 與評分'});assert.equal(recommendation.ok,true);assert.ok(recommendation.value.candidates.length);
const description=await host('call','ai_native.describe',{operation:'ai_native.catalog'});assert.equal(description.ok,true);
const stale=await host('call','ai_native.call',{operation:'ai_native.catalog',contractHash:'stale',arguments:{}});assert.equal(stale.ok,false);assert.equal(stale.diagnostics[0].code,'DISCOVERY_CONTRACT_STALE');
assert.ok(stale.diagnostics[0].suggested_actions[0].description);
const actual=await host('call','ai_native.call',{operation:'ai_native.catalog',contractHash:description.value.contractHash,arguments:{}});assert.equal(actual.ok,true);assert.equal(actual.value.checks.length,10);
const evaluateContract=await host('call','ai_native.describe',{operation:'ai_native.evaluate'});assert.equal(evaluateContract.ok,true);
const manifestPath='plugins/org.unone.ai-native/plugin.json', manifestText=await readFile(path.join(path.resolve(args[3]),manifestPath),'utf8'), manifestHash=sha256(manifestText);
const memoryReport=template({id:'org.unone.ai-native',name:'Unone AI-native Audit',surface:'plugin'});
Object.assign(memoryReport.target,{scope:'Actual Unone host transport only; not a completed self-score',version:'0.3.0',revision:'host-smoke',environment:'Local Windows Unone CLI'});
memoryReport.trial={mode:'informed',entryPoints:['Actual Unone CLI plugin call'],steps:1,firstSuccessStep:1,sourceFallbackStep:null,wrongGuesses:0,limitations:['Host contract transport smoke only; intentionally no semantic self-audit or score claim.']};
memoryReport.subject=[{path:manifestPath,sha256:manifestHash}];
memoryReport.evidence=[{id:'manifest',kind:'document',path:manifestPath,sha256:manifestHash,quote:'"id": "org.unone.ai-native"'}];
memoryReport.checks=memoryReport.checks.map(check=>({...check,answer:'This host transport smoke intentionally does not assess this criterion.',reason:'Only the in-memory report transport and read-only evaluator contract are under test.',nextAction:'Run the separately scoped full Scout self-audit.',evidence:[]}));
const memoryEvaluation=await host('call','ai_native.call',{operation:'ai_native.evaluate',contractHash:evaluateContract.value.contractHash,arguments:{report:memoryReport}});
assert.equal(memoryEvaluation.ok,true,JSON.stringify(memoryEvaluation.diagnostics));assert.equal(memoryEvaluation.value.index,null);assert.equal(memoryEvaluation.value.gate,'insufficient_evidence');
const historyContract=await host('call','ai_native.describe',{operation:'ai_native.history'});assert.equal(historyContract.ok,true);
const history=await host('call','ai_native.call',{operation:'ai_native.history',contractHash:historyContract.value.contractHash,arguments:{target_id:'__host_smoke_absent_target__'}});assert.equal(history.ok,true);assert.equal(history.value.count,0);
const registerContract=await host('call','ai_native.describe',{operation:'ai_native.register'});assert.equal(registerContract.value.readOnly,false);
const denied=await host('call','ai_native.call',{operation:'ai_native.register',contractHash:registerContract.value.contractHash,arguments:{assessment_id:'host-smoke-must-not-write',report_path:'not-read-without-authority.json'}});assert.equal(denied.ok,false);assert.equal(denied.diagnostics[0].code,'AUDIT_REGISTRY_WRITE_DENIED');
let audit=null;
if(args.length===6){
  const contract=await host('call','ai_native.describe',{operation:'ai_native.evaluate'});assert.equal(contract.ok,true);
  const evaluation=await host('call','ai_native.call',{operation:contract.value.id,contractHash:contract.value.contractHash,arguments:{report_path:args[5]}});assert.equal(evaluation.ok,true,JSON.stringify(evaluation.diagnostics));
  audit={id:evaluation.value.target.id,index:evaluation.value.index,gate:evaluation.value.gate,coveragePercent:evaluation.value.coveragePercent};
}
process.stdout.write(JSON.stringify({marker:'UNONE_AI_NATIVE_HOST_SMOKE_OK',transport:'Actual existing Unone CLI → plugin process',pluginVersion:inspect.value.manifest.version,bootstrapTools:inspect.value.manifest.tools.length,recommendationBytes:Buffer.byteLength(JSON.stringify(recommendation.value)),allOperationContractBytes:Buffer.byteLength(JSON.stringify(contracts)),staleRejectedAndRepaired:true,historyRead:true,registryWriteDenied:true,inMemoryReportAccepted:memoryEvaluation.ok && memoryEvaluation.value.index===null && memoryEvaluation.value.gate==='insufficient_evidence',checks:actual.value.checks.length,audit,limits:'Payload bytes, not model token counts. Local Windows CLI smoke; no real AI, GUI, network or cross-device test.'},null,2)+'\n');
