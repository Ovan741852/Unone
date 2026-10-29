import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHostInput} from './host-input.js';

let helpers={};
try { helpers=await import('./player-input.js'); }
catch(error) { if(error.code!=='ERR_MODULE_NOT_FOUND')throw error; }
const source=readFileSync(new URL('../player/main.js',import.meta.url),'utf8');
const native=readFileSync(new URL('../../crates/unone-native-player/src/lib.rs',import.meta.url),'utf8');
const mappings=[...native.slice(native.indexOf('fn key_action('),native.indexOf('\nfn hash('))
  .matchAll(/KeyCode::(\w+)\s*=>\s*Some\("([^"]+)"\)/g)].map(m=>[m[1],m[2]]);

function harness() {
  const canvasEvents=new Map(),windowEvents=new Map(),input=createHostInput(),uiCalls=[];
  const context=vm.createContext({...helpers,input,snapshot:{},hasWorldPointer:false,audio:null,orderedRouter:null,
    canvas:{getBoundingClientRect:()=>({left:0,top:0,width:200,height:100}),setPointerCapture(){},addEventListener:(name,fn)=>canvasEvents.set(name,fn)},
    window:{addEventListener:(name,fn)=>windowEvents.set(name,fn)},
    worldFromPointer:(_canvas,event)=>({x:event.clientX,y:event.clientY}),
    uiScroll:{pointer:(_e,kind)=>{uiCalls.push(kind);return false;}},
    uiRenderer:{hitTest:()=>null,pointer:()=>false,releaseAll(){}}});
  const route=source.slice(source.indexOf('function pointer(event,down,kind){'),source.indexOf("window.addEventListener('unone-host-pause'"));
  assert.ok(route.startsWith('function pointer('));vm.runInContext(route,context);
  const pointer=(kind,patch={})=>canvasEvents.get(kind)({pointerId:1,pointerType:'mouse',button:0,buttons:1,
    clientX:20,clientY:40,preventDefault(){},...patch});
  const key=(kind,code)=>windowEvents.get(kind)({code,preventDefault(){}});
  return {input,context,uiCalls,pointer,key,canvasEvents,windowEvents};
}

test('actual official player physical keys match every current native action name',()=>{
  assert.equal(mappings.length,62);
  for(const [code,action] of mappings) {
    const h=harness();h.key('keydown',code);
    assert.equal(h.input.consumeFrame().actions[action],true,code+' -> '+action);
    h.key('keyup',code);assert.equal(h.input.consumeFrame().actions[action],undefined);
  }
});

test('short keyboard taps, chords and repeat preserve native per-action transition order',()=>{
  const h=harness();h.key('keydown','KeyW');h.key('keydown','KeyW');h.key('keyup','KeyW');
  h.key('keydown','KeyD');h.key('keyup','KeyD');
  const first=h.input.consumeFrame();assert.equal(first.actions.W,true);assert.equal(first.actions.D,true);
  assert.deepEqual(h.input.consumeFrame().actions,{});
  h.key('keydown','KeyW');h.key('keyup','KeyW');h.key('keydown','KeyW');h.key('keyup','KeyW');
  assert.equal(h.input.consumeFrame().actions.W,true);assert.equal(h.input.consumeFrame().actions.W,undefined);
  assert.equal(h.input.consumeFrame().actions.W,true);assert.equal(h.input.consumeFrame().actions.W,undefined);
});

test('secondary click queues MouseRight with press/release screen and never primary down',()=>{
  const h=harness();h.pointer('pointerdown',{button:2,buttons:2});
  h.pointer('pointerup',{button:2,buttons:0,clientX:180,clientY:70});
  const a=h.input.consumeFrame(),b=h.input.consumeFrame();
  assert.equal(a.pointer.down,false);assert.equal(a.actions.MouseRight,true);
  assert.deepEqual(a.pointer.screen_position,{x:10,y:60});
  assert.equal(b.pointer.down,false);assert.equal(b.actions.MouseRight,undefined);
  assert.equal(b.pointer.screen_position.x,90);assert.ok(Math.abs(b.pointer.screen_position.y-30)<1e-9);
});

test('secondary down/up bypass primary UI routing and cannot activate a UI control',()=>{
  const h=harness();h.pointer('pointerdown',{button:2,buttons:2});h.pointer('pointerup',{button:2,buttons:0});
  assert.deepEqual(h.uiCalls,[]);
});

test('pointer movement uses only primary buttons bit and preserves independent middle action',()=>{
  const h=harness();h.pointer('pointermove',{button:-1,buttons:2});
  assert.equal(h.input.consumeFrame().pointer.down,false);
  h.pointer('pointermove',{button:-1,buttons:3});assert.equal(h.input.consumeFrame().pointer.down,true);
  const m=harness();m.pointer('pointerdown',{button:1,buttons:4});
  const frame=m.input.consumeFrame();assert.equal(frame.pointer.down,false);assert.equal(frame.actions.MouseMiddle,true);assert.deepEqual(m.uiCalls,[]);
});

test('native primary edge priority defers secondary action and its coordinates together',()=>{
  const h=harness();h.pointer('pointerdown');h.pointer('pointerdown',{button:2,buttons:3,clientX:80});
  h.pointer('pointerup',{button:0,buttons:2,clientX:100});h.pointer('pointerup',{button:2,buttons:0,clientX:160});
  const frames=Array.from({length:4},()=>h.input.consumeFrame());
  assert.deepEqual(frames.map(f=>f.pointer.down),[true,false,false,false]);
  assert.deepEqual(frames.map(f=>!!f.actions.MouseRight),[false,false,true,false]);
  assert.deepEqual(frames.map(f=>f.pointer.screen_position.x),[10,50,40,80]);
});

test('focus loss releases held actions and discards pending physical and secondary taps',()=>{
  const h=harness();h.key('keydown','KeyW');h.pointer('pointerdown',{button:2,buttons:2});
  h.windowEvents.get('blur')();
  assert.deepEqual(h.input.consumeFrame().actions,{});assert.equal(h.input.pointer.down,false);
  h.key('keyup','KeyW');h.pointer('pointerup',{button:2,buttons:0});
  assert.deepEqual(h.input.consumeFrame().actions,{});
});

test('canvas context menu is prevented without stealing menus outside the canvas',()=>{
  const h=harness();let calls=0;
  assert.equal(typeof h.canvasEvents.get('contextmenu'),'function');
  h.canvasEvents.get('contextmenu')({preventDefault(){calls++;}});assert.equal(calls,1);
  assert.equal(h.windowEvents.has('contextmenu'),false);
});

test('real browser chord transitions carried by pointermove preserve both buttons',()=>{
  const h=harness();h.pointer('pointerdown');h.input.consumeFrame();
  h.pointer('pointermove',{button:2,buttons:3,clientX:80});
  const both=h.input.consumeFrame();assert.equal(both.pointer.down,true);assert.equal(both.actions.MouseRight,true);
  h.pointer('pointermove',{button:0,buttons:2,clientX:100});
  const right=h.input.consumeFrame();assert.equal(right.pointer.down,false);assert.equal(right.actions.MouseRight,true);
  h.pointer('pointerup',{button:2,buttons:0});assert.equal(h.input.consumeFrame().actions.MouseRight,undefined);
});
