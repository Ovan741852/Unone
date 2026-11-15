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

test('inactive declared pipeline releases targets and preparation stays small before reuse',()=>{
 const f=fixture();try{
  const world=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
  const pipeline=on=>({ids:['world','bloom','ui'],scene:true,bloom:{on},ao:{on:false},tone:null,extensions:[]});
  f.bloom.draw(world,camera,null,pipeline(true));
  const base=f.rendered.find(row=>row.scene===world).target;
  const quarter=f.rendered.filter(row=>row.scene!==world&&row.target).map(row=>row.target);
  assert.equal(base.width,2);assert.equal(base.height,2);assert.equal(quarter.length,3);
  let releases=0;base.addEventListener('dispose',()=>releases++);
  f.bloom.draw(world,camera,null,pipeline(false));
  assert.equal(base.width,1);assert.equal(base.height,1);assert(releases>=1);
  assert.deepEqual(f.bloom.metrics().postprocess_target_size,[0,0]);assert.equal(f.bloom.metrics().postprocess_target_releases,1);
  const afterRelease=releases;
  f.bloom.draw(world,camera,null,pipeline(false));assert.equal(releases,afterRelease,'idle frames do not repeatedly release targets');
  f.bloom.withWorldPreparationTargets(()=>{});
  assert.equal(base.width,1,'preparation cannot reallocate the old full-size base');
  f.bloom.draw(world,camera,null,pipeline(true));
  assert.equal(base.width,2);assert.equal(base.height,2);
  assert.deepEqual(f.bloom.metrics().postprocess_target_size,[2,2]);
  assert.equal(f.rendered.filter(row=>row.scene===world).at(-1).target,base,'reenabling draws to the reused base');
 }finally{f.dispose();}
});

test('other active passes retain the target even when bloom is off',()=>{
 const f=fixture();try{
  const world=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
  f.bloom.draw(world,camera,null,{scene:true,bloom:{on:false},ao:{on:true,strength:1},tone:null,extensions:[]});
  const base=f.rendered.find(row=>row.scene===world).target;
  assert.equal(base.width,2);assert.equal(f.bloom.metrics().postprocess_target_releases,0);
  f.bloom.setEnabled(false);f.bloom.draw(world,camera);
  assert.equal(base.width,1);assert.equal(f.bloom.metrics().postprocess_target_releases,1);
 }finally{f.dispose();}
});
