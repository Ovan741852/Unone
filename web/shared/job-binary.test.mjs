import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeJobPacket,decodeJobPacket,createBinaryJobTransport} from './job-binary.mjs';
test('binary framing rejects truncation, trailing data and unsupported versions',()=>{
 const bytes=encodeJobPacket({kind:'drain'});
 for(let n=0;n<bytes.length;n++)assert.throws(()=>decodeJobPacket(bytes.subarray(0,n)));
 const extra=new Uint8Array(bytes.length+1);extra.set(bytes);assert.throws(()=>decodeJobPacket(extra),/LENGTH/);
 const wrong=bytes.slice();wrong[3]=50;assert.throws(()=>decodeJobPacket(wrong),/VERSION/);
 assert.throws(()=>encodeJobPacket({kind:'execute'},[1,2,3]),/BUFFER_REQUIRED/);
});
test('adapter refreshes grown heaps, keeps all bytes binary and owns returned output',()=>{
 let size=0,oldHeap;
 const module={HEAPU8:new Uint8Array(1),_unone_web_alloc(n){oldHeap=this.HEAPU8;this.HEAPU8=new Uint8Array(n);return 0;},_unone_web_observation_ptr:()=>0,_unone_web_observation_len:()=>size};
 module._unone_web_jobs_binary=(p,n,mode)=>{
  assert.equal(mode,1);const request=decodeJobPacket(module.HEAPU8.subarray(p,p+n));
  assert.equal(request.header.kind,'execute');assert.equal('input' in request.header,false);
  const response=encodeJobPacket({kind:'complete',id:request.header.id,error:null,run_ms:1},Uint8Array.from(request.payload).buffer);
  structuredClone(module.HEAPU8.buffer,{transfer:[module.HEAPU8.buffer]});
  module.HEAPU8=new Uint8Array(response.length+16);module.HEAPU8.set(response);size=response.length;return 0;
 };
 const wire=createBinaryJobTransport(module);
 for(const length of [0,1,4096,262144]){
  const input=Uint8Array.from({length},(_,i)=>i%256);
  const result=wire.execute({id:'copy',source:'return function(b)return b end',path:'copy.luau',input:input.buffer});
  assert.deepEqual(new Uint8Array(result.output),input);
  module.HEAPU8.fill(255);assert.deepEqual(new Uint8Array(result.output),input);
 }
 assert.equal(wire.report().payload_sent_bytes,266241);
 assert.equal(wire.report().copied_payload_from_wasm_bytes,266241);
});
test('ArrayBuffer transfer detaches the sending owner, including empty buffers',()=>{
 for(const length of [0,256]){const sent=new ArrayBuffer(length),received=structuredClone({input:sent},{transfer:[sent]});assert.equal(received.input.byteLength,length);assert.throws(()=>new Uint8Array(sent));}
});
