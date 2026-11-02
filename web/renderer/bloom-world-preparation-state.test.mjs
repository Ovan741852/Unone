import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import {createBloom} from './bloom.js';

function fixture(){
 const targets=[],switches=[],prior=new THREE.WebGLRenderTarget(2,2);let current=prior,face=4,mip=2,renders=0;
 class ExistingTarget extends THREE.WebGLRenderTarget {constructor(...args){super(...args);targets.push(this);}}
 const renderer={getContext:()=>({getExtension:()=>null}),getRenderTarget:()=>current,
  getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>mip,
  setRenderTarget(target,cube=0,level=0){current=target;face=cube;mip=level;switches.push([target,cube,level]);},
  render(){renders++;}};
 const bloom=createBloom({...THREE,WebGLRenderTarget:ExistingTarget},renderer);
 return {bloom,targets,switches,prior,state:()=>[current,face,mip],renders:()=>renders,
  close(){bloom.dispose();prior.dispose();}};
}

test('preparation visits screen and the already-owned world target without drawing or allocating targets',()=>{
 const f=fixture();try{
  const count=f.targets.length,visited=[];
  f.bloom.withWorldPreparationTargets(()=>visited.push(f.state()));
  assert.equal(count,5);assert.equal(f.targets.length,count,'preparation must not allocate an extra target');
  assert.deepEqual(visited,[[null,0,0],[f.targets[0],0,0]]);
  assert.deepEqual(f.state(),[f.prior,4,2]);assert.equal(f.renders(),0);
 }finally{f.close();}
});
test('either program-variant callback failure restores the exact previous target, cube face and mip',()=>{
 for(const failAt of [1,2]){
  const f=fixture();try{
   const failure=Error('variant-'+failAt);let visits=0;
   assert.throws(()=>f.bloom.withWorldPreparationTargets(()=>{if(++visits===failAt)throw failure;}),error=>error===failure);
   assert.equal(visits,failAt);assert.deepEqual(f.state(),[f.prior,4,2]);assert.equal(f.renders(),0);
  }finally{f.close();}
 }
});
test('invalid callbacks and disposed Bloom do not switch targets or invoke preparation',()=>{
 const f=fixture();try{
  assert.throws(()=>f.bloom.withWorldPreparationTargets(null),/POSTPROCESSING_PREPARATION_INVALID/);
  assert.equal(f.switches.length,0);f.bloom.dispose();let calls=0;
  assert.throws(()=>f.bloom.withWorldPreparationTargets(()=>calls++),/POSTPROCESSING_DISPOSED/);
  assert.equal(calls,0);assert.equal(f.switches.length,0);
 }finally{f.close();}
});
test('reentrant disposal during the screen callback prevents preparing the disposed offscreen target',()=>{
 const f=fixture();try{
  let visits=0;
  assert.throws(()=>f.bloom.withWorldPreparationTargets(()=>{visits++;f.bloom.dispose();}),/POSTPROCESSING_DISPOSED/);
  assert.equal(visits,1);assert.deepEqual(f.state(),[f.prior,4,2]);assert.equal(f.renders(),0);
 }finally{f.close();}
});
