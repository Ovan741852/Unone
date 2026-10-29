import {retainImageResource} from './retained-image-generation.mjs';
import {createSavePublication,attachSavePublication} from './save-publication.mjs';
// One config contract: never pick individual ProjectConfig declarations here.
export async function assembleProject(config, readText, readJson) {
  const job_sources=Object.fromEntries(await Promise.all(Object.entries(config.job_scripts??{}).map(async([id,path])=>[id,await readText(path)])));
  return {...(Object.keys(job_sources).length?{job_sources}:{}),config,script:await readText(config.entry_script??'scripts/main.luau'),scene:config.main_scene?await readJson(config.main_scene):null};
}
const observationDecoder=new TextDecoder(),projectEncoder=new TextEncoder();
// Optional trusted Core ABI grant: immutable resource generations are leased by
// the runtime until its next successful publication. Never retain a heap view.
const imageResources=new WeakMap();
const saves=new WeakMap();
const uint64=value=>typeof value==='string'&&/^[1-9][0-9]{0,19}$/.test(value)&&BigInt(value)<=18446744073709551615n;
export function releaseObservationResources(module){imageResources.delete(module);saves.delete(module);}
function restoreSave(module,value){
 if(!value?.world)return value;
 const wire=value.save_transport;
 if(wire===undefined){saves.delete(module);return value;}
 const memory=wire?.memory,invalid=()=>{throw Error('SAVE_TRANSPORT_INVALID');};
 if(!wire||Object.keys(wire).some(k=>!['format','epoch','revision','memory'].includes(k))||wire.format!=='save-memory-v1'||!uint64(wire.epoch)||!uint64(wire.revision)
  ||Object.hasOwn(value,'save_payload')||!memory||Object.keys(memory).some(k=>!['offset','byte_length'].includes(k))||!Number.isSafeInteger(memory.offset)||memory.offset<0
  ||!Number.isSafeInteger(memory.byte_length)||memory.byte_length<1||!Number.isSafeInteger(memory.offset+memory.byte_length)||memory.offset+memory.byte_length>module.HEAPU8.byteLength)invalid();
 let entry=saves.get(module);
 if(!entry||entry.epoch!==wire.epoch||entry.revision!==wire.revision||entry.bytes!==memory.byte_length){
  entry={epoch:wire.epoch,revision:wire.revision,bytes:memory.byte_length,publication:createSavePublication(observationDecoder.decode(module.HEAPU8.subarray(memory.offset,memory.offset+memory.byte_length)))};
 }
 const {save_transport,...observation}=value,result=attachSavePublication({...observation,save_payload:entry.publication.value},entry.publication);
 saves.set(module,entry);return result;
}
function restoreImages(module,value){
 if(!value?.world)return value;
 const transport=value.ui_transport;
 if(transport===undefined){imageResources.delete(module);return value;}
 const invalid=()=>{throw Error('UI_IMAGE_TRANSPORT_INVALID');};
 if(!transport||Object.keys(transport).some(k=>!['format','epoch','resources'].includes(k))||transport.format!=='retained-image-batches-v1'||!uint64(transport.epoch)
   ||!transport.resources||typeof transport.resources!=='object'||Array.isArray(transport.resources)||Object.keys(transport.resources).length>256
   ||value.world.ui_image_batches!==undefined)invalid();
 const previous=imageResources.get(module),old=previous?.epoch===transport.epoch?previous.resources:new Map(),next=new Map(),definitions={};let total=0;
 for(const [id,descriptor]of Object.entries(transport.resources)){
  const memory=descriptor?.memory;
  if(!/\S/.test(id)||(id.length>256&&projectEncoder.encode(id).length>1024)||!descriptor||Object.keys(descriptor).some(k=>!['revision','memory'].includes(k))||!uint64(descriptor.revision)
    ||!memory||Object.keys(memory).some(k=>!['offset','byte_length'].includes(k))||!Number.isSafeInteger(memory.offset)||memory.offset<0
    ||!Number.isSafeInteger(memory.byte_length)||memory.byte_length<1||memory.byte_length>16*1024*1024
    ||memory.offset+memory.byte_length>module.HEAPU8.byteLength)invalid();
  total+=memory.byte_length;if(total>32*1024*1024)invalid();
  let entry=old.get(id);
  if(!entry||entry.revision!==descriptor.revision||entry.bytes!==memory.byte_length){
   const definition=JSON.parse(observationDecoder.decode(module.HEAPU8.subarray(memory.offset,memory.offset+memory.byte_length)));
   if(!definition||Object.keys(definition).some(k=>!['revision','bounds','quads'].includes(k))||String(definition.revision)!==descriptor.revision||!Array.isArray(definition.quads)||!definition.bounds)invalid();
   entry={revision:descriptor.revision,bytes:memory.byte_length,definition:retainImageResource(definition)};
  }
  next.set(id,entry);Object.defineProperty(definitions,id,{value:entry.definition,enumerable:true});
 }
 imageResources.set(module,{epoch:transport.epoch,resources:next});
 // Raw memory descriptors are private to this synchronous reader, not hooks.
 const {ui_transport,...observation}=value;
 return {...observation,world:{...value.world,ui_image_batches:Object.freeze(definitions)}};
}
// Decode synchronously from the current WASM heap. No WASM call or async boundary occurs
// while the borrowed view is in use; returned objects never retain the heap or its bytes.
// `mark` is the host profiler's synchronous callback and receives view/UTF-8/parse boundaries.
export function readObservation(module,mark) {
  const pointer=module._unone_web_observation_ptr(),length=module._unone_web_observation_len();
  const bytes=module.HEAPU8.subarray(pointer,pointer+length);
  if(mark)mark('observation_view',bytes.length);
  const text=observationDecoder.decode(bytes);if(mark)mark('observation_utf8');
  const value=JSON.parse(text);if(mark)mark('observation_parse');return restoreSave(module,restoreImages(module,value));
}
export function loadProject(module,payload,seed=42n) {
  const bytes=projectEncoder.encode(JSON.stringify(payload));
  const address=module._unone_web_alloc(bytes.length);module.HEAPU8.set(bytes,address);
  const status=module._unone_web_load_project(address,bytes.length,seed);
  const observation=readObservation(module);
  if(status!==0){const error=new Error(`HOST_PROJECT_REJECTED: ${JSON.stringify(observation)}`);error.result=observation;throw error;}
  return observation;
}
