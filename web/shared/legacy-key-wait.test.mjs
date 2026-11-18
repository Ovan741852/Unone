import test from 'node:test';import assert from 'node:assert/strict';
import {createHostInput} from './host-input.js';import {routeBrowserKey,createPresentationWaitInputGuard} from './player-input.js';
const key=(code='KeyW',repeat=false)=>({code,repeat,target:{tagName:'CANVAS'},preventDefault(){this.prevented=true;}});
function route(input,guard,event,down){if(!guard||guard.allowKey(event,down))routeBrowserKey(input,event,down);}
test('legacy non-opt-in hosts preserve repeated keydown after reset',()=>{
 const input=createHostInput();route(input,null,key(),true);assert.equal(input.consumeFrame().actions.W,true);
 input.releaseNonText();route(input,null,key('KeyW',true),true);assert.equal(input.consumeFrame().actions.W,true);
});
test('opt-in guard blocks held repeats only across a wait, then admits a fresh press',()=>{
 const input=createHostInput(),guard=createPresentationWaitInputGuard();
 route(input,guard,key(),true);assert.equal(input.consumeFrame().actions.W,true);
 input.releaseNonText();route(input,guard,key('KeyW',true),true);assert.equal(input.consumeFrame().actions.W,true,'pre-wait repeat remains compatible');
 input.releaseNonText();guard.begin();const repeat=key('KeyW',true);route(input,guard,repeat,true);assert.equal(repeat.prevented,true);assert.equal(input.consumeFrame().actions.W,undefined);
 route(input,guard,key(),false);route(input,guard,key(),true);assert.equal(input.consumeFrame().actions.W,true);
 route(input,guard,key('KeyW',true),true);assert.equal(input.consumeFrame().actions.W,true);
 route(input,guard,key(),false);assert.equal(input.consumeFrame().actions.W,undefined);
});
const pad=(slot,{buttons=[],left_x=0,left_y=0,right_x=0,right_y=0,left_trigger=0,right_trigger=0}={})=>({slot,buttons,left_x,left_y,right_x,right_y,left_trigger,right_trigger});
test('gamepad held buttons and analogs are gated per device until released or neutral',()=>{
 const guard=createPresentationWaitInputGuard(),input=createHostInput();guard.begin();
 const read=pads=>{input.setGamepads(guard.filterGamepads(pads));return input.consumeFrame();};
 let f=read([pad(1,{buttons:['A'],left_x:1,left_trigger:1}),pad(2,{buttons:['B'],right_y:-1})]);
 assert.deepEqual(f.actions,{});assert.equal(f.gamepads[0].left_x,0);assert.equal(f.gamepads[0].left_trigger,0);assert.equal(f.gamepads[1].right_y,0);
 f=read([pad(1,{buttons:['A'],left_x:1}),pad(2,{buttons:['B'],right_y:-1})]);assert.deepEqual(f.actions,{});assert.equal(f.gamepads[0].left_x,0);
 read([pad(1),pad(2,{buttons:['B'],right_y:-1})]);
 f=read([pad(1,{buttons:['A'],left_x:0.8,left_trigger:0.9}),pad(2,{buttons:['B'],right_y:-1})]);
 assert.equal(f.actions.Gamepad1_A,true);assert.equal(f.actions.Gamepad2_B,undefined);assert.equal(f.gamepads[0].left_x,0.8);assert.equal(f.gamepads[0].left_trigger,0.9);assert.equal(f.gamepads[1].right_y,0);
 read([pad(1),pad(2)]);f=read([pad(1),pad(2,{buttons:['B'],right_y:-1})]);assert.equal(f.actions.Gamepad2_B,true);assert.equal(f.gamepads[1].right_y,-1);
});
test('new waits re-arm; disconnected devices do not keep stale slot blocks',()=>{
 const guard=createPresentationWaitInputGuard();guard.begin();
 assert.deepEqual(guard.filterGamepads([pad(1,{buttons:['A']})])[0].buttons,[]);
 guard.filterGamepads([]);assert.deepEqual(guard.filterGamepads([pad(1,{buttons:['A']})])[0].buttons,['A']);
 guard.begin();assert.deepEqual(guard.filterGamepads([pad(1,{buttons:['A']})])[0].buttons,[]);
});
