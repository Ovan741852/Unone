import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../vendor/three/three.player.min.js';
import {installContextClearRecovery} from './renderer-clear-lifecycle.js';
const vendor=readFileSync(new URL('../vendor/three/three.module.js',import.meta.url),'utf8');
const backgroundSource=vendor.slice(vendor.indexOf('function WebGLBackground('),vendor.indexOf('\nfunction WebGLBindingStates('));
const restoreSource=vendor.slice(vendor.indexOf('function onContextRestore('),vendor.indexOf('\n\t\tfunction onContextCreationError('));
// Run actual vendor background and context-restore bodies. Only GL allocation and
// WebXR/material dependencies outside this clear-state path are CPU test doubles.
function vendorBoundary(){
 const canvas=new EventTarget(),clears=[];
 const glState={buffers:{color:{setClear:(...values)=>clears.push(values)}}};
 const scope=vm.createContext({Color:THREE.Color,_rgb:{r:0,g:0,b:0},getUnlitUniformColorSpace:()=>THREE.LinearSRGBColorSpace,
  state:glState,console:{log(){}},_isContextLost:false,info:{autoReset:false},shadowMap:{enabled:true,autoUpdate:false,needsUpdate:true,type:17}});
 vm.runInContext(backgroundSource,scope);
 const fresh=()=>vm.runInContext('WebGLBackground({},null,null,state,null,false,false)',scope);
 scope.background=fresh();scope.initGLContext=()=>{scope.background=fresh();scope.info={autoReset:true};scope.shadowMap={};};
 vm.runInContext(restoreSource,scope);canvas.addEventListener('webglcontextrestored',()=>scope.onContextRestore());
 const renderer={getClearColor:out=>out.copy(scope.background.getClearColor()),getClearAlpha:()=>scope.background.getClearAlpha(),
  setClearColor:(color,alpha)=>scope.background.setClearColor(color,alpha)};
 const current=()=>({color:renderer.getClearColor(new THREE.Color()).toArray(),alpha:renderer.getClearAlpha()});
 return {canvas,renderer,current,clears,scope,loss:()=>canvas.dispatchEvent(new Event('webglcontextlost')),
  restore:()=>canvas.dispatchEvent(new Event('webglcontextrestored'))};
}
test('actual vendor reset loses arbitrary host clear state without any projected probe installed',()=>{
 const f=vendorBoundary();f.renderer.setClearColor(0x111827,.37);assert.notDeepEqual(f.current().color,[0,0,0]);
 f.loss();f.restore();assert.deepEqual(f.current(),{color:[0,0,0],alpha:1});
 assert.equal(f.scope.info.autoReset,false);assert.equal(f.scope.shadowMap.type,17);
});
test('recovery replays host clear intent after actual vendor reinit and repeats with latest color/alpha',()=>{
 const f=vendorBoundary(),hook=installContextClearRecovery(THREE,f.renderer,f.canvas);
 for(const [color,alpha] of [[0x111827,1],[0x37895a,.37],[0x804020,0]]){
  f.renderer.setClearColor(color,alpha);const expected=f.current();f.loss();f.restore();assert.deepEqual(f.current(),expected);
 }
 assert.equal(hook.metrics().losses,3);assert.equal(hook.metrics().restores,3);assert.equal(hook.metrics().pending,false);
 hook.dispose();
});
test('a restored event with no captured loss does not invent color; disposal removes both listeners idempotently',()=>{
 const f=vendorBoundary(),hook=installContextClearRecovery(THREE,f.renderer,f.canvas);
 f.renderer.setClearColor(0xabcdef,.3);f.restore();assert.deepEqual(f.current(),{color:[0,0,0],alpha:1});
 assert.equal(hook.metrics().restores,0);hook.dispose();hook.dispose();
 f.renderer.setClearColor(0xabcdef,.3);f.loss();f.restore();assert.deepEqual(f.current(),{color:[0,0,0],alpha:1});
 assert.equal(hook.metrics().losses,0);
});
test('dispose while loss is pending discards that intent and never writes into a disposed-context recovery',()=>{
 const f=vendorBoundary(),hook=installContextClearRecovery(THREE,f.renderer,f.canvas);
 f.renderer.setClearColor(0x111827,.37);f.loss();assert.equal(hook.metrics().pending,true);assert.equal(hook.metrics().losses,1);
 hook.dispose();hook.dispose();assert.equal(hook.metrics().pending,false);f.restore();
 assert.deepEqual(f.current(),{color:[0,0,0],alpha:1});assert.equal(hook.metrics().restores,0);
 f.loss();assert.equal(hook.metrics().losses,1);
});
