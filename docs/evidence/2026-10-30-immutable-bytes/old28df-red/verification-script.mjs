// Private negative control against the frozen pre-span emitted WASM.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash, webcrypto} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {loadProject, releaseObservationResources} from '../web/shared/load-project.js';
const root='D:/Projects/Unone', runtime=path.join(root,'artifacts/player-runtime-bytes');
const out=path.join(root,'.cache/immutable-bytes-old28df-red-run1');
assert(!fs.existsSync(out),'Preserve existing evidence');fs.mkdirSync(out);
const sha=x=>createHash('sha256').update(x).digest('hex');
const pins={manifest:'e921142ebd7346a254d7cc3223c25990817148663947ac0eb603393e8bec714e',javascript:'6aa82c299556f3bc4fe00653744d8010de11cc03d414819faa5f547ea3735ece',wasm:'28df55e68e5716bbde46df97fd96c70129f50842f7da5f9fa65c58eaf02a1ba6'};
const metadataBytes=fs.readFileSync(path.join(runtime,'runtime.json')),metadata=JSON.parse(metadataBytes);
const javascriptFile=path.join(runtime,metadata.javascript),wasmFile=path.join(runtime,metadata.wasm);
const javascript=fs.readFileSync(javascriptFile),wasm=fs.readFileSync(wasmFile);
assert.equal(sha(metadataBytes),pins.manifest);assert.equal(sha(javascript),pins.javascript);assert.equal(sha(wasm),pins.wasm);
const report={schema:'unone.immutable-bytes.old-wasm-red.v1',ok:false,red_reproduced:false,
 contract_source_commit:'1f1219821a0bbe05b876ee3c2fe0b82485ff1b1a',runtime,pins,runtime_build_metadata:metadata,
 loader_sha256:sha(fs.readFileSync(path.join(root,'web/shared/load-project.js'))),cases:[],stderr:[],aborts:[],cleanup:null,
 scope:'Actual frozen pre-span WASM negative control, no new implementation pass, benchmark, browser or Game change'};
fs.copyFileSync(import.meta.filename,path.join(out,'verification-script.mjs'));fs.writeFileSync(path.join(out,'runtime.json'),metadataBytes);
let module;
function load(name,source){fs.writeFileSync(path.join(out,`${name}.luau`),source);report.cases.push({name,source_sha256:sha(source)});return loadProject(module,{config:{name:'Immutable bytes old runtime RED',entry_script:`${name}.luau`},script:source,scene:null},42n);}
try{
 module=await new Promise((resolve,reject)=>{const options={wasmBinary:new Uint8Array(wasm),noInitialRun:true,print(){},printErr:x=>report.stderr.push(String(x)),onAbort:x=>{report.aborts.push(String(x));reject(Error(String(x)));}};const scope={Module:options,crypto:webcrypto,window:{},document:{currentScript:{src:pathToFileURL(javascriptFile).href}},location:{href:pathToFileURL(javascriptFile).href},console,TextDecoder,TextEncoder,WebAssembly,setTimeout,clearTimeout,performance};options.onRuntimeInitialized=()=>resolve(scope.Module);vm.runInNewContext(javascript.toString('utf8'),scope,{filename:javascriptFile});});
 try{
  load('span-missing',`return {start=function(api) assert(type(api.bytes.span)=='function','BYTES_SPAN_EXPECTED: api.bytes.span is missing from the old Core') end,update=function()end}`);
  throw Error('Old runtime unexpectedly implemented span');
 }catch(error){assert(String(error).includes('BYTES_SPAN_EXPECTED'),'Unexpected failure instead of absent span');report.cases.at(-1).expected_contract_pass=false;report.cases.at(-1).failure=String(error);report.cases.at(-1).core_error=error.result??null;}
 const state=load('numeric-ranges',`return {start=function(api)
 local b=buffer.create(8)
 local cases={
  {'offset-2pow32',4294967296,1}, {'length-2pow32',0,4294967296},
  {'offset-2pow32-plus1',4294967297,1}, {'length-fraction',0,1.5},
  {'offset-fraction',1.5,1}, {'numeric-string','0',1},
 }
 local result={}
 for _,case in cases do
  local ok,value=pcall(api.bytes.snapshot,b,case[2],case[3])
  result[case[1]]={accepted=ok,output_length=if ok then buffer.len(value) else -1,error=if ok then '' else tostring(value)}
 end
 api.observation.set('range_results',result)
 end,update=function()end}`);
 report.cases.at(-1).observation_digest=state.observation_digest;
 report.cases.at(-1).results=state.world.observations.range_results;
 const accepted=Object.entries(report.cases.at(-1).results).filter(([,v])=>v.accepted).map(([k])=>k);
 report.accepted_invalid_arguments=accepted;
 report.overflow_red_reproduced=accepted.some(x=>x.includes('2pow32'));
 report.strict_number_red_reproduced=accepted.length>0;
 report.cases.at(-1).expected_contract_pass=accepted.length===0;
 assert(report.overflow_red_reproduced,'No overflow RED reproduced; preserve raw and investigate, do not relabel');
 report.red_reproduced=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{
 if(module){try{const status=module._unone_web_unload_project();releaseObservationResources(module);report.cleanup={unload_status:status,publication_bytes:module._unone_web_observation_len(),decoder_released:true};assert.equal(status,0);assert.equal(report.cleanup.publication_bytes,0);}catch(error){report.cleanup_error=String(error.stack??error);process.exitCode=1;}}
 report.ok=report.red_reproduced&&!process.exitCode&&report.aborts.length===0;
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({ok:report.ok,red_reproduced:report.red_reproduced,overflow_red_reproduced:report.overflow_red_reproduced,accepted_invalid_arguments:report.accepted_invalid_arguments,cleanup:report.cleanup,report:path.join(out,'report.json'),error:report.error}));
}
