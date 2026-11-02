// Executes only the explicitly pinned emitted engine and its Luau sandbox.
// No renderer, browser, native CLI, import pipeline or authoring JS is executed.
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {parentPort,workerData} from 'node:worker_threads';
import {encodeJson} from './web-export-files.mjs';
async function validate(){
 const {javascript,wasm,expected,payload,data}=workerData,diagnostics=[];let module;
 try{
  const js=fs.readFileSync(javascript),binary=fs.readFileSync(wasm),hash=b=>createHash('sha256').update(b).digest('hex');
  if(hash(js)!==expected.javascript||hash(binary)!==expected.wasm)throw Error('WEB_REFRESH_RUNTIME_CHANGED_BEFORE_EXECUTION');
  module=await new Promise((resolve,reject)=>{const options={wasmBinary:new Uint8Array(binary),noInitialRun:true,print(){},printErr(value){if(diagnostics.length<32)diagnostics.push(String(value).slice(0,4096));},onAbort(value){reject(Error('WASM_ABORT: '+value));}};const context={Module:options,crypto:webcrypto,window:{},document:{currentScript:{src:pathToFileURL(javascript).href}},location:{href:pathToFileURL(javascript).href},console,TextDecoder,TextEncoder,WebAssembly,setTimeout,clearTimeout,performance};options.onRuntimeInitialized=()=>resolve(context.Module);vm.runInNewContext(new TextDecoder('utf-8',{fatal:true}).decode(js),context,{filename:javascript,timeout:30000});});
  const encode=new TextEncoder(),read=()=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(module.HEAPU8.subarray(module._unone_web_observation_ptr(),module._unone_web_observation_ptr()+module._unone_web_observation_len())));
  for(const row of data){const name=encode.encode(row.id),bytes=fs.readFileSync(row.source);module.HEAPU8.set(name,module._unone_web_alloc(name.length));const ptr=module._unone_web_stage_data(name.length,bytes.length);if(!ptr)throw Error('DATA_ASSET_STAGE_FAILED: '+JSON.stringify(read()));module.HEAPU8.set(bytes,ptr);}
  const source=encodeJson(payload),ptr=module._unone_web_alloc(source.length);module.HEAPU8.set(source,ptr);const status=module._unone_web_load_project(ptr,source.length,42n),value=read();if(status!==0)throw Error('HOST_PROJECT_REJECTED: '+JSON.stringify(value));
  if(!value?.world)throw Error('WEB_REFRESH_CORE_VALIDATION_NO_WORLD');
  if(diagnostics.length)throw Error('WEB_REFRESH_CORE_STDERR: '+JSON.stringify(diagnostics));
  return{status:'passed',scope:'Actual pinned production WASM HostProject ABI parse, source/module compilation, data staging and Game.start; raw validation envelope only, no UI/presentation transport decoding, gameplay ticks or renderer',seed:42,initial_frame:value.world.frame,initial_digest:value.observation_digest??value.digest??null,diagnostics};
 }finally{if(module&&typeof module._unone_web_unload_project==='function'&&module._unone_web_unload_project()!==0)throw Error('WEB_REFRESH_CORE_UNLOAD_FAILED');}
}
validate().then(value=>parentPort.postMessage({ok:true,value}),error=>parentPort.postMessage({ok:false,error:String(error?.stack??error)}));
