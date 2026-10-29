import test from 'node:test';
import assert from 'node:assert/strict';
import {readObservation,releaseObservationResources} from './load-project.js';
import {createSavePublication,attachSavePublication,savePublication,serializedSavePayload} from './save-publication.mjs';
import {InstanceTransfer,InstanceReceiver} from './instance-transfer.mjs';
function runtime(){
 const encoder=new TextEncoder(),module={};let length=0;
 module._unone_web_observation_ptr=()=>16;module._unone_web_observation_len=()=>length;
 function publish({text='{"large":"'+'x'.repeat(112*1024)+'","nested":[{"coins":7}]}',epoch='1',revision='1',offset=2000,extra={}}={}){
  const content=encoder.encode(text),value={world:{frame:1},save_transport:{format:'save-memory-v1',epoch,revision,memory:{offset,byte_length:content.length}},...extra},bytes=encoder.encode(JSON.stringify(value));
  module.HEAPU8=new Uint8Array(offset+content.length+100);module.HEAPU8.set(bytes,16);module.HEAPU8.set(content,offset);length=bytes.length;return value;
 }
 return {module,publish};
}
test('save memory lease decodes once per immutable generation across heap growth and releases on reset',()=>{
 const r=runtime();r.publish();const first=readObservation(r.module),text=serializedSavePayload(first);
 assert(Object.isFrozen(first.save_payload.nested[0]));assert.throws(()=>first.save_payload.nested[0].coins=99,TypeError);
 for(let i=0;i<120;i++){r.publish({offset:2000+i*100});const next=readObservation(r.module);assert.equal(next.save_payload,first.save_payload);assert.equal(savePublication(next),savePublication(first));assert.equal(serializedSavePayload(next),text);}
 r.module.HEAPU8.fill(0);assert.equal(first.save_payload.nested[0].coins,7);
 r.publish({text:'{"coins":8}',revision:'2'});const changed=readObservation(r.module);assert.deepEqual(changed.save_payload,{coins:8});assert.notEqual(savePublication(changed),savePublication(first));
 r.publish({text:'null',revision:'3'});assert.equal(readObservation(r.module).save_payload,null);
 r.publish({text:'{"reloaded":true}',epoch:'2'});assert.deepEqual(readObservation(r.module).save_payload,{reloaded:true});
 releaseObservationResources(r.module);r.publish({text:'{"reloaded":true}',epoch:'2'});assert.notEqual(savePublication(readObservation(r.module)),savePublication(changed));
 first.save_payload={new:true};assert.equal(savePublication(first),undefined);assert.equal(serializedSavePayload(first),'{"new":true}');
});
test('invalid lease metadata never silently reuses cached contents or exposes heap descriptors',()=>{
 const r=runtime();r.publish({text:'{"coins":7}'});const first=readObservation(r.module);assert.equal(first.save_transport,undefined);
 for(const edit of [v=>v.save_transport.revision='0',v=>v.save_transport.epoch='bad',v=>v.save_transport.memory.offset=-1,v=>v.save_transport.memory.byte_length=Infinity,v=>v.save_payload={coins:9},v=>v.save_transport.extra=true]){
  const value=r.publish({text:'{"coins":7}'});edit(value);const bytes=new TextEncoder().encode(JSON.stringify(value));r.module.HEAPU8.set(bytes,16);r.module._unone_web_observation_len=()=>bytes.length;
  assert.throws(()=>readObservation(r.module),/SAVE_TRANSPORT_INVALID/);
 }
 assert.equal(first.save_payload.coins,7);
});
test('worker save delta carries only changed encoded contents, restores immutable full observations and clears ownership',()=>{
 const sender=new InstanceTransfer(),receiver=new InstanceReceiver(),entry=createSavePublication('{"large":"'+'x'.repeat(112*1024)+'","items":[1,2]}'),snapshot=attachSavePublication({world:{frame:1},save_payload:entry.value},entry);
 const first=sender.encode(snapshot,new ArrayBuffer(0));assert.equal(first.value.save_payload,undefined);assert.equal(typeof first.save.json,'string');
 const decoded=receiver.accept(structuredClone(first));assert.deepEqual(decoded.save_payload,entry.value);assert(Object.isFrozen(decoded.save_payload.items));
 for(let i=0;i<120;i++){
  const packet=sender.encode(snapshot,new ArrayBuffer(0));assert.equal(Object.hasOwn(packet.save,'json'),false);
  const next=receiver.accept(structuredClone(packet));assert.equal(next.save_payload,decoded.save_payload);assert.equal(serializedSavePayload(next),entry.text);
 }
 assert.equal(sender.report().save_definition_updates,1);assert.equal(sender.report().save_unchanged_publications,120);
 const wrapped=sender.encode({observation:{world:{frame:2},save_payload:{coins:9}}},new ArrayBuffer(0));assert.deepEqual(receiver.accept(structuredClone(wrapped)).observation.save_payload,{coins:9});
 const missing=sender.encode({observation:{world:{frame:3},save_payload:{coins:9}}},new ArrayBuffer(0));receiver.clear();assert.throws(()=>receiver.accept(missing),/TRANSFER_SAVE_MISSING/);
 sender.reset();assert.deepEqual(receiver.accept(sender.encode({world:{frame:4},save_payload:null},new ArrayBuffer(0))).save_payload,null);
 assert.throws(()=>receiver.accept({value:{world:{}},save:{format:'save-delta-v1',generation:sender.save.generation,json:'{"forged":true}'}}),/TRANSFER_SAVE_INVALID/);
 sender.reset();receiver.clear();assert.equal(sender.save,null);assert.equal(receiver.save,null);
});
