// Regression for the actual official renderer resource-routing boundary.
// Exercise actual Three routing initialization, pool/presenter and real broker.
// The GPU upload/compiler boundary is a counter-only fake, not pixel proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../vendor/three/three.module.js';
import {createAssetCatalog,createImageAssetBroker} from '../shared/asset-encoding.js';
import {createTextureCachePolicy} from './texture-cache-policy.js';
import {createSpriteResourcePool,parseSpriteResourceBudget} from './sprite-resources.js';
import {createSpritePresentation} from './sprite-presentation.js';

const source=fs.readFileSync(new URL('./three.js',import.meta.url),'utf8');
const start=source.indexOf('  const textureCache = createTextureCachePolicy('),end=source.indexOf('  const heightfields =',start);
assert(start>=0&&end>start,'Actual production renderer resource-routing boundary');
const routing=source.slice(start,end);
const ASSET='texture://auto-cache-probe';
async function fixture(){
 const catalog=createAssetCatalog({assets:[{id:ASSET,kind:'texture2d',source:'atlas.png',encoding:{decoder:'image',format:'png',mime:'image/png'}}]});
 let loads=0,uploads=0,compiles=0;
 const broker=createImageAssetBroker(catalog,{resolveAssetUrl:asset=>asset.source,inspectImage:async()=>({format:'png',width:2,height:2}),loadImage:async()=>{loads++;return {width:2,height:2};},unusedMaxBytes:0,unusedMaxEntries:0});
 await broker.prepareScene({entities:[{id:'declared',sprite:{asset:ASSET,visible:false}}]});
 const renderer={capabilities:{maxTextureSize:2048},initTexture(){uploads++;},compile(){compiles++;},properties:{get:()=>({currentProgram:{getUniforms(){}}})}};
 const options={getImageAssets:()=>broker,getAssetCatalog:()=>catalog,textureCache:{max_bytes:16,max_entries:1,idle_frames:3}};
 const root=new THREE.Group(),geometry=new THREE.PlaneGeometry(1,1),records=new Map(),textureRecords=new Map();
 function recordFor(entity){let record=records.get(entity.id);if(!record){const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material);record={mesh,material};records.set(entity.id,record);root.add(mesh);}return record;}
 const inputs={createTextureCachePolicy,textureRecords,options,backend:'webgl',createSpriteResourcePool,THREE,renderer,spriteBudget:parseSpriteResourceBudget(),root,geometry,records,recordFor,createSpritePresentation,bloom:null,drawLegacySprite(){throw Error('Unexpected readiness-bypassing legacy fallback');}};
 const constructed=new Function(...Object.keys(inputs),'let spriteResources=null,spritePresentation=null;'+routing+';return {textureCache,pool:spriteResources,presenter:spritePresentation};')(...Object.values(inputs));
 const world=visible=>({frame:1,entities:{slot:{id:'slot',transform:{x:0,y:0},sprite:{asset:ASSET,visible}}}});
 const render=visible=>{constructed.textureCache.begin();const complete=constructed.presenter.draw(world(visible));constructed.textureCache.sweep();return complete;};
 assert.equal(render(true),false);await constructed.pool.ready();assert.equal(render(true),true);assert.equal(loads,1);assert.equal(uploads,1);assert.equal(compiles,1);
 return {...constructed,render,counts:()=>({loads,uploads,compiles}),dispose(){constructed.pool.dispose();constructed.textureCache.clear();geometry.dispose();broker.dispose();}};
}

test('configured ordinary-sprite idle grace retains the auto GPU owner after hiding',async()=>{
 const f=await fixture();try{assert.equal(f.render(false),true);assert.equal(f.pool.metrics().texture_retired,0,'Configured idle_frames=3 must not retire the texture immediately');assert.equal(f.textureCache.metrics().entries,1,'The configured physical texture controller must account for the pool owner');}finally{f.dispose();}
});

test('a scene-decoded, GPU-warmed auto sprite reappears inside cache grace without another pending frame',async()=>{
 const f=await fixture();try{assert.equal(f.render(false),true);assert.equal(f.render(true),true,'The ready cached appearance must be reusable in this draw, without waiting for a Promise microtask');assert.deepEqual(f.counts(),{loads:1,uploads:1,compiles:1});}finally{f.dispose();}
});

test('100 auto hide/reappear cycles preserve ready reuse without extra image, texture or program work',async()=>{
 const f=await fixture();try{for(let i=0;i<100;i++){assert(f.render(false));assert(f.render(true));}
  assert.deepEqual(f.counts(),{loads:1,uploads:1,compiles:1});assert.equal(f.textureCache.metrics().entries,1);assert.equal(f.pool.metrics().texture_retired,0);
 }finally{f.dispose();}
});
