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
