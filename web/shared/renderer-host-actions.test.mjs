import test from 'node:test';import assert from 'node:assert/strict';
import {createHostInput,createRendererHostActions} from './host-input.js';
import {physicalKeyAction} from './player-input.js';
test('custom renderer bit packets reach one fixed tick without impersonating physical keys',()=>{
 const input=createHostInput(),actions=createRendererHostActions(input);
 assert.equal(physicalKeyAction('HPPacketBit4'),null);
 for(let bit=0;bit<31;bit++)actions.setHeld('HPPacketBit'+bit,bit===4||bit===20);
 actions.setHeld('HPReady',true);let frame=input.consumeFrame();
 assert.deepEqual(Object.keys(frame.actions).sort(),['HPPacketBit20','HPPacketBit4','HPReady']);
 actions.setHeld('HPReady',false);actions.setHeld('HPPacketBit4',false);actions.setHeld('HPPacketBit8',true);actions.setHeld('HPReady',true);
 frame=input.consumeFrame();assert.deepEqual(Object.keys(frame.actions).sort(),['HPPacketBit20','HPPacketBit8','HPReady']);
 input.releaseAll();assert.deepEqual(input.consumeFrame().actions,{});
});
test('custom button pulses last one tick and named holds survive ticks',()=>{
 const input=createHostInput(),actions=createRendererHostActions(input);assert(Object.isFrozen(actions));
 actions.pulse('Shoot');actions.setHeld('FishConnected',true);
 assert.deepEqual(input.consumeFrame().actions,{FishConnected:true,Shoot:true});assert.deepEqual(input.consumeFrame().actions,{FishConnected:true});
 actions.setHeld('FishConnected',false);assert.deepEqual(input.consumeFrame().actions,{});
});
test('invalid bridge input fails explicitly rather than silently dropping commands',()=>{
 const actions=createRendererHostActions(createHostInput());for(const name of ['',null,'x'.repeat(129),'a\nb'])assert.throws(()=>actions.setHeld(name,true),/HOST_ACTION_INVALID/);
 assert.throws(()=>actions.setHeld('Shoot',1),/HOST_ACTION_INVALID/);
});
