import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {createOrderedPhysicalQueue} from './ordered-physical-queue.mjs';
import {serializedSavePayload} from './save-publication.mjs';
const source=fs.readFileSync(new URL('../player/main.js',import.meta.url),'utf8');
function entry(backend){
 const q=createOrderedPhysicalQueue({epoch:1});q.append({kind:'reset',route:'control',origin:'fixture',received_us:1,scope:'all',reason:'load'});
 const context={serializedSavePayload,profiler:null,profileFlight:null,performance:{now:()=>0},manualInput:null,input:{consumeFrame:()=>({actions:{}})},hasWorldPointer:false,orderedQueue:q,
  backend,acceptSnapshot:value=>context.snapshot=value,audio:null,snapshot:{save_payload:{}},saved:'{}',publishPhysical(){},localStorage:{setItem(){}},key:'fixture'};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function persistSave('),source.indexOf('function draw('))+source.slice(source.indexOf('async function advance(){'),source.indexOf('function tickOnce()')),context);return{q,context};
}
test('actual player advance leases one prefix, accepts exact Core world receipt, then admits later arrivals',async()=>{
 let finish;const {q,context}=entry({request:command=>new Promise(resolve=>{finish=()=>resolve({world:{physical_input_receipt:{profile:'ordered_physical_v1',epoch:1,through_sequence:command.input.physical.through_sequence}},save_payload:{}});})});
 const running=context.advance();q.append({kind:'reset',route:'control',origin:'fixture',received_us:2,scope:'all',reason:'blur'});
 assert.equal(q.report().committed,0);assert.equal(q.report().pending,2);finish();await running;
 assert.equal(q.report().committed,1);assert.equal(q.report().pending,1);assert.deepEqual(q.lease().events.map(e=>e.sequence),[2]);
});
test('actual player advance fails closed for missing/mismatched receipt and unknown worker completion',async()=>{
 for(const request of [async()=>({world:{},save_payload:{}}),async()=>{throw Error('WORKER_REQUEST_TIMEOUT');}]){
  const {q,context}=entry({request});await assert.rejects(context.advance());assert.equal(q.report().pending,1);assert.equal(q.report().committed,0);
  assert.match(q.report().fault,/TERMINAL/);assert.throws(()=>q.lease());
 }
});
test('legacy omission uses unchanged snapshot input and does not require a receipt',async()=>{
 let actual;const {context}=entry({request:async command=>{actual=command.input;return{world:{frame:1},save_payload:{}};}});context.orderedQueue=null;
 await context.advance();assert.deepEqual(JSON.parse(JSON.stringify(actual)),{actions:{}});
});
