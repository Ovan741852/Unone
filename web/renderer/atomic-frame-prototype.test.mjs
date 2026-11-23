import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.core.js';
import {createAtomicFramePrototype} from './atomic-frame-prototype.js';

function fixture(){
 const calls=[],framebuffer={};let lost=false,current=null;
 const gl={READ_FRAMEBUFFER:1,DRAW_FRAMEBUFFER:2,COLOR_BUFFER_BIT:4,NEAREST:5,
  isContextLost:()=>lost,bindFramebuffer:(...args)=>calls.push(['bind',...args]),blitFramebuffer:(...args)=>calls.push(['blit',...args])};
 const renderer={getContext:()=>gl,getDrawingBufferSize:v=>v.set(3840,2160),setRenderTarget:v=>{current=v;calls.push(['target',v])},
  resetState:()=>calls.push(['reset']),properties:{get:()=>({__webglFramebuffer:framebuffer})}};
 return {frame:createAtomicFramePrototype(THREE,renderer),calls,framebuffer,current:()=>current,lose:()=>lost=true};
}
test('one retained RGBA target is blitted only after an accepted frame',()=>{
 const {frame,calls,framebuffer,current}=fixture();assert.equal(frame.begin(),true);const target=current();
 assert.deepEqual([target.width,target.height,target.texture.internalFormat,target.texture.colorSpace,target.isXRRenderTarget],[3840,2160,'RGBA8',THREE.SRGBColorSpace,true]);
 assert.equal(frame.metrics().color_bytes_estimate,3840*2160*4);frame.finish(false);assert(!calls.some(x=>x[0]==='blit'));
 assert.equal(frame.begin(),true);assert.equal(current(),target);frame.finish(true);
 assert(calls.some(x=>x[0]==='bind'&&x[1]===1&&x[2]===framebuffer));assert.equal(calls.filter(x=>x[0]==='blit').length,1);assert.equal(current(),null);
 frame.dispose();assert.throws(()=>frame.begin(),/LIFECYCLE/);
});
test('lost contexts cannot begin and a nested frame is rejected',()=>{
 const f=fixture();assert.equal(f.frame.begin(),true);assert.throws(()=>f.frame.begin(),/LIFECYCLE/);f.frame.finish(false);f.lose();assert.equal(f.frame.begin(),false);f.frame.dispose();
});
