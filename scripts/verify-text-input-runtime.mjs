// Verify reusable text input against the actual emitted official WASM runtime.
// No browser DOM, game-specific save fixture or replacement renderer is used.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash,webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {loadProject,readObservation} from '../web/shared/load-project.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {values}=parseArgs({options:{runtime:{type:'string'},output:{type:'string'}}});
assert(values.runtime,'Usage: node scripts/verify-text-input-runtime.mjs --runtime <runtime-directory> [--output <report.json>]');
const runtimeRoot=resolve(values.runtime),output=resolve(values.output??join(root,'.cache/text-input-v6-runtime-qa.json'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const script=String.raw`
local ui=nil
local draft=''
local count=0
local function publish(api)
 api.ui.setRoot(ui.screen({id='text-demo',node='entry',children={
  ui.textInput({id='entry',text=draft,placeholder='輸入文字',focused=true,max_length=12,
   rect={x=10,y=40,width=80,height=10},style={font_size=3,text_align='start'}})
 }}))
end
return {start=function(api)
 ui=api.ui.components.create()
 publish(api)
end,update=function(api)
 local event=api.input.getTextInputInteraction('entry')
 local again=api.input.getTextInputInteraction('entry')
 assert((event==nil)==(again==nil),'Text input was consumed by a read')
 if event then
  assert(event.phase==again.phase and event.text==again.text and event.composing==again.composing,'Text input reads differ')
  count+=1
  if event.phase=='change' then draft=event.text end
 end
 api.observation.set('event_count',count)
 api.observation.set('event',event and {phase=event.phase,text=event.text,composing=event.composing} or {phase='none',text='',composing=false})
 api.observation.set('read_twice_equal',true)
 publish(api)
end}
`;
const report={schema:'unone.text-input-runtime.qa.v1',ok:false,runtime_root:runtimeRoot,
  scope:'Actual official WASM constructor and successful-tick text events; real OS IME, clipboard and browser rendering require host acceptance.',
  source_sha256:sha(script),checks:[],samples:[]};
const check=(label,value)=>{assert(value,label);report.checks.push(label);};
try{
  const metadataBytes=await readFile(join(runtimeRoot,'runtime.json')),metadata=JSON.parse(metadataBytes);
  const jsPath=join(runtimeRoot,metadata.javascript),wasmPath=join(runtimeRoot,metadata.wasm);
  const [javascript,wasm]=await Promise.all([readFile(jsPath),readFile(wasmPath)]);
  Object.assign(report,{runtime_manifest_sha256:sha(metadataBytes),javascript_sha256:sha(javascript),wasm_sha256:sha(wasm),
    wasm_bytes:wasm.length,compiled_systems:metadata.compiled_systems,runtime_packages:metadata.runtime_packages,preview_tools:metadata.preview_tools});
  check('JavaScript bytes match the selected runtime manifest',sha(javascript)===metadata.javascript_sha256);
  check('WASM bytes match the selected runtime manifest',sha(wasm)===metadata.wasm_sha256);
  const module=await new Promise((ready,reject)=>{
    const options={wasmBinary:new Uint8Array(wasm),noInitialRun:true,onAbort:reason=>reject(Error(String(reason))),print(){},printErr:message=>process.stderr.write(String(message)+'\n')};
    const context={Module:options,crypto:webcrypto,window:{},document:{currentScript:{src:pathToFileURL(jsPath).href}},
      location:{href:pathToFileURL(jsPath).href},console,TextDecoder,TextEncoder,WebAssembly,setTimeout,clearTimeout,performance};
    options.onRuntimeInitialized=()=>ready(context.Module);
    vm.runInNewContext(javascript.toString('utf8'),context,{filename:jsPath});
  });
  const config={name:'Reusable Text Input Runtime QA',runtime_packages:{'@unone/ui':metadata.runtime_packages?.['@unone/ui']??'0.4.0'},systems:{ui:true}};
  report.config=config;
  let state=loadProject(module,{config,script,scene:null},42n);
  const input=(frame={actions:{}})=>{
    const bytes=new TextEncoder().encode(JSON.stringify(frame)),ptr=module._unone_web_alloc(bytes.length);
    module.HEAPU8.set(bytes,ptr);const status=module._unone_web_set_input_frame(ptr,bytes.length);
    assert.equal(status,0,'Actual WASM input frame rejected: '+JSON.stringify(readObservation(module)));
    assert.equal(module._unone_web_tick(),0,'Actual WASM tick failed: '+JSON.stringify(readObservation(module)));
    return state=readObservation(module);
  };
  const node=state.world.ui.children[0];
  check('Official kit.textInput publishes a canonical text_input leaf',node.kind==='text_input'&&node.id==='entry');
  check('Constructor retains Unicode placeholder and max_length',node.placeholder==='輸入文字'&&node.max_length===12);
  check('Actual compiled systems match selected runtime manifest',JSON.stringify([...state.compiled_systems].sort())===JSON.stringify([...metadata.compiled_systems].sort()));
  check('Actual production/development API matches selected runtime variant',Boolean(module._unone_web_developer_request)===Boolean(metadata.preview_tools));
  const cases=[['focus','',false],['change','ㄌㄧㄥ ㄏㄨ',true],['change','令狐沖𠮷',false],['submit','令狐沖𠮷',false],['blur','令狐沖𠮷',false],['cancel','任我行',false]];
  for(const [index,[phase,text,composing]]of cases.entries()){
    input({ui_text_inputs:{entry:{phase,text,composing}}});
    const event=state.world.observations.event;
    check(`${phase} ${index+1}: complete Unicode event and composition flag survive WASM`,event.phase===phase&&event.text===text&&event.composing===composing);
    check(`${phase} ${index+1}: repeated read is non-consuming`,state.world.observations.read_twice_equal===true&&state.world.observations.event_count===index+1);
    report.samples.push({frame:state.world.frame,event,display:state.world.ui.children[0].text});
    input();check(`${phase} ${index+1}: empty next tick clears the event`,state.world.observations.event.phase==='none'&&state.world.observations.event_count===index+1);
  }
  report.final_frame=state.world.frame;report.final_digest=state.observation_digest;report.ok=true;
}catch(error){report.error=String(error?.stack??error);process.exitCode=1;}
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:report.ok,checks:report.checks.length,runtime:runtimeRoot,report:output,wasm_sha256:report.wasm_sha256,error:report.error}));
