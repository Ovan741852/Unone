import {retainImageResource} from './retained-image-generation.mjs';
import {createSavePublication,attachSavePublication} from './save-publication.mjs';
import {createUiTreePublication,UI_TREE_MAX_ENCODED_BYTES} from './ui-tree-publication.mjs';
import {createWorldFieldPublication,WORLD_FIELD_MAX_ENCODED_BYTES} from './world-field-publication.mjs';
// Session selection belongs to the host load boundary; deterministic callers
// continue passing their explicit seeds directly to loadProject.
const MAX_SESSION_SEED = (1n << 64n) - 1n;
export function playerSeed(search, random = globalThis.crypto) {
  const requested = new URLSearchParams(search).get('seed');
  if (requested !== null) {
    if (!/^(0|[1-9][0-9]{0,19})$/.test(requested) || BigInt(requested) > MAX_SESSION_SEED) {
      throw new Error(`PLAYER_SEED_INVALID: ?seed= must be a decimal integer in 0..${MAX_SESSION_SEED}`);
    }
    return {seed: requested, source: 'url'};
  }
  const words = random.getRandomValues(new Uint32Array(2));
  return {seed: ((BigInt(words[0]) << 32n) | BigInt(words[1])).toString(), source: 'random'};
}
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
const uiTrees=new WeakMap(),uiTreeDecoder=new TextDecoder('utf-8',{fatal:true});
const worldFields=new WeakMap();
const uint64=value=>typeof value==='string'&&/^[1-9][0-9]{0,19}$/.test(value)&&BigInt(value)<=18446744073709551615n;
export function releaseObservationResources(module){imageResources.delete(module);saves.delete(module);uiTrees.delete(module);worldFields.delete(module);}
// Large world fields arrive as leased canonical JSON by revision. An unchanged
// revision reuses the previous frozen value without decoding or parsing.
function restoreWorldFields(module,value,staged){
 const wire=value?.world_transport;
 if(wire===undefined){staged.worldFields=null;return value;}
 const fields=wire?.fields,invalid=()=>{throw Error('WORLD_TRANSPORT_INVALID');};
 if(!value.world||typeof value.world!=='object'||Array.isArray(value.world)||!wire||Object.keys(wire).some(k=>!['format','epoch','fields'].includes(k))
  ||wire.format!=='world-fields-memory-v1'||!uint64(wire.epoch)||!fields||typeof fields!=='object'||Array.isArray(fields))invalid();
 const previous=worldFields.get(module),old=previous?.epoch===wire.epoch?previous.fields:null,next=new Map();
 for(const [key,field]of Object.entries(fields)){
  const memory=field?.memory;
  if(!/^[a-z0-9_]{1,64}$/.test(key)||['ui','ui_image_batches','instances3d'].includes(key)||Object.hasOwn(value.world,key)
   ||!field||Object.keys(field).some(k=>!['revision','memory'].includes(k))||!uint64(field.revision)
   ||!memory||Object.keys(memory).some(k=>!['offset','byte_length'].includes(k))||!Number.isSafeInteger(memory.offset)||memory.offset<0
   ||!Number.isSafeInteger(memory.byte_length)||memory.byte_length<1||memory.byte_length>WORLD_FIELD_MAX_ENCODED_BYTES
   ||memory.offset+memory.byte_length>module.HEAPU8.byteLength)invalid();
  let entry=old?.get(key);
  if(!entry||entry.revision!==field.revision||entry.bytes!==memory.byte_length){
   let publication;
   try{publication=createWorldFieldPublication(uiTreeDecoder.decode(module.HEAPU8.subarray(memory.offset,memory.offset+memory.byte_length)));}catch{invalid();}
   entry={revision:field.revision,bytes:memory.byte_length,publication};
  }
  next.set(key,entry);value.world[key]=entry.publication.value;
 }
 delete value.world_transport;staged.worldFields={epoch:wire.epoch,fields:next};return value;
}
function restoreUiTree(module,value,staged){
 const wire=value?.ui_tree_transport;
 if(wire===undefined){staged.uiTree=null;return value;}
 const memory=wire?.memory,invalid=()=>{throw Error('UI_TREE_TRANSPORT_INVALID');};
 if(!value.world||typeof value.world!=='object'||Array.isArray(value.world)||!wire
  ||Object.keys(wire).some(k=>!['format','epoch','revision','memory'].includes(k))||wire.format!=='ui-tree-memory-v1'||!uint64(wire.epoch)||!uint64(wire.revision)
  ||Object.hasOwn(value.world,'ui')||!memory||Object.keys(memory).some(k=>!['offset','byte_length'].includes(k))
  ||!Number.isSafeInteger(memory.offset)||memory.offset<0||!Number.isSafeInteger(memory.byte_length)||memory.byte_length<1||memory.byte_length>UI_TREE_MAX_ENCODED_BYTES
  ||!Number.isSafeInteger(memory.offset+memory.byte_length)||memory.offset+memory.byte_length>module.HEAPU8.byteLength)invalid();
 let entry=uiTrees.get(module);
 if(!entry||entry.epoch!==wire.epoch||entry.revision!==wire.revision||entry.bytes!==memory.byte_length){
  let publication;
  try{publication=createUiTreePublication(uiTreeDecoder.decode(module.HEAPU8.subarray(memory.offset,memory.offset+memory.byte_length)));}catch{invalid();}
  entry={epoch:wire.epoch,revision:wire.revision,bytes:memory.byte_length,publication};
 }
 // This is the reader's fresh private JSON envelope. Restoring its one field
 // in place avoids another complete world spread for every unchanged tree.
 value.world.ui=entry.publication.value;delete value.ui_tree_transport;
 staged.uiTree=entry;return value;
}
function restoreSave(module,value,staged){
 if(!value?.world)return value;
 const wire=value.save_transport;
 if(wire===undefined){staged.save=null;return value;}
 const memory=wire?.memory,invalid=()=>{throw Error('SAVE_TRANSPORT_INVALID');};
 if(!wire||Object.keys(wire).some(k=>!['format','epoch','revision','memory'].includes(k))||wire.format!=='save-memory-v1'||!uint64(wire.epoch)||!uint64(wire.revision)
  ||Object.hasOwn(value,'save_payload')||!memory||Object.keys(memory).some(k=>!['offset','byte_length'].includes(k))||!Number.isSafeInteger(memory.offset)||memory.offset<0
  ||!Number.isSafeInteger(memory.byte_length)||memory.byte_length<1||!Number.isSafeInteger(memory.offset+memory.byte_length)||memory.offset+memory.byte_length>module.HEAPU8.byteLength)invalid();
 let entry=saves.get(module);
 if(!entry||entry.epoch!==wire.epoch||entry.revision!==wire.revision||entry.bytes!==memory.byte_length){
  entry={epoch:wire.epoch,revision:wire.revision,bytes:memory.byte_length,publication:createSavePublication(observationDecoder.decode(module.HEAPU8.subarray(memory.offset,memory.offset+memory.byte_length)))};
 }
 const {save_transport,...observation}=value,result=attachSavePublication({...observation,save_payload:entry.publication.value},entry.publication);
 staged.save=entry;return result;
}
function restoreImages(module,value,staged){
 if(!value?.world)return value;
 const transport=value.ui_transport;
 if(transport===undefined){staged.images=null;return value;}
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
 staged.images={epoch:transport.epoch,resources:next};
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
  const value=JSON.parse(text);if(mark)mark('observation_parse');
  const staged={},restored=restoreSave(module,restoreImages(module,restoreUiTree(module,restoreWorldFields(module,value,staged),staged),staged),staged);
  // Advance no generation cache until every descriptor in this publication
  // has validated. A malformed companion resource/save cannot replace UI.
  if(Object.hasOwn(staged,'uiTree')){if(staged.uiTree)uiTrees.set(module,staged.uiTree);else uiTrees.delete(module);}
  if(Object.hasOwn(staged,'worldFields')){if(staged.worldFields)worldFields.set(module,staged.worldFields);else worldFields.delete(module);}
  if(Object.hasOwn(staged,'images')){if(staged.images)imageResources.set(module,staged.images);else imageResources.delete(module);}
  if(Object.hasOwn(staged,'save')){if(staged.save)saves.set(module,staged.save);else saves.delete(module);}
  return restored;
}
// Data assets travel beside the JSON payload: each is copied once into a
// buffer the core reserves, and the next load consumes them all.
export function stageDataAssets(module,data=[]) {
  if(data.length&&typeof module._unone_web_stage_data!=='function')throw Error('RUNTIME_DATA_ASSETS_UNSUPPORTED: rebuild the player runtime');
  for(const {id,bytes} of data){
    const name=projectEncoder.encode(id),view=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
    module.HEAPU8.set(name,module._unone_web_alloc(name.length));
    const target=module._unone_web_stage_data(name.length,view.length);
    if(!target)throw Error(`DATA_ASSET_STAGE_FAILED: ${id}: ${JSON.stringify(readObservation(module))}`);
    module.HEAPU8.set(view,target);
  }
}
export function loadProject(module,payload,seed=42n,data=[]) {
  stageDataAssets(module,data);
  const bytes=projectEncoder.encode(JSON.stringify(payload));
  const address=module._unone_web_alloc(bytes.length);module.HEAPU8.set(bytes,address);
  const status=module._unone_web_load_project(address,bytes.length,seed);
  const observation=readObservation(module);
  if(status!==0){const error=new Error(`HOST_PROJECT_REJECTED: ${JSON.stringify(observation)}`);error.result=observation;throw error;}
  return observation;
}
