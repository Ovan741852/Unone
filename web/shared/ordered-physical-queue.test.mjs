import {test} from 'node:test';import assert from 'node:assert/strict';
const {createOrderedPhysicalQueue}=await import(process.env.UNONE_ORDERED_QUEUE_SOURCE??new URL('./ordered-physical-queue.mjs',import.meta.url));
const event=(time=1)=>({received_us:time,origin:'fixture',route:'control',kind:'reset',scope:'all',reason:'load'});
test('lease preserves global order, is detached, and only exact successful receipt removes prefix',()=>{
 const q=createOrderedPhysicalQueue({epoch:7});q.append(event(1));q.append(event(2));
 const a=q.lease();assert.deepEqual(a.events.map(e=>e.received_us),[1,2]);a.events[0].received_us=99;
 q.append(event(3));assert.equal(q.lease().events[0].received_us,1);
 q.commit({profile:'ordered_physical_v1',epoch:7,through_sequence:2});
 const b=q.lease();assert.deepEqual(b.events.map(e=>e.sequence),[3]);assert.equal(b.after_sequence,2);
});
test('wrong receipt never drains or permits more input, empty batches do not invent time',()=>{
 const q=createOrderedPhysicalQueue({epoch:1});q.append(event());q.lease();
 assert.throws(()=>q.commit({profile:'ordered_physical_v1',epoch:2,through_sequence:1}),/RECEIPT/);
 assert.equal(q.report().pending,1);assert.throws(()=>q.append(event()),/RECEIPT/);
 const empty=createOrderedPhysicalQueue({epoch:1});assert.deepEqual(empty.lease().events,[]);
 empty.commit({profile:'ordered_physical_v1',epoch:1,through_sequence:0});assert.equal(empty.report().committed,0);
});
test('bounded split preserves new arrivals; source time reversal and overflow fail visibly without drop',()=>{
 const q=createOrderedPhysicalQueue({epoch:1});for(let i=0;i<257;i++)q.append(event(i));
 assert.equal(q.lease().events.length,256);q.commit({profile:'ordered_physical_v1',epoch:1,through_sequence:256});assert.equal(q.lease().events.length,1);
 const full=createOrderedPhysicalQueue({epoch:1,maxPending:2});full.append(event());full.append(event());
 assert.throws(()=>full.append(event()),/QUEUE_FULL/);assert.equal(full.report().pending,2);
 const time=createOrderedPhysicalQueue({epoch:1});time.append(event(10));assert.throws(()=>time.append(event(9)),/TIME/);
});
test('row admission precedes synchronous routing and nested capture, leases wait for completed ownership',()=>{
 const q=createOrderedPhysicalQueue({epoch:1}),key={received_us:1,origin:'fixture',route:'game',kind:'key',code:'KeyA',location:0,state:'down',repeat:false,is_composing:false,modifiers:{shift:false,control:false,alt:false,meta:false}};
 assert.equal(typeof q.admit,'function');
 q.admit(key,()=>{assert.throws(()=>q.lease(),/ADMISSION_PENDING/);q.append(event(2));return 'engine_ui';});
 const b=q.lease();assert.deepEqual(b.events.map(e=>[e.sequence,e.kind,e.route]),[[1,'key','engine_ui'],[2,'reset','control']]);
});
test('routing throw or invalid owner is terminal and retains admitted prefix without pretending an acknowledged sequence',()=>{
 for(const route of [()=>{throw Error('UI fault');},()=> 'control']){
  const q=createOrderedPhysicalQueue({epoch:1}),key={received_us:1,origin:'fixture',route:'game',kind:'key',code:'KeyA',location:0,state:'down',repeat:false,is_composing:false,modifiers:{shift:false,control:false,alt:false,meta:false}};
  assert.throws(()=>q.admit(key,()=>{q.append(event(2));return route();}));
  assert.equal(q.report().committed,0);assert.equal(q.report().pending,2);assert.equal(q.report().next_sequence,3);
  assert.throws(()=>q.lease(),/ROUTE/);assert.throws(()=>q.append(event(3)),/ROUTE/);
 }
});
