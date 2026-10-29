// Native authoring entry points plus unchanged official WASM export ingestion.
// This is a contract test, not a rendered-pixel or gameplay-acquisition test.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,webcrypto} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),cli=path.join(root,'target/release/game.exe');
const runtime=path.resolve(process.argv[2]??path.join(root,'artifacts/core-sdk/runtimes/web-production-0'));
const evidence=path.resolve(process.argv[3]??path.join(root,'.cache/ui-preview-fixture-review.json'));
await fs.mkdir(path.join(root,'.cache'),{recursive:true});
const project=await fs.mkdtemp(path.join(root,'.cache/ui-preview-fixture-'));
const checks=[],runs=[],report={ok:false,scope:'Actual native CLI/MCP-independent export and unchanged official WASM contracts; no GPU rendering claim',runtime,project,checks,runs};
function check(value,label){assert.ok(value,label);checks.push(label);}
function invoke(args,success=true){const run=spawnSync(cli,['--project',project,'--json',...args],{cwd:root,encoding:'utf8'});
 const value=JSON.parse(run.stdout);runs.push({args,status:run.status,value,stderr:run.stderr});assert.equal(run.status===0,success,JSON.stringify(value));return value;}
try{
 await fs.mkdir(path.join(project,'fixtures'));
 const relative='fixtures/門派 saved state.json';
 const script=`return {start=function(api)
 local saved=api.save.get();local name=if saved then saved.screen else 'fresh'
 api.observation.set('restoredInStart',saved or false)
 api.ui.setRoot({kind='screen',id=name,node='fixture',children={{kind='text',id=name..'-title',text=name,rect={x=10,y=70,width=60,height=10}}}})
 end,update=function()end}`;
 const config={name:'UI save fixture contract',entry_script:'main.luau',systems:{physics2d:false,physics3d:false,spine:false,effekseer:false,jobs:false},
  verify:{steps:['layout']},ui_previews:[{name:'saved',frames:1,seed:42,save_fixture:relative}]};
 await fs.writeFile(path.join(project,'main.luau'),script);
 await fs.writeFile(path.join(project,'project.unone.json'),JSON.stringify(config));
 await fs.writeFile(path.join(project,relative),JSON.stringify({screen:'workshop',private_marker:'QA_PRIVATE_FIXTURE_BYTES'}));
 const fresh=invoke(['ui','preview','--strict']);check(fresh.value.screen==='fresh','Native CLI omission preserves fresh-start UI');
 const restored=invoke(['ui','preview','--strict','--save-fixture',relative]);check(restored.value.screen==='workshop','Native CLI restores a Unicode/space fixture before Game.start');
 const bad=invoke(['ui','preview','--save-fixture','../escape.json'],false);
 check(bad.diagnostics[0].code==='UI_SAVE_FIXTURE_PATH_INVALID','Native CLI rejects a root escape through the shared helper');
 const verify=invoke(['verify']);check(verify.value.steps[0].summary.includes('workshop-title'),'Native verify uses the declared saved screen');
 const output=path.join(project,'export');invoke(['export','web','--runtime',runtime,'--output',output]);
 const payload=JSON.parse(await fs.readFile(path.join(output,'content/project.json'),'utf8'));
 check(!('save_fixture' in payload.config.ui_previews[0]),'Actual production export omits the QA-only metadata');
 const copied=await fs.readdir(path.join(output,'content'),{recursive:true});
 check(!copied.some(p=>String(p).includes('saved state')),'Actual production export does not collect the fixture file');
 check(!JSON.stringify(payload).includes('QA_PRIVATE_FIXTURE_BYTES')&&!JSON.stringify(payload).includes(relative),'Actual export contains neither private fixture bytes nor its filename');
 const [loader,wasm]=await Promise.all([fs.readFile(runtime+'/unone-player.js','utf8'),fs.readFile(runtime+'/unone_player.wasm')]);
 report.unchangedWasmSha256=createHash('sha256').update(wasm).digest('hex');
 let engine;await new Promise((resolve,reject)=>{const context=vm.createContext({console,TextEncoder,TextDecoder,URL,setTimeout,clearTimeout,performance,crypto:webcrypto,
  window:{},document:{currentScript:{src:'file:///unone-player.js'}},Module:{noInitialRun:true,wasmBinary:wasm,print(){},printErr:console.error,
  onRuntimeInitialized(){engine=context.Module;resolve();},onAbort:reject}});vm.runInContext(loader,context);});
 const enc=new TextEncoder(),dec=new TextDecoder();
 const snapshot=()=>JSON.parse(dec.decode(engine.HEAPU8.slice(engine._unone_web_observation_ptr(),engine._unone_web_observation_ptr()+engine._unone_web_observation_len())));
 function send(name,value,...rest){const b=enc.encode(JSON.stringify(value)),p=engine._unone_web_alloc(b.length);engine.HEAPU8.set(b,p);return engine[name](p,b.length,...rest);}
 check(send('_unone_web_load_project',payload,42n)===0,'Unchanged official WASM accepts the actual newly exported project payload');
 check(snapshot().world.observations.restoredInStart===false&&snapshot().world.ui.id==='fresh','Exported player starts fresh and has no fixture-restored state');
 send('_unone_web_set_input_frame',{actions:{}});check(engine._unone_web_tick()===0,'Unchanged WASM advances the exported project normally');
 const negative=structuredClone(payload);negative.config.ui_previews[0].save_fixture=relative;
 check(send('_unone_web_load_project',negative,42n)!==0,'Negative control: the unchanged old WASM would reject leaked save_fixture metadata');
 report.negativeControl=snapshot();
 check(report.negativeControl.diagnostic?.explanation.includes('unknown field `save_fixture`'),'Negative control fails specifically on the leaked fixture field');
 report.ok=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
report.completed=report.ok;report.passed=checks.length;report.inputs={};
report.cliSha256=createHash('sha256').update(await fs.readFile(cli)).digest('hex');
report.testScriptSha256=createHash('sha256').update(await fs.readFile(import.meta.filename)).digest('hex');
for(const file of ['crates/unone-engine/src/project.rs','crates/unone-engine/src/ui_preview_fixture.rs','crates/unone-engine/src/verify.rs',
 'crates/unone-cli/src/main.rs','crates/unone-cli/src/mcp.rs','docs/project.schema.json','docs/host-project.schema.json'])
 report.inputs[file]=createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex');
await fs.mkdir(path.dirname(evidence),{recursive:true});await fs.writeFile(evidence,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:report.ok,passed:checks.length,evidence,error:report.error}));
