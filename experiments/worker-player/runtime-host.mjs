import {loadProject} from '../web/shared/load-project.js';
export async function boot(loader){
 const base=new URL('../',import.meta.url),url=new URL('runtime/unone-player.js',base).href;
 const module=await new Promise((resolve,reject)=>{
  globalThis.Module={noInitialRun:true,locateFile:path=>new URL('runtime/'+path,base).href,onRuntimeInitialized(){resolve(globalThis.Module)},onAbort:e=>reject(Error(String(e))),print:()=>{},printErr:console.error};
  if(loader){globalThis.window=globalThis;globalThis.document={currentScript:{src:url}};loader(url);}
  else{const script=document.createElement('script');script.src=url;script.onerror=reject;document.head.append(script);}
 });
 const project=await (await fetch(new URL('content/project.json',base))).json();project.viewport_aspect=16/9;project.restored_save=null;
 loadProject(module,project,42n);
 const read=()=>JSON.parse(new TextDecoder().decode(module.HEAPU8.subarray(module._unone_web_observation_ptr(),module._unone_web_observation_ptr()+module._unone_web_observation_len())));
 const send=(name,value)=>{const b=new TextEncoder().encode(JSON.stringify(value)),p=module._unone_web_alloc(b.length);module.HEAPU8.set(b,p);if(module[name](p,b.length)!==0)throw Error(JSON.stringify(read()));};
 // Fixed empty input and immortal 10k stress fixture. No dev panel or sampling overhead.
 send('_unone_web_developer_request',{method:'tools'});const tools=read().value.tools??read().value;
 send('_unone_web_developer_request',{method:'invoke',id:'battle.stress',revision:tools.revision,value:true});
 if(module._unone_web_set_instance_transport(1)!==0)throw Error('memory transport failed');
 let snapshot=read();const tick=()=>{send('_unone_web_set_input_frame',{actions:{}});if(module._unone_web_tick()!==0)throw Error(JSON.stringify(read()));snapshot=read();return snapshot;};
 return {module,read:()=>snapshot,tick};
}
export function pack(snapshot,module,previous){
 const batches=Object.values(snapshot.world.instances3d??{});
 const signature=JSON.stringify(batches.map(b=>[b.memory?.revision,b.memory?.byte_length,b.memory?.offset]));
 let cursor=0;for(const b of batches){if(b.memory)cursor+=b.memory.byte_length;}
 const changed=signature!==previous;
 const binary=changed?new ArrayBuffer(cursor):null;let offset=0;
 for(const b of batches){if(!b.memory)continue;const {byte_length,offset:source}=b.memory;if(binary)new Uint8Array(binary,offset,byte_length).set(new Uint8Array(module.HEAPU8.buffer,source,byte_length));b.memory={...b.memory,offset};offset+=byte_length;}
 return {snapshot,binary,signature,bytes:binary?.byteLength??0};
}
