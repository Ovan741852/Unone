import test from 'node:test';
import assert from 'node:assert/strict';
import {readObservation,releaseObservationResources} from './load-project.js';
import {InstanceTransfer,InstanceReceiver} from './instance-transfer.mjs';
import {createWorldFieldPublication,worldFieldPublication} from './world-field-publication.mjs';

const encoder=new TextEncoder(),heap=new ArrayBuffer(0);
const terrain=(height=1)=>({ground:{width:2,depth:2,heights:[0,height,2,3],revision:height}});
// A Core-like heap: the envelope at 16, each leased field at its own offset.
function runtime(){
 const module={HEAPU8:new Uint8Array(0)};let length=0;
 module._unone_web_observation_ptr=()=>16;module._unone_web_observation_len=()=>length;
 function publish({fields={heightfields:{text:JSON.stringify(terrain()),revision:'1'}},epoch='1',world={frame:1},extra={}}={}){
  let offset=8192;const descriptors={},parts=[];
  for(const [key,{text,revision}]of Object.entries(fields)){const bytes=encoder.encode(text);descriptors[key]={revision,memory:{offset,byte_length:bytes.length}};parts.push([bytes,offset]);offset+=bytes.length+64;}
  const envelope=encoder.encode(JSON.stringify({world,world_transport:{format:'world-fields-memory-v1',epoch,fields:descriptors},...extra}));
  module.HEAPU8=new Uint8Array(offset+100);module.HEAPU8.set(envelope,16);length=envelope.length;
  for(const [bytes,at]of parts)module.HEAPU8.set(bytes,at);
 }
 return {module,publish};
}

test('a leased field decodes once per revision into one deeply frozen value',()=>{
 const r=runtime();r.publish();const first=readObservation(r.module),field=first.world.heightfields;
 assert.equal(first.world_transport,undefined);assert.deepEqual(field,terrain());assert.equal(first.world.frame,1);
 assert(Object.isFrozen(field.ground.heights));assert.throws(()=>{field.ground.width=9;},TypeError);
 assert.equal(worldFieldPublication(field).value,field);
 for(let frame=2;frame<122;frame++){r.publish({world:{frame}});const next=readObservation(r.module);assert.equal(next.world.heightfields,field);assert.equal(next.world.frame,frame);}
 // The value never aliases the heap it was decoded from.
 r.module.HEAPU8.fill(0);assert.equal(field.ground.heights[1],1);
 r.publish({fields:{heightfields:{text:JSON.stringify(terrain(5)),revision:'2'}}});
 const changed=readObservation(r.module).world.heightfields;assert.notEqual(changed,field);assert.equal(changed.ground.heights[1],5);
 // A new runtime epoch never reuses an older generation with the same revision.
 r.publish({fields:{heightfields:{text:JSON.stringify(terrain(7)),revision:'2'}},epoch:'2'});
 assert.equal(readObservation(r.module).world.heightfields.ground.heights[1],7);
});

test('a publication without leases retires the cache, and release forces a reparse',()=>{
 const r=runtime();r.publish();const first=readObservation(r.module).world.heightfields;
 r.module.HEAPU8=encoder.encode(' '.repeat(16)+JSON.stringify({world:{frame:2,heightfields:terrain(3)}}));
 r.module._unone_web_observation_len=()=>r.module.HEAPU8.length-16;
 assert.equal(readObservation(r.module).world.heightfields.ground.heights[1],3);
 const fresh=runtime();fresh.publish();const before=readObservation(fresh.module).world.heightfields;
 releaseObservationResources(fresh.module);fresh.publish();assert.notEqual(readObservation(fresh.module).world.heightfields,before);
 assert.deepEqual(first,terrain());
});

test('invalid descriptors fail closed without replacing the current generation',()=>{
 const r=runtime();r.publish();const first=readObservation(r.module).world.heightfields;
 const valid={text:JSON.stringify(terrain()),revision:'1'};
 const cases=[
  {fields:{ui:valid}},{fields:{instances3d:valid}},{fields:{'Bad-Key':valid}},
  {fields:{heightfields:{...valid,revision:'0'}}},{world:{frame:1,heightfields:{}}},
  {fields:{heightfields:{text:'{',revision:'9'}}},{epoch:'x'},
 ];
 for(const c of cases){r.publish(c);assert.throws(()=>readObservation(r.module),/WORLD_TRANSPORT_INVALID/,JSON.stringify(c));}
 r.publish();assert.equal(readObservation(r.module).world.heightfields,first);
});

test('worker sends leased field text only on change and the receiver keeps one frozen value',()=>{
 const sender=new InstanceTransfer(),receiver=new InstanceReceiver(),entry=createWorldFieldPublication(JSON.stringify(terrain()));
 const source={world:{frame:1,heightfields:entry.value,entities:{a:{id:'a'}}}};
 const first=sender.encode(source,heap);
 assert.equal(first.world_fields.fields.heightfields.json,entry.text);assert.equal(first.value.world.heightfields,undefined);assert.equal(source.world.heightfields,entry.value);
 const decoded=receiver.accept(structuredClone(first)),field=decoded.world.heightfields;
 assert.deepEqual(field,terrain());assert(Object.isFrozen(field.ground));assert.deepEqual(decoded.world.entities,{a:{id:'a'}});
 for(let frame=2;frame<122;frame++){
  const packet=sender.encode({world:{frame,heightfields:entry.value}},heap);assert(!Object.hasOwn(packet.world_fields.fields.heightfields,'json'));
  assert.equal(receiver.accept(structuredClone(packet)).world.heightfields,field);
 }
 const changed=createWorldFieldPublication(JSON.stringify(terrain(4)));
 assert.equal(receiver.accept(structuredClone(sender.encode({observation:{world:{heightfields:changed.value}}},heap))).observation.world.heightfields.ground.heights[1],4);
 assert.equal(sender.report().world_field_updates,2);assert.equal(sender.report().world_field_unchanged,120);
 // Caller-owned values stay inline and clear both sides' ownership.
 const inline=sender.encode({world:{heightfields:terrain(2)}},heap);assert.equal(inline.world_fields,undefined);
 assert.equal(receiver.accept(structuredClone(inline)).world.heightfields.ground.heights[1],2);assert.equal(receiver.fields.size,0);
});

test('worker rejects forged, conflicting and missing field generations',()=>{
 const sender=new InstanceTransfer(),receiver=new InstanceReceiver(),entry=createWorldFieldPublication(JSON.stringify(terrain()));
 receiver.accept(structuredClone(sender.encode({world:{heightfields:entry.value}},heap)));
 const delta=sender.encode({world:{heightfields:entry.value}},heap);
 for(const mutate of [p=>p.world_fields.format='other',p=>p.world_fields.fields.heightfields.generation='0',p=>p.world_fields.extra=1,p=>p.value.world.heightfields={},p=>p.world_fields.fields.heightfields.json='{"forged":1}']){
  const packet=structuredClone(delta);mutate(packet);assert.throws(()=>receiver.accept(packet),/TRANSFER_WORLD_FIELD_INVALID/);
 }
 const missing=structuredClone(delta);missing.world_fields.fields.heightfields.generation='99';assert.throws(()=>receiver.accept(missing),/TRANSFER_WORLD_FIELD_MISSING/);
 assert.deepEqual(receiver.accept(structuredClone(delta)).world.heightfields,terrain());
});
