import {readFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {assembleProject} from '../web/shared/load-project.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {values}=parseArgs({options:{cli:{type:'string'},wasm:{type:'string'},'wasm-binary':{type:'string'},fixture:{type:'string'},export:{type:'string'},'exercise-tools':{type:'boolean',default:false}}});
const cli=resolve(values.cli??join(root,'target/debug/game.exe'));
const exported=values.export?resolve(values.export):null;
const runtime=exported?JSON.parse(readFileSync(join(exported,'runtime/runtime.json'),'utf8')):null;
const js=exported?join(exported,'runtime',runtime.javascript):resolve(values.wasm??join(root,'target/wasm32-unknown-emscripten/debug/deps/unone_web_live_smoke.js'));
const {loadProject,readObservation}=await import(pathToFileURL(join(exported??root,'web/shared/load-project.js')).href);
const fixture=resolve(values.fixture??join(root,'tests/host-parity-project'));
const config=JSON.parse(readFileSync(join(fixture,'project.unone.json'),'utf8'));
const native=spawnSync(cli,['--project',fixture,'test','--json'],{encoding:'utf8',maxBuffer:16*1024*1024});
if(native.status!==0)throw new Error(`CLI_PARITY_FAILED: ${native.stdout}\n${native.stderr}`);
const cases=JSON.parse(native.stdout).value.cases;
// Execute the actual emitted JavaScript and WASM. A minimal Web environment
// permits both the Web-only release build and the developer Emscripten build.
const module=await new Promise((resolveReady,reject)=>{
  const options={wasmBinary:new Uint8Array(readFileSync(exported?join(exported,'runtime',runtime.wasm):(values['wasm-binary']??js.replace(/\.js$/,'.wasm')))),noInitialRun:true,onAbort:reason=>reject(new Error(String(reason))),print:()=>{},printErr:message=>process.stderr.write(String(message)+'\n')};
  const context={Module:options,crypto:webcrypto,window:{},document:{currentScript:{src:pathToFileURL(js).href}},location:{href:pathToFileURL(js).href},console,TextDecoder,TextEncoder,WebAssembly,setTimeout,clearTimeout,performance};
  options.onRuntimeInitialized=()=>resolveReady(context.Module);
  vm.runInNewContext(readFileSync(js,'utf8'),context,{filename:js});
});
const payload=exported?JSON.parse(readFileSync(join(exported,'content/project.json'),'utf8')):await assembleProject(config,async path=>readFileSync(join(fixture,path),'utf8'),async path=>JSON.parse(readFileSync(join(fixture,path),'utf8')));
let compared=0;
function replay(data,spec){
  let result=loadProject(module,{...data,restored_save:spec.load_save??null},BigInt(spec.seed??42));
  for(let frame=0;frame<(spec.frames??60);frame++){
    const bytes=new TextEncoder().encode(JSON.stringify(spec.input_sequence?.length?(spec.input_sequence[frame]??{actions:{}}):{actions:spec.input??{}}));
    const address=module._unone_web_alloc(bytes.length);module.HEAPU8.set(bytes,address);
    if(module._unone_web_set_input_frame(address,bytes.length)!==0 || module._unone_web_tick()!==0)throw new Error(`WASM_PARITY_TICK_FAILED frame=${frame+1}: ${JSON.stringify(readObservation(module))}`);
    result=readObservation(module);
  }
  return result;
}
for(let i=0;i<config.test_files.length;i++){
  const spec=JSON.parse(readFileSync(join(fixture,config.test_files[i]),'utf8'));
  const result=replay(payload,spec);
  if(result.observation_digest!==cases[i].observation_digest)throw new Error(`HOST_PARITY_MISMATCH frame=${spec.frames}: CLI=${cases[i].observation_digest} WASM=${result.observation_digest}. Rebuild both artifacts and inspect the shared host payload.`);
  compared++;
}
// Artifact variant isolation is checked against the actual loaded module.
if(exported && Boolean(module._unone_web_developer_request)!==Boolean(runtime.preview_tools))throw new Error('PLAYER_VARIANT_MISMATCH: development API export does not match manifest');
if(values['exercise-tools']) {
  if(!runtime?.preview_tools)throw new Error('Development runtime required for tool acceptance');
  function command(request){
    const bytes=new TextEncoder().encode(JSON.stringify(request));const ptr=module._unone_web_alloc(bytes.length);module.HEAPU8.set(bytes,ptr);
    module._unone_web_developer_request(ptr,bytes.length);return readObservation(module);
  }
  const snapshot=command({method:'snapshot'});if(!snapshot.ok)throw new Error(JSON.stringify(snapshot));
  const revision=snapshot.value.tools.revision,frame=snapshot.value.observation.world.frame;
  for(const request of [{method:'snapshot',typo:true},{method:'invoke',id:'missing',revision},{method:'invoke',id:'fixture.bump',revision:revision+1},{method:'invoke',id:'fixture.flag',revision}]) {
    if(command(request).ok)throw new Error('Invalid development request accepted: '+JSON.stringify(request));
  }
  const button=command({method:'invoke',id:'fixture.bump',revision});
  if(!button.ok||button.value.observation.world.observations.debug_bump!==1||button.value.observation.world.frame!==frame)throw new Error('Button callback did not run correctly between ticks');
  if(!button.value.tools.controls.some(c=>c.id==='fixture.status'&&c.text==='invoked'))throw new Error('Lua label update did not reach host');
  const checkbox=command({method:'invoke',id:'fixture.flag',revision,value:true});
  if(!checkbox.ok||checkbox.value.observation.world.observations.debug_flag!==true)throw new Error('Checkbox callback did not receive boolean');
  console.log(JSON.stringify({ok:true,exported_lua_tools_verified:true,invalid_requests_rejected:true,callback_did_not_advance_frame:true}));
}
// A negative control proves this gate detects the earlier audio omission class.
let detectsAudioOmission=null;
if(config.audio){
const missingAudio=structuredClone(payload);delete missingAudio.config.audio;
const initial=JSON.parse(readFileSync(join(fixture,config.test_files[0]),'utf8'));
detectsAudioOmission=false;
try{detectsAudioOmission=replay(missingAudio,initial).observation_digest!==cases[0].observation_digest;}catch(error){if(!String(error).includes('HOST_PROJECT_REJECTED'))throw error;detectsAudioOmission=true;}
if(!detectsAudioOmission)throw new Error('PARITY_FIXTURE_INEFFECTIVE: omitting audio did not change the observation');
}
console.log(JSON.stringify({ok:true,mode:exported?'exported-player':'assembled-host',export:exported,cli,wasm:js,compared_frames:compared,audio_omission_detected:detectsAudioOmission}));
