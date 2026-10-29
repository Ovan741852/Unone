import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.player.min.js';
import {createProjectedRenderer,projectedEntries} from './projected.js';
import {createProjectedRasterPass} from './projected-raster.js';
import {rasterProfileInputs,packRasterProfileCase} from './projected-raster-profile.js';
import {RASTER_PROFILE,validateRasterTarget} from './projected-raster-validator.js';
function fixture(){
 let target=null,viewport=new THREE.Vector4(1,2,640,360),scissor=new THREE.Vector4(3,4,50,60),test=false;
 let color=new THREE.Color(0x28405a),alpha=.37,fail=false,width=1280,height=720,dpr=2,lost=false,loseOnRead=false;
 const events=[],gl={RGBA:6408,UNSIGNED_BYTE:5121,isContextLost:()=>lost,
  readPixels(...args){events.push(['read',...args.slice(0,6)]);args[6].fill(0);if(loseOnRead)lost=true;}};
 const renderer={autoClear:true,getRenderTarget:()=>target,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,
  getViewport:v=>v.copy(viewport),setViewport(...v){viewport=v[0]?.isVector4?v[0].clone():new THREE.Vector4(...v);},
  getScissor:v=>v.copy(scissor),setScissor(...v){scissor=v[0]?.isVector4?v[0].clone():new THREE.Vector4(...v);events.push(['scissor',...scissor]);},
  getScissorTest:()=>test,setScissorTest:v=>test=v,getClearColor:v=>v.copy(color),getClearAlpha:()=>alpha,
  setClearColor(c,a){color=new THREE.Color(c);alpha=a;},getDrawingBufferSize:v=>v.set(width,height),getPixelRatio:()=>dpr,getContext:()=>gl,
  setRenderTarget(t){target=t;events.push(['target',t]);},clear(...v){events.push(['clear',...v]);},
  readRenderTargetPixels(t,x,y,w,h,output){events.push(['marker',t,x,y,w,h]);output.fill(0);},
  render(scene){for(const mesh of scene.children)if(mesh.visible){mesh.onBeforeRender?.();mesh.geometry.computeBoundingSphere();
   assert.ok(Number.isFinite(mesh.geometry.boundingSphere.radius));events.push(['mesh',target,mesh]);}if(fail)throw Error('dispatch failed');}};
 const state=()=>({target,viewport:viewport.toArray(),scissor:scissor.toArray(),test,color:color.toArray(),alpha,autoClear:renderer.autoClear});
 const initial=state(),pass=createProjectedRasterPass(THREE,renderer);
 return {renderer,pass,events,state,initial,fail:()=>fail=true,lose:()=>lost=true,loseOnRead:()=>loseOnRead=true,
  resize:(w,h,r)=>{width=w;height=h;dpr=r;}};
}
test('production reflected pass uses actual Three shader variants/40B bytes/scissor without namespace replacement',()=>{
 const f=fixture(),texture=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);
 const projected=createProjectedRenderer(THREE,()=>({state:'ready',texture}),{raster:'upper_left_checked'});
 const input=rasterProfileInputs().cases.find(c=>c.id==='scissor'),snapshot=packRasterProfileCase(input,1280,720,1),before=JSON.stringify(snapshot);
 projected.prepare(projectedEntries(snapshot),new Map([['white',{kind:'texture2d'}]]));f.pass.draw(projected,new THREE.PerspectiveCamera());
 const meshes=f.events.filter(e=>e[0]==='mesh'),first=meshes[0][2];assert.match(first.material.vertexShader,/-clipPosition\.y/);
 assert.doesNotMatch(first.material.fragmentShader,/#include <colorspace_fragment>/);assert.equal(first.material.blending,THREE.NoBlending);
 assert.equal(first.geometry.attributes.clipPosition.data.stride,10);assert.equal(first.geometry.attributes.linearRgba.offset,6);
 assert.equal(JSON.stringify(snapshot),before);assert.ok(f.events.some(e=>e[0]==='scissor'&&JSON.stringify(e.slice(1))==='[1,1,0.5,0.5]'));
 assert.equal(meshes[1][2].geometry.attributes.position.itemSize,3);assert.deepEqual(f.state(),f.initial);
 f.fail();assert.throws(()=>f.pass.draw(projected,new THREE.PerspectiveCamera()),/dispatch failed/);assert.deepEqual(f.state(),f.initial);
 projected.clear();texture.dispose();f.pass.dispose();f.pass.dispose();
});
test('production neutral selftest actually reads default RGB plus target coverage, fails zero readbacks, and restores public state',()=>{
 const f=fixture(),result=validateRasterTarget(THREE,f.renderer,f.pass,{physical_size:[1280,720],dpr:2});
 assert.equal(result.samples,RASTER_PROFILE.sample_count);assert.ok(result.passed<result.samples);assert.equal(result.failures.length,8);
 assert.equal(f.events.filter(e=>e[0]==='read').length,RASTER_PROFILE.case_count);
 assert.equal(f.events.filter(e=>e[0]==='marker').length,RASTER_PROFILE.case_count);
 assert.ok(f.events.filter(e=>e[0]==='read').every(e=>e[1]===0&&e[2]===712&&e[3]===8&&e[4]===8));
 assert.deepEqual(f.state(),f.initial);f.pass.dispose();
});
test('neutral profile is bounded, validates packed transports, and includes binary alpha equality/zero coverage cases',()=>{
 const inputs=rasterProfileInputs();assert.equal(inputs.cases.length,RASTER_PROFILE.case_count);assert.ok(inputs.cases.length<=40);
 assert.equal(inputs.cases.reduce((n,c)=>n+c.points.length,0),919);assert.ok(RASTER_PROFILE.sample_count<=1024);
 for(const c of inputs.cases)for(const [width,height] of [[8,8],[800,600],[1280,720]])projectedEntries(packRasterProfileCase(c,width,height,1));
 assert.deepEqual(RASTER_PROFILE.expected['zero-survivor'][0],{point:[3,3],rgb:[255,0,0],marker:1});
 assert.deepEqual(RASTER_PROFILE.expected['zero-discard'][0],{point:[3,3],rgb:[17,24,39],marker:0});
 assert.equal(RASTER_PROFILE.expected['alpha-equal-pass'][0].marker,1);assert.equal(RASTER_PROFILE.expected['alpha-equal-discard'][0].marker,0);
});
test('actual validator skips lost context before allocation and treats loss during readback as loss, not mismatch',()=>{
 const before=fixture();before.lose();assert.deepEqual(validateRasterTarget(THREE,before.renderer,before.pass,{physical_size:[1280,720],dpr:2}),{lost:true});
 assert.equal(before.events.length,0);assert.deepEqual(before.state(),before.initial);before.pass.dispose();
 const during=fixture();during.loseOnRead();const result=validateRasterTarget(THREE,during.renderer,during.pass,{physical_size:[1280,720],dpr:2});
 assert.deepEqual(result,{lost:true});assert.equal(during.events.filter(e=>e[0]==='read').length,1);
 assert.equal(during.events.filter(e=>e[0]==='marker').length,0);assert.deepEqual(during.state(),during.initial);during.pass.dispose();
});

test('legacy raster context loss releases its fullscreen owner and retains monotonic target generations',()=>{
 const f=fixture(),camera=new THREE.PerspectiveCamera();f.pass.draw({draw(){}},camera);
 const mesh=f.events.find(e=>e[0]==='mesh')[2];let disposed=0;mesh.geometry.addEventListener('dispose',()=>disposed++);
 const generation=f.pass.metrics().generation;f.lose();f.pass.contextLost();f.pass.contextLost();
 assert.equal(disposed,1);assert.equal(f.pass.metrics().generation,generation);assert.equal(f.pass.metrics().physical_size,null);
 assert.throws(()=>f.pass.readCoverage(0,0,1,1,new Uint8Array(4)),/TARGET_MISSING/);f.pass.dispose();assert.equal(disposed,1);
});
