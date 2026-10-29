import test from 'node:test';
import assert from 'node:assert/strict';
import {physicalKeyAction,routeBrowserPointer} from './player-input.js';
import {createHostInput} from './host-input.js';
test('modifier sides, keypad/navigation and punctuation have distinct neutral names',()=>{
 for(const key of ['ShiftLeft','ShiftRight','ControlLeft','ControlRight','AltLeft','AltRight','Delete','PageDown','Minus','Equal','Numpad8','Numpad2','Numpad4','Numpad6','Numpad7','Numpad9'])assert.equal(physicalKeyAction(key),key,key);
 assert.equal(physicalKeyAction('ArrowUp'),'Up');assert.notEqual(physicalKeyAction('ArrowUp'),physicalKeyAction('Numpad8'));
});
test('middle held and release coordinates survive a short drag without primary pointer down',()=>{
 const input=createHostInput(),calls=[];
 const h={capture(){},unlock(){},ui(){calls.push('ui');return false;},primary(){calls.push('primary');},secondary(){calls.push('right');},
  middle(e,down){input.queueScreenAction('MouseMiddle',down,{position:{x:0,y:0},screen_position:{x:e.x,y:e.y},down:false});}};
 routeBrowserPointer({button:1,buttons:4,pointerId:1,x:20,y:90},'down',h);
 let f=input.consumeFrame();assert.equal(f.actions.MouseMiddle,true);assert.equal(f.pointer.down,false);assert.deepEqual(f.pointer.screen_position,{x:20,y:90});
 routeBrowserPointer({button:1,buttons:0,pointerId:1,x:80,y:40},'up',h);
 f=input.consumeFrame();assert.equal(f.actions.MouseMiddle,undefined);assert.equal(f.pointer.down,false);assert.deepEqual(f.pointer.screen_position,{x:80,y:40});assert.deepEqual(calls,[]);
});
