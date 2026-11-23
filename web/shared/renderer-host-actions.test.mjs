import test from 'node:test';import assert from 'node:assert/strict';
import {createHostInput,createRendererHostActions} from './host-input.js';
import {physicalKeyAction} from './player-input.js';
import {requireRendererHostActions} from './renderer-selection.mjs';
test('versioned capability guard rejects incompatible SDKs at startup and retired renderers cannot inject',()=>{
 let active=true;const input=createHostInput(),api=createRendererHostActions(input,{isActive:()=>active});assert.equal(api.version,1);assert.equal(requireRendererHostActions({hostActions:api}),api);
 for(const options of [{},{hostActions:{version:2,setHeld(){}}}])assert.throws(()=>requireRendererHostActions(options),/RENDERER_HOST_ACTIONS_UNSUPPORTED/);
 active=false;assert.equal(api.setHeld('LatePacket',true),false);assert.equal(api.pulse('LateShot'),false);assert.deepEqual(input.consumeFrame().actions,{});
});
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
test('sendData hands Luau one whole state per tick, copied when sent, and the latest send wins',()=>{
 let active=true;const input=createHostInput(),actions=createRendererHostActions(input,{isActive:()=>active});
 assert.equal(typeof actions.sendData,'function');assert.equal(requireRendererHostActions({hostActions:actions}),actions);
 const state={players:[{x:1}]};assert.equal(actions.sendData('game.state',state),true);
 state.players[0].x=2;assert.equal(actions.sendData('game.state',state),true);state.players[0].x=3;
 assert.deepEqual(input.consumeFrame().host_data,{'game.state':'{"players":[{"x":2}]}'},'the latest send, as it was when sent');
 assert.equal(input.consumeFrame().host_data,undefined,'delivered once, not repeated on the next tick');
 actions.sendData('a',1);actions.sendData('b','text');input.releaseAll();
 assert.deepEqual(input.consumeFrame().host_data,{a:'1',b:'"text"'},'releasing keys and pointers keeps host data');
 assert.equal(actions.sendData('game.state',{s:'x'.repeat(200000)}),true);assert.equal(input.consumeFrame().host_data['game.state'].length,200008);
 for(const [channel,value] of [['',1],[' ',1],['x'.repeat(129),1],['中'.repeat(43),1],['a\nb',1],['game.state',undefined],['game.state',()=>1],['game.state',{s:'中'.repeat(87382)}]])
  assert.throws(()=>actions.sendData(channel,value),/HOST_DATA_INVALID/,JSON.stringify(channel));
 for(let i=0;i<16;i++)actions.sendData('c'+i,i);assert.throws(()=>actions.sendData('c16',16),/HOST_DATA_CHANNELS_FULL/);actions.sendData('c3',33);
 assert.equal(Object.keys(input.consumeFrame().host_data).length,16);
 active=false;assert.equal(actions.sendData('game.state',{late:true}),false);assert.equal(input.consumeFrame().host_data,undefined);
});
test('held names are sorted once per change and still track every hold',()=>{
 const input=createHostInput(),actions=createRendererHostActions(input);
 for(const name of ['B','A','C'])actions.setHeld(name,true);
 assert.deepEqual(Object.keys(input.consumeFrame().actions),['A','B','C']);
 assert.deepEqual(Object.keys(input.consumeFrame().actions),['A','B','C'],'unchanged holds reuse the sorted list');
 actions.setHeld('B',false);actions.setHeld('AA',true);actions.pulse('Z');
 assert.deepEqual(Object.keys(input.consumeFrame().actions),['A','AA','C','Z']);
 assert.deepEqual(Object.keys(input.consumeFrame().actions),['A','AA','C']);
 input.releaseKeyboard();assert.deepEqual(input.consumeFrame().actions,{});
 actions.setHeld('D',true);assert.deepEqual(Object.keys(input.consumeFrame().actions),['D']);
});
