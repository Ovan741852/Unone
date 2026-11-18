import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpriteResourceHost} from './sprite-resource-host.mjs';
function fixture(){
 const prepared=[],released=[],updates={resources:[],appearances:[]};let resets=0;
 const renderer={spriteResources:{prepare(spec){prepared.push(spec.id);return{release(){released.push(spec.id);}};},takeUpdates(){const value={resources:updates.resources.splice(0),appearances:updates.appearances.splice(0)};return value;},reset(){resets++;}}};
 return{host:createSpriteResourceHost(renderer),prepared,released,updates,get resets(){return resets;}};
}
const plan=(revision,ids)=>({revision,resources:ids.map(id=>({id,asset:'texture://shared'}))});
const ready=(id,epoch=1)=>({id,state:'ready',epoch,bytes:4096});
test('retry reprepares only failed callers with the same plan IDs and preserves successful leases',()=>{
 const calls=[],releases=[],updates={resources:[],appearances:[]},states=new Map([['1','error'],['2','ready']]);
 const renderer={spriteResources:{prepare(spec){calls.push(spec.id);const state=states.get(spec.id);return{state,readyPromise:Promise.resolve(),release(){releases.push(spec.id);}};},
  takeUpdates(){return {resources:updates.resources.splice(0),appearances:updates.appearances.splice(0)};},reset(){throw Error('must not reset');}}};
 const host=createSpriteResourceHost(renderer);host.acceptSnapshot({world:{entities:{hero:{sprite_appearance:{resource:'1',revision:1}}}},sprite_resource_plan:plan(1,['1','2'])});
 updates.resources.push({...ready('1',2),state:'error',bytes:0,error:'network'},ready('2',2));
 updates.appearances.push({entity:'hero',state:'error',epoch:2,revision:1});host.collect();assert.equal(host.hasFailed(),true);states.set('1','ready');
 assert.equal(host.retryFailed(),1);assert.equal(host.hasFailed(),false);assert.deepEqual(calls,['1','2','1']);assert.deepEqual(releases,['1']);
 updates.resources.push(ready('1',2));updates.appearances.push({entity:'hero',state:'submitted',epoch:2,revision:1});
 const packet=host.leaseInput({actions:{}});assert.deepEqual(packet.frame.presentation_resources.resources.map(v=>[v.id,v.state,v.epoch]),[['2','ready',2],['1','ready',2]]);
 assert.deepEqual(packet.frame.presentation_resources.appearances.map(v=>v.state),['submitted']);host.commitInput(packet.token);
 assert.equal(host.leaseInput({actions:{}}).token,null);assert.equal(host.report().revision,1);assert.equal(host.report().leases,2);
});
test('repeated failed caller retry stays pending and never fabricates ready',()=>{
 const updates={resources:[],appearances:[]};let prepared=0,released=0;
 const host=createSpriteResourceHost({spriteResources:{prepare(spec){prepared++;updates.resources.push({id:spec.id,state:'error',epoch:3,bytes:0,error:'network'});
  return{state:'error',readyPromise:Promise.reject(Error('network')),release(){released++;}};},takeUpdates(){return{resources:updates.resources.splice(0),appearances:updates.appearances.splice(0)};},reset(){}}});
 host.acceptSnapshot({world:{entities:{}},sprite_resource_plan:plan(1,['1'])});assert.equal(host.retryFailed(),1);assert.equal(host.retryFailed(),1);
 const packet=host.leaseInput({actions:{}});assert.equal(packet.frame.presentation_resources.resources[0].state,'error');assert.equal(prepared,3);assert.equal(released,2);host.close();
});
test('synchronous prepare failure remains retryable without regressing the resource epoch',()=>{
 const updates={resources:[],appearances:[]};let attempt=0;
 const host=createSpriteResourceHost({spriteResources:{prepare(spec){attempt++;
  if(attempt===2)throw Error('transient prepare failure');
  const state=attempt===1?'error':'ready';updates.resources.push({id:spec.id,state,epoch:3,bytes:state==='ready'?8:0});
  return{state,epoch:3,readyPromise:Promise.resolve(),release(){}};},takeUpdates(){return{resources:updates.resources.splice(0),appearances:updates.appearances.splice(0)};},reset(){}}});
 host.acceptSnapshot({world:{entities:{}},sprite_resource_plan:plan(1,['1'])});assert.equal(host.retryFailed(),0);
 const failed=host.leaseInput({actions:{}});assert.equal(failed.frame.presentation_resources.resources[0].epoch,3);assert.equal(failed.frame.presentation_resources.resources[0].state,'error');host.commitInput(failed.token);
 assert.equal(host.retryFailed(),1);const next=host.leaseInput({actions:{}});assert.equal(next.frame.presentation_resources.resources[0].epoch,3);assert.equal(next.frame.presentation_resources.resources[0].state,'ready');assert.equal(attempt,3);
});
test('unchanged plan retains caller leases; removal releases only the removed caller',()=>{
 const f=fixture();f.host.acceptSnapshot({world:{entities:{}},sprite_resource_plan:plan(1,['1','2'])});
 f.host.acceptSnapshot({world:{entities:{}},sprite_resource_plan:plan(1,['1','2'])});
 assert.deepEqual(f.prepared,['1','2']);f.host.acceptSnapshot({world:{entities:{}},sprite_resource_plan:plan(2,['2'])});
 assert.deepEqual(f.released,['1']);assert.equal(f.host.report().leases,1);
});
test('an in-flight input acknowledgment never deletes a newer renderer epoch',()=>{
 const f=fixture();f.host.acceptSnapshot({world:{entities:{}},sprite_resource_plan:plan(1,['1'])});
 f.updates.resources.push(ready('1'));const first=f.host.leaseInput({actions:{}});
 f.updates.resources.push({...ready('1',2),state:'loading'});f.host.collect();f.host.commitInput(first.token);
 f.updates.resources.push(ready('1',1));const second=f.host.leaseInput({actions:{}});
 assert.equal(second.frame.presentation_resources.resources[0].epoch,2);
 assert.equal(second.frame.presentation_resources.resources[0].state,'loading');
 f.host.commitInput(second.token);assert.equal(f.host.leaseInput({actions:{}}).token,null);
});
test('recorded manual inputs remain authoritative and do not consume live receipts',()=>{
 const f=fixture();f.host.acceptSnapshot({world:{entities:{}},sprite_resource_plan:plan(1,['1'])});f.updates.resources.push(ready('1'));
 const replay={actions:{},presentation_resources:{resources:[],appearances:[]}};
 assert.equal(f.host.leaseInput(replay,{live:false}).frame,replay);
 assert.equal(f.host.leaseInput({actions:{}}).frame.presentation_resources.resources.length,1);
 assert.throws(()=>f.host.leaseInput(replay),/INPUT_OWNERSHIP/);
});
test('feedback uses scalar DTOs and ignores stale entities or non-Core resource ids',()=>{
 const f=fixture();f.host.acceptSnapshot({world:{entities:{e:{sprite_appearance:{revision:3,resource:'1'}}}},sprite_resource_plan:plan(1,['1'])});
 f.updates.resources.push({...ready('1'),texture:{writableBuffer:new Uint8Array(5)}},ready('2'));
 f.updates.appearances.push({entity:'e',revision:2,state:'submitted',epoch:1},{entity:'e',revision:3,state:'submitted',epoch:1,texture:{}});
 const input=f.host.leaseInput({actions:{}}).frame.presentation_resources;
 assert.deepEqual(input.resources,[ready('1')]);assert.deepEqual(input.appearances,[{entity:'e',revision:3,state:'submitted',epoch:1}]);
});
test('more than one bounded input batch is delivered without dropping remaining events',()=>{
 const f=fixture(),ids=Array.from({length:300},(_,i)=>String(i+1));f.host.acceptSnapshot({world:{entities:{e:{sprite_appearance:{revision:1,resource:'300'}}}},sprite_resource_plan:plan(1,ids)});
 f.updates.resources.push(...ids.map(id=>ready(id)));f.updates.appearances.push({entity:'e',revision:1,state:'submitted',epoch:1});
 const first=f.host.leaseInput({actions:{}});assert.equal(first.frame.presentation_resources.resources.length,256);assert.equal(first.frame.presentation_resources.appearances.length,0);f.host.commitInput(first.token);
 const second=f.host.leaseInput({actions:{}});assert.equal(second.frame.presentation_resources.resources.length,44);assert.equal(second.frame.presentation_resources.appearances.length,1);f.host.commitInput(second.token);assert.equal(f.host.report().pending_resources,0);
});
test('invalid replacement is rejected before releasing an existing owner and close fences late input',()=>{
 const f=fixture();f.host.acceptSnapshot({world:{entities:{}},sprite_resource_plan:plan(1,['1'])});
 assert.throws(()=>f.host.acceptSnapshot({world:{entities:{}},sprite_resource_plan:plan(2,['2','2'])}),/PLAN_INVALID/);assert.deepEqual(f.released,[]);
 f.host.close();f.host.acceptSnapshot({world:{entities:{}},sprite_resource_plan:plan(3,['2'])});f.updates.resources.push(ready('1'));
 assert.equal(f.host.leaseInput({actions:{}}).token,null);assert.deepEqual(f.prepared,['1']);assert.deepEqual(f.released,['1']);
});
