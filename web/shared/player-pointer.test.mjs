import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {createHostInput} from './host-input.js';
import {projectScreenPointer,worldFromPointer} from './webgpu-snapshot.js';

const source=readFileSync(new URL('../player/main.js',import.meta.url),'utf8');
// Exercise the actual official-player tick boundary with a transport stub.
// Importing the browser entry itself would also boot DOM, audio and WASM.
const advanceSource=source.slice(source.indexOf('async function advance(){'),source.indexOf('function tickOnce(){'));
const pointerSource=source.slice(source.indexOf('function pointer(event,down,kind){'),source.indexOf('function routeUi('));
assert.ok(advanceSource.startsWith('async function advance(){'));
assert.ok(pointerSource.startsWith('function pointer(event,down,kind){'));

const snapshot=(x=0,y=0,zoom=1)=>({world:{camera:{position:{x,y},view_height:900,zoom}},save_payload:null});
const canvas={clientWidth:1440,clientHeight:900,getBoundingClientRect:()=>({left:100,top:50,width:1440,height:900})};
const sample=(screenX,down)=>({position:{x:999,y:999},screen_position:{x:screenX,y:50},down});
const plain=value=>JSON.parse(JSON.stringify(value));

function harness({world=snapshot(),hasWorldPointer=true}={}){
 const frames=[];
 const context=vm.createContext({
  canvas,snapshot:world,hasWorldPointer,input:createHostInput(),manualInput:null,
  performance:{now:()=>0},projectScreenPointer,worldFromPointer,
  backend:{request:async request=>{frames.push(plain(request.input));return context.snapshot;}},
  acceptSnapshot:value=>{context.snapshot=value;},audio:null,saved:'null',key:'pointer-test',
  localStorage:{setItem:()=>{}},bridgeMs:0,
 });
 vm.runInContext(advanceSource+'\n'+pointerSource,context);
 return {context,frames,tick:()=>context.advance()};
}

test('screen reprojection shares DOM pointer mapping across camera position, zoom and aspect',()=>{
 const world=snapshot(80,-20,2);
 const screen={x:75,y:60};
 const direct=projectScreenPointer(canvas,screen,world);
 const dom=worldFromPointer(canvas,{clientX:1180,clientY:410},world);
 assert.deepEqual(direct,{x:260,y:25});
 assert.deepEqual(dom,direct);
 assert.deepEqual(projectScreenPointer({...canvas,clientWidth:900},screen,world),{x:192.5,y:25});
});

test('stationary mouse stays ahead of a following camera on consecutive fixed ticks',async()=>{
 const {context,frames,tick}=harness();
 context.pointer({clientX:910,clientY:500},true,'edge');
 context.input.setHeld('KeyD',true);
 // At the original camera this physical point was only 90 units to the right.
 // Moving the camera 143 units used to put that stale world point behind it.
 context.snapshot=snapshot(143);
 await tick();
 assert.deepEqual(frames[0].pointer,{position:{x:233,y:0},screen_position:{x:56.25,y:50},down:true});
 assert.deepEqual(frames[0].actions,{KeyD:true});
 context.snapshot=snapshot(147);
 await tick();
 assert.equal(frames[1].pointer.position.x,237);
 assert.equal(frames[1].pointer.down,true);
});

test('camera reprojection preserves consumed pointer edge order and each edge screen location',async()=>{
 const {context,frames,tick}=harness({world:snapshot(70)});
 context.input.updatePointer(sample(65,true),'edge');
 context.input.updatePointer(sample(75,false),'edge');
 await tick();await tick();await tick();
 assert.deepEqual(frames.map(frame=>frame.pointer.down),[true,false,false]);
 assert.deepEqual(frames.map(frame=>frame.pointer.position.x),[286,430,430]);
 assert.deepEqual(frames.map(frame=>frame.pointer.screen_position.x),[65,75,75]);
});

test('releaseAll cannot restore a pressed button or queued pointer edge during reprojection',async()=>{
 const {context,frames,tick}=harness({world:snapshot(70)});
 context.input.updatePointer(sample(65,true),'edge');
 context.input.setHeld('KeyD',true);
 context.input.releaseAll();
 await tick();await tick();
 assert.deepEqual(frames.map(frame=>frame.pointer.down),[false,false]);
 assert.deepEqual(frames.map(frame=>frame.actions),[{},{}]);
 assert.equal(frames[0].pointer.position.x,286);
});

test('default pointer stays untouched until a routed physical world event exists',async()=>{
 const {context,frames,tick}=harness({world:snapshot(70),hasWorldPointer:false});
 await tick();
 assert.deepEqual(frames[0].pointer.position,{x:0,y:0});
 assert.equal(context.hasWorldPointer,false);
 context.pointer({clientX:910,clientY:500},false,'move');
 await tick();
 assert.equal(context.hasWorldPointer,true);
 assert.deepEqual(frames[1].pointer.position,{x:160,y:0});
});

test('developer manual world input bypasses projection and does not drain browser edges',async()=>{
 const {context,frames,tick}=harness({world:snapshot(70)});
 context.input.updatePointer(sample(65,true),'edge');
 const manual={actions:{Replay:true},pointer:{position:{x:-10,y:23},down:true}};
 context.manualInput=manual;
 await tick();
 assert.deepEqual(frames[0],manual);
 assert.equal(context.input.pendingPointerFrames.length,1);
 assert.equal(context.manualInput,null);
 await tick();
 assert.equal(frames[1].pointer.position.x,286);
 assert.equal(frames[1].pointer.down,true);
});
