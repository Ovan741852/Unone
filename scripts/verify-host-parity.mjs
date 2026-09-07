import {readFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {assembleProject,loadProject,readObservation} from '../web/shared/load-project.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {values}=parseArgs({options:{cli:{type:'string'},wasm:{type:'string'},'wasm-binary':{type:'string'},fixture:{type:'string'}}});
const cli=resolve(values.cli??join(root,'target/debug/game.exe'));
const js=resolve(values.wasm??join(root,'target/wasm32-unknown-emscripten/debug/deps/unone_web_live_smoke.js'));
const fixture=resolve(values.fixture??join(root,'tests/host-parity-project'));
const config=JSON.parse(readFileSync(join(fixture,'project.unone.json'),'utf8'));
const native=spawnSync(cli,['--project',fixture,'test','--json'],{encoding:'utf8',maxBuffer:16*1024*1024});
if(native.status!==0)throw new Error(`CLI_PARITY_FAILED: ${native.stdout}\n${native.stderr}`);
const cases=JSON.parse(native.stdout).value.cases;
// Execute the actual emitted JavaScript and WASM. A minimal Web environment
// permits both the Web-only release build and the developer Emscripten build.
const module=await new Promise((resolveReady,reject)=>{
  const options={wasmBinary:new Uint8Array(readFileSync(values['wasm-binary']??js.replace(/\.js$/,'.wasm'))),noInitialRun:true,onAbort:reason=>reject(new Error(String(reason))),print:()=>{},printErr:message=>process.stderr.write(String(message)+'\n')};
  const context={Module:options,crypto:webcrypto,window:{},document:{currentScript:{src:pathToFileURL(js).href}},location:{href:pathToFileURL(js).href},console,TextDecoder,TextEncoder,WebAssembly,setTimeout,clearTimeout,performance};
  options.onRuntimeInitialized=()=>resolveReady(context.Module);
  vm.runInNewContext(readFileSync(js,'utf8'),context,{filename:js});
});
const payload=await assembleProject(config,async path=>readFileSync(join(fixture,path),'utf8'),async path=>JSON.parse(readFileSync(join(fixture,path),'utf8')));
let compared=0;
function replay(data,spec){
  let result=loadProject(module,{...data,restored_save:spec.load_save??null},BigInt(spec.seed??42));
  for(let frame=0;frame<spec.frames;frame++){
    const bytes=new TextEncoder().encode(JSON.stringify(spec.input_sequence[frame]??{actions:{}}));
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
// A negative control proves this gate detects the earlier audio omission class.
const missingAudio=structuredClone(payload);delete missingAudio.config.audio;
const initial=JSON.parse(readFileSync(join(fixture,config.test_files[0]),'utf8'));
let detectsAudioOmission=false;
try{detectsAudioOmission=replay(missingAudio,initial).observation_digest!==cases[0].observation_digest;}catch(error){if(!String(error).includes('HOST_PROJECT_REJECTED'))throw error;detectsAudioOmission=true;}
if(!detectsAudioOmission)throw new Error('PARITY_FIXTURE_INEFFECTIVE: omitting audio did not change the observation');
console.log(JSON.stringify({ok:true,cli,wasm:js,compared_frames:compared,audio_omission_detected:true}));
