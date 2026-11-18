import test from 'node:test';import assert from 'node:assert/strict';
import {createHostInput} from './host-input.js';import {routeBrowserKey} from './player-input.js';
test('a key held across wait cannot be restarted by an auto-repeat after input reset',()=>{
 const input=createHostInput(),event=(repeat=false)=>({code:'KeyW',repeat,target:{tagName:'CANVAS'},preventDefault(){this.prevented=true;}});
 routeBrowserKey(input,event(),true);assert.equal(input.consumeFrame().actions.W,true);
 routeBrowserKey(input,event(true),true);assert.equal(input.consumeFrame().actions.W,true,'normal hold remains down');
 input.releaseNonText();routeBrowserKey(input,event(true),true);assert.equal(input.consumeFrame().actions.W,undefined);
 routeBrowserKey(input,event(),true);assert.equal(input.consumeFrame().actions.W,true);
 routeBrowserKey(input,event(),false);assert.equal(input.consumeFrame().actions.W,undefined);
});
