import test from 'node:test';
import assert from 'node:assert/strict';
import {readObservation,releaseObservationResources} from './load-project.js';
import {InstanceTransfer,InstanceReceiver} from './instance-transfer.mjs';
import {retainImageResource,retainedImageGeneration} from './retained-image-generation.mjs';
import {createRuntimeBackend} from './runtime-backend.mjs';
import {createRuntimeCore} from './runtime-core.mjs';
const enc=new TextEncoder(),bounds={x:0,y:0,width:100,height:100};
const definition=(revision=1,asset='texture://a')=>({revision,bounds:{...bounds},quads:[{asset,rect:{...bounds},opacity:0.5}]});
function heap(){
 let length=0;const module={HEAPU8:new Uint8Array(65536),_unone_web_observation_ptr:()=>16,_unone_web_observation_len:()=>length};
 function publish(resource=definition(),epoch='1',id='art'){
  const resourceBytes=enc.encode(JSON.stringify(resource));module.HEAPU8.set(resourceBytes,16384);
  const value={world:{frame:1,ui:{kind:'screen',children:[]}},ui_transport:{format:'retained-image-batches-v1',epoch,resources:{[id]:{revision:String(resource.revision),memory:{offset:16384,byte_length:resourceBytes.length}}}}};
  const bytes=enc.encode(JSON.stringify(value));module.HEAPU8.set(bytes,16);length=bytes.length;return value;
 }
 return {module,publish};
}
test('immutable Core leases decode once, survive heap growth and invalidate across epochs',()=>{
 const h=heap();h.publish();const first=readObservation(h.module),resource=first.world.ui_image_batches.art;
 assert(retainedImageGeneration(resource));assert(Object.isFrozen(resource.quads[0].rect));assert(!('ui_transport'in first));
 const grown=new Uint8Array(131072);grown.set(h.module.HEAPU8);h.module.HEAPU8=grown;
 assert.equal(readObservation(h.module).world.ui_image_batches.art,resource);
 h.publish(definition(2,'texture://b'));assert.equal(readObservation(h.module).world.ui_image_batches.art.quads[0].asset,'texture://b');
 h.publish(definition(1,'texture://c'),'2');const fresh=readObservation(h.module).world.ui_image_batches.art;
 assert.notEqual(fresh,resource);assert.equal(fresh.quads[0].asset,'texture://c');assert.equal(resource.quads[0].asset,'texture://a');
 releaseObservationResources(h.module);assert.notEqual(readObservation(h.module).world.ui_image_batches.art,fresh);
});
test('invalid descriptors preserve prior generation and never expose a heap view',()=>{
 const h=heap();const wire=h.publish(),first=readObservation(h.module).world.ui_image_batches.art;
 wire.ui_transport.resources.art.memory.offset=-1;const bytes=enc.encode(JSON.stringify(wire));h.module.HEAPU8.set(bytes,16);h.module._unone_web_observation_len=()=>bytes.length;
 assert.throws(()=>readObservation(h.module),/UI_IMAGE_TRANSPORT_INVALID/);
 const replacement=h.publish();h.module._unone_web_observation_len=()=>enc.encode(JSON.stringify(replacement)).length;
 assert.equal(readObservation(h.module).world.ui_image_batches.art,first);h.module.HEAPU8.fill(0);assert.equal(first.quads[0].asset,'texture://a');
});
test('resource IDs share the Core UTF-8 boundary through lease and worker transport',()=>{
 for(const id of ['x'.repeat(129),'龍'.repeat(341)+'a']){
  const h=heap();h.publish(definition(),'1',id);const value=readObservation(h.module);
  const t=new InstanceTransfer(),r=new InstanceReceiver();const restored=r.accept(structuredClone(t.encode(value,new ArrayBuffer(0))));
  assert.equal(restored.world.ui_image_batches[id].quads[0].asset,'texture://a');
 }
 const h=heap();h.publish(definition(),'1','龍'.repeat(342));assert.throws(()=>readObservation(h.module),/UI_IMAGE_TRANSPORT_INVALID/);
});
test('worker packets transfer changed definitions only and retire old resource graphs',()=>{
 const t=new InstanceTransfer(),r=new InstanceReceiver(),resource=retainImageResource(definition()),value={world:{frame:1,ui_image_batches:{art:resource}}};
 const packet=t.encode(value,new ArrayBuffer(0));assert.equal(packet.ui_images.updates.length,1);assert(!('ui_image_batches'in packet.value.world));assert.equal(value.world.ui_image_batches.art,resource);
 // postMessage performs a structured clone; the receiver freezes its own graph.
 const first=r.accept(structuredClone(packet)).world.ui_image_batches.art;
 for(let i=0;i<100;i++){const next=t.encode({...value,world:{...value.world,frame:i+2}},new ArrayBuffer(0));assert.equal(next.ui_images.updates.length,0);assert.equal(r.accept(structuredClone(next)).world.ui_image_batches.art,first);}
 const changed=t.encode({world:{frame:103,ui_image_batches:{art:retainImageResource(definition(2,'texture://b'))}}},new ArrayBuffer(0));
 assert.equal(r.accept(structuredClone(changed)).world.ui_image_batches.art.quads[0].asset,'texture://b');assert.equal(first.quads[0].asset,'texture://a');
 r.accept(t.encode({world:{frame:104}},new ArrayBuffer(0)));assert.equal(r.images.size,0);r.clear();assert.equal(r.buffers.size,0);
});
test('worker receivers reject missing/stale deltas atomically and reloads publish fresh definitions',()=>{
 const t=new InstanceTransfer(),r=new InstanceReceiver(),v={world:{ui_image_batches:{art:retainImageResource(definition())}}};
 const first=r.accept(structuredClone(t.encode(v,new ArrayBuffer(0)))).world.ui_image_batches.art;
 const delta=t.encode(v,new ArrayBuffer(0));delta.ui_images.active[0].generation='999';assert.throws(()=>r.accept(delta),/TRANSFER_UI_IMAGE_MISSING/);assert.equal(r.images.get('art').definition,first);
 t.reset();const reloaded=t.encode({world:{ui_image_batches:{art:retainImageResource(definition(1,'texture://new'))}}},new ArrayBuffer(0));assert.equal(reloaded.ui_images.updates.length,1);
 assert.equal(r.accept(structuredClone(reloaded)).world.ui_image_batches.art.quads[0].asset,'texture://new');
});
test('immutable ownership grants reject accessors and mutable class instances',()=>{
 const value=definition();Object.defineProperty(value,'quads',{get:()=>[]});assert.throws(()=>retainImageResource(value),/UI_IMAGE_RESOURCE_INVALID/);
 class Fake{constructor(){Object.assign(this,definition());}}assert.throws(()=>retainImageResource(new Fake()),/UI_IMAGE_RESOURCE_INVALID/);
 const nested=definition();Object.defineProperty(nested.quads[0].rect,'x',{get:()=>Math.random()});Object.freeze(nested);assert.throws(()=>retainImageResource(nested),/UI_IMAGE_RESOURCE_INVALID/);
});
for(const profiled of [false,true])test(`invalid worker deltas reject the actual in-flight request without a hang (profile=${profiled})`,async()=>{
 let terminated=false;
 class Worker{
  postMessage({id,command}){queueMicrotask(()=>this.onmessage({data:{id,ok:true,packet:command.kind==='init'?{value:null,updates:[],removed:[]}:
   {value:{world:{frame:1}},updates:[],removed:[],ui_images:{format:'ui-image-delta-v1',active:[{id:'missing',generation:'1'}],updates:[]}}}}));}
  terminate(){terminated=true;}
 }
 const profiler=profiled?{now:()=>performance.now(),timeOrigin:performance.timeOrigin,begin:()=>({start_ms:performance.now()}),span(){},set(){},tag(){},end(){}}:null;
 const backend=await createRuntimeBackend({kind:'worker',url:'http://localhost/runtime.js',WorkerClass:Worker,timeoutMs:200,device:{},profiler});
 let timer;try{await assert.rejects(Promise.race([backend.request({kind:'load',payload:{config:{}}}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('admission hung')),100);})]),/TRANSFER_UI_IMAGE_MISSING/);}
 finally{clearTimeout(timer);backend.close();}
 assert(terminated);assert.equal(backend.report().pending,0);assert.equal(backend.report().closed,true);
});
test('closing a retained runtime unloads once and a suspended tick cannot execute after teardown',async()=>{
 const h=heap();let ticks=0,unloads=0;
 h.module._unone_web_alloc=()=>0;h.module._unone_web_load_project=()=>{h.publish();return 0;};
 h.module._unone_web_set_instance_transport=()=>{h.publish();return 0;};h.module._unone_web_set_ui_transport=()=>0;
 h.module._unone_web_tick=()=>{ticks++;return 0;};h.module._unone_web_set_input_frame=()=>0;
 h.module._unone_web_unload_project=()=>{unloads++;return 0;};
 const core=createRuntimeCore(h.module),first=await core.execute({kind:'load',payload:{config:{}}});
 const pending=core.execute({kind:'tick',input:{}});core.close();core.close();
 await assert.rejects(pending,/RUNTIME_CLOSED/);assert.equal(ticks,0);assert.equal(unloads,1);assert(core.report().closed);
 await assert.rejects(core.execute({kind:'aspect',value:1}),/RUNTIME_CLOSED/);
 const next=createRuntimeCore(h.module),reloaded=await next.execute({kind:'load',payload:{config:{}}});
 assert.notEqual(first.world.ui_image_batches.art,reloaded.world.ui_image_batches.art);next.close();
});
