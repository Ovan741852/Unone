import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import {createBloom} from './bloom.js';
import {createSpriteResourcePool} from './sprite-resources.js';
import {createAssetCatalog,createImageAssetBroker} from '../shared/asset-encoding.js';
import {createTextureCachePolicy} from './texture-cache-policy.js';

function fixture({failOffscreen=false}={}){
 const previous={name:'prior-target'},compiled=[],rendered=[];let target=previous,cube=2,mip=3,checks=0;
 const gl={getExtension:()=>null};
 const renderer={toneMapping:THREE.NoToneMapping,toneMappingExposure:1,capabilities:{maxTextureSize:2048},
  getContext:()=>gl,getDrawingBufferSize:v=>v.set(2,2),getRenderTarget:()=>target,getActiveCubeFace:()=>cube,getActiveMipmapLevel:()=>mip,
  setRenderTarget(value,face=0,level=0){target=value;cube=face;mip=level;},render(scene){rendered.push({scene,target});},initTexture(){},
  compile(){compiled.push(target);},properties:{get(){return {currentProgram:{getUniforms(){checks++;if(failOffscreen&&target)throw Error('OFFSCREEN_LINK_FAILURE');}}};}}};
 const bloom=createBloom(THREE,renderer),catalog=createAssetCatalog({assets:[{id:'a',kind:'texture2d',source:'a.png'}]});
 const broker=createImageAssetBroker(catalog,{resolveAssetUrl:()=>'/a.png',inspectImage:async()=>({format:'png',width:2,height:2}),loadImage:async()=>({width:2,height:2})});
 const pool=createSpriteResourcePool({THREE,renderer,textureCache:createTextureCachePolicy(new Map()),getCatalog:()=>catalog,getImages:()=>broker,withPreparationTargets:compile=>bloom.withWorldPreparationTargets(compile)});
 return {renderer,bloom,pool,compiled,rendered,previous,checks:()=>checks,target:()=>({target,cube,mip}),dispose(){pool.dispose();bloom.dispose();broker.dispose();}};
}

test('actual Bloom preparation compiles screen and its existing world target before resource ready',async()=>{
 const f=fixture();try{
  const lease=f.pool.public.prepare({id:'1',asset:'a'});await lease.readyPromise;
  assert.equal(f.compiled.length,2);assert.equal(f.compiled[0],null);assert(f.compiled[1]?.isWebGLRenderTarget);assert.equal(f.checks(),2);
  assert.deepEqual(f.target(),{target:f.previous,cube:2,mip:3});assert.equal(f.rendered.length,0,'preparation must never render');
  const scene=new THREE.Scene();f.bloom.draw(scene,new THREE.PerspectiveCamera());
  assert.equal(f.rendered.find(row=>row.scene===scene).target,f.compiled[1],'prepare must use the actual world target');
 }finally{f.dispose();}
});

test('offscreen link failure restores prior target and retires staged sprite ownership',async()=>{
 const f=fixture({failOffscreen:true});try{
  const lease=f.pool.public.prepare({id:'1',asset:'a'});await assert.rejects(lease.readyPromise,/OFFSCREEN_LINK_FAILURE/);
  assert.equal(lease.state,'error');assert.equal(f.checks(),2);assert.deepEqual(f.target(),{target:f.previous,cube:2,mip:3});assert.equal(f.rendered.length,0);
  assert.equal(f.pool.metrics().live_textures,0);assert.equal(f.pool.metrics().image_leases,0);assert.equal(f.pool.metrics().gpu_reserved_bytes_estimate,0);
 }finally{f.dispose();}
});
