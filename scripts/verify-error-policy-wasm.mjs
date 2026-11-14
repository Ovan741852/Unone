// Drive an emitted Web runtime through the official player's own runtime core
// and error-policy modules: a production policy keeps the previous screen and
// keeps ticking, a strict load still fails. No browser, renderer or fake ABI.
//   node scripts/verify-error-policy-wasm.mjs --runtime <player-runtime-dir>
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {instantiateEmittedRuntime} from './immutable-bytes-emitted-runtime.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {values}=parseArgs({options:{runtime:{type:'string'}}});
assert(values.runtime,'usage: node scripts/verify-error-policy-wasm.mjs --runtime <player-runtime-dir>');
const runtimeDir=path.resolve(values.runtime),manifest=JSON.parse(fs.readFileSync(path.join(runtimeDir,'runtime.json'),'utf8'));
assert(manifest.compiled_systems.includes('ui'),'The runtime must compile the ui system');
const {createRuntimeCore}=await import(pathToFileURL(path.join(root,'web/shared/runtime-core.mjs')));
const {playerErrorPolicy,createRecoveryReporter}=await import(pathToFileURL(path.join(root,'web/shared/player-errors.mjs')));

// Frames 3..5 publish five panels against a budget of four nodes; frame 7
// raises once; from frame 10 every update raises.
const script=`
local frame=0
local function screen(count)
    local children={{kind='text',id='label',text='frame '..frame,rect={x=5,y=80,width=90,height=10}}}
    for i=1,count do children[#children+1]={kind='panel',id='panel-'..i,rect={x=5+i*10,y=40,width=8,height=8}} end
    return {kind='screen',id='screen',node='screen',budget={max_nodes=4},children=children}
end
return {start=function(api) api.ui.setRoot(screen(2)) end,update=function(api)
    frame+=1
    api.observation.set('published',api.ui.setRoot(screen((frame>=3 and frame<=5) and 5 or 2)))
    if frame==7 or frame>=10 then error('verify boom at frame '..frame) end
    api.observation.set('completed',frame)
end}`;
// Only UI is required; explicitly disable the remaining defaults so this also
// verifies project-specific lean production runtimes without camera3d.
const payload=policy=>({config:{name:'error-policy-wasm',entry_script:'main.luau',systems:{ui:true,physics2d:false,physics3d:false,camera2d:false,camera3d:false,random:false,save:false,spine:false,effekseer:false,jobs:false,audio:false,particle:false}},
 script,scene:null,viewport_size:[1280,720],viewport_aspect:16/9,...(policy?{error_policy:policy}:{})});
async function runtime(){
 const diagnostics={stderr:[],stderr_overflow:0,aborts:[]};
 const module=await instantiateEmittedRuntime({javascriptFile:path.join(runtimeDir,manifest.javascript),javascript:fs.readFileSync(path.join(runtimeDir,manifest.javascript)),
  wasm:fs.readFileSync(path.join(runtimeDir,manifest.wasm)),timeoutMs:30000,diagnostics});
 return createRuntimeCore(module,{requirePhysicalViewport:false});
}
const labels=world=>world.ui.children.map(node=>node.id);
const report={runtime:{dir:runtimeDir,source_commit:manifest.source_commit,wasm_sha256:manifest.wasm_sha256,preview_tools:manifest.preview_tools}};

// Production: the policy exactly as a production export writes it.
{
 const policy=playerErrorPolicy({error_policy:{ui_capacity:'keep_previous',script_errors:'continue',max_consecutive_script_errors:3}},'');
 const warnings=[],reporter=createRecoveryReporter({target:{dataset:{}},log:{warn:text=>warnings.push(text)},doc:null,now:()=>0});
 const core=await runtime();let snapshot=await core.execute({kind:'load',payload:payload(policy),seed:'42'});
 assert.equal(snapshot.world.recovered_errors,undefined);
 const frames=[];
 for(let tick=1;tick<=11;tick++){
  snapshot=await core.execute({kind:'tick',input:{}});reporter.accept(snapshot.world);
  frames.push({frame:snapshot.world.frame,ui:labels(snapshot.world).length,published:snapshot.world.observations.published,completed:snapshot.world.observations.completed??null,recovered:snapshot.world.recovered_errors??null});
 }
 assert.deepEqual(frames.map(f=>f.frame),[1,2,3,4,5,6,7,8,9,10,11],'every tick produced its frame');
 assert.deepEqual(frames.slice(2,5).map(f=>[f.ui,f.published]),[[3,false],[3,false],[3,false]],'over-budget frames kept the previous three-node screen');
 assert.equal(frames[2].recovered.last_ui_rejection.code,'UI_NODE_LIMIT');assert.equal(frames[2].recovered.last_ui_rejection.node,'panel-4');
 assert.equal(frames[5].published,true);assert.equal(frames[5].recovered.ui_rejections,3);
 assert.equal(frames[6].completed,6,'frame 7 skipped the rest of its update');assert.equal(frames[6].recovered.script_errors,1);
 assert.equal(frames[7].recovered.consecutive_script_errors,0,'frame 8 returned normally');
 assert.equal(frames[10].recovered.consecutive_script_errors,2);
 await assert.rejects(core.execute({kind:'tick',input:{}}),error=>JSON.parse(error.message).diagnostic.code==='SCRIPT_ERROR_LIMIT','the third failing frame in a row stops the run');
 assert.equal(warnings.length,2,'one UI warning and one script warning within the rate limit');
 report.production={policy,frames,warnings};
}
// Strict: what tools, development players and ?unone_errors=strict send (nothing).
{
 assert.equal(playerErrorPolicy({error_policy:{ui_capacity:'keep_previous'}},'?unone_errors=strict'),null);
 const core=await runtime();await core.execute({kind:'load',payload:payload(null),seed:'42'});
 for(let tick=1;tick<=2;tick++)assert.equal((await core.execute({kind:'tick',input:{}})).world.recovered_errors,undefined);
 let failure;await assert.rejects(core.execute({kind:'tick',input:{}}),error=>{failure=JSON.parse(error.message);return true;});
 assert.equal(failure.diagnostic.code,'LUAU_RUNTIME_ERROR');assert.match(failure.diagnostic.explanation,/UI_NODE_LIMIT: path=root\.children\[4\], node="panel-4", used=5, limit=4/);
 report.strict={code:failure.diagnostic.code,explanation:failure.diagnostic.explanation.split('\n')[0]};
}
console.log(JSON.stringify({ok:true,...report},null,1));
