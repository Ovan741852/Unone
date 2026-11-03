import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import {createGpuUi} from './ui-gpu.js';
import {createCanvasUi} from '../shared/canvas-ui.mjs';
import {createAssetCatalog,createImageAssetBroker} from '../shared/asset-encoding.js';
import {createTextureCachePolicy} from './texture-cache-policy.js';
import {createSpriteResourcePool} from './sprite-resources.js';
const A='texture://cache/a',B='texture://cache/b',C='texture://cache/c';
const node=asset=>({kind:'image',id:asset,asset,fit:'stretch',rect:{x:0,y:0,width:20,height:20}});
const tree=ids=>({children:ids.map(node)});
async function fixture({policy={max_bytes:32,max_entries:2,idle_frames:3},pinDecoded=false,failUpload=false}={}){
 let loads=0,closes=0,uploads=0,scene=null,broker,catalog,scopeRead=null;const textures=new Set(),pins=[];
 function replace(){catalog=createAssetCatalog({assets:[A,B,C].map(id=>({id,kind:'texture2d',source:id+'.png'}))});broker=createImageAssetBroker(catalog,{resolveAssetUrl:a=>a.id,loadImage:async id=>{loads++;return {id,width:2,height:2,close(){closes++;}};},unusedMaxBytes:0,unusedMaxEntries:0});return broker;}
 replace();const brokers=[broker],cache=createTextureCachePolicy(new Map(),policy);
 const renderer={autoClear:true,capabilities:{maxTextureSize:4096},getDrawingBufferSize:v=>v.set(100,100),getPixelRatio:()=>1,getContext:()=>({isContextLost:()=>false}),getScissorTest:()=>false,getRenderTarget:()=>null,getViewport:v=>v.set(0,0,100,100),setRenderTarget(){},setScissorTest(){},setViewport(){},compile(){},properties:{get:()=>({currentProgram:{getUniforms(){}}})},initTexture(t){if(failUpload)throw Error('UPLOAD_FAILED');if(!textures.has(t)){textures.add(t);uploads++;}},render(s){scene=s;for(const m of s.children)if(m.visible){const t=m.material.uniforms.uiTexture.value;if(!t.isDataTexture&&!textures.has(t))this.initTexture(t);}}};
 const gpu=createGpuUi(THREE,renderer,{textureCache:cache,getImageAssets:()=>broker,getAssetCatalog:()=>{scopeRead?.();return catalog;}}),canvas=createCanvasUi(null,{getPresenter:()=>gpu,acquireAsset:id=>broker.acquire(id)});
 if(pinDecoded){const lease=broker.acquire(A);await lease.promise;pins.push(lease);}
 let frame=0;const draw=ids=>{cache.begin();cache.sweep();return canvas.draw({world:{frame:++frame,ui:tree(ids)}});};
 const directNodes=(nodes,images,imageError=()=>{})=>gpu.draw({nodes,images,batches:new Map(),scale:1,changed:true,identity:'fixture',hasText:()=>false,imageError});
 const direct=(ids,images)=>directNodes(ids.map(node),images);
 return {gpu,canvas,cache,renderer,draw,direct,directNodes,onScopeRead:fn=>scopeRead=fn,get catalog(){return catalog;},get broker(){return broker;},get meshes(){return scene?.children??[];},get image(){return scene?.children.find(m=>m.visible)?.material.uniforms.uiTexture.value;},counts:()=>({loads,closes,uploads}),replace(){const b=replace();brokers.push(b);return b;},
  async warm(ids=[A]){draw(ids);await canvas.ready();return draw(ids);},dispose(){canvas.dispose();gpu.dispose();cache.clear();for(const p of pins)p.release();for(const b of brokers)b.dispose();}};
}

test('official UI owner retains ready pixels across a composition release instead of causing another cold load',async()=>{
 const f=await fixture();try{
  assert.equal((await f.warm()).status,'completed');const mesh=f.meshes[0],texture=f.image;f.draw([]);assert.equal(mesh.visible,false);assert.notEqual(mesh.material.uniforms.uiTexture.value,texture);
  assert.equal(f.counts().closes,0,'The independent GPU owner must protect decoded pixels after Canvas releases');
  assert.equal(f.broker.report().active_entries,1);assert.equal(f.draw([A]).status,'completed');assert.equal(f.counts().loads,1);
 }finally{f.dispose();}
});
test('a decoded-warm UI A/hide/A reuses the same GPU Texture and one upload',async()=>{
 const f=await fixture({pinDecoded:true});try{
  await f.warm();const first=f.image;f.draw([]);assert.equal(f.draw([A]).status,'completed');assert.equal(f.image,first);assert.equal(f.counts().uploads,1);
 }finally{f.dispose();}
});

test('100 UI hide/show compositions reuse one texture and lease until actual idle TTL expires',async()=>{
 const f=await fixture();try{
  await f.warm();for(let i=0;i<100;i++){f.draw([]);assert.equal(f.draw([A]).status,'completed');}
  assert.deepEqual(f.counts(),{loads:1,closes:0,uploads:1});assert.equal(f.gpu.metrics().image_active_owners,1);assert.equal(f.gpu.metrics().image_idle_hits,100);
  f.draw([]);assert.equal(f.gpu.metrics().image_cached_owners,1);assert.equal(f.gpu.metrics().image_textures,1);assert.equal(f.cache.metrics().entries,1);
  for(let i=0;i<3;i++)f.draw([]);assert.equal(f.gpu.metrics().image_textures,0);assert.equal(f.cache.metrics().entries,0);assert.equal(f.counts().closes,1);
  assert.equal(f.draw([A]).reason,'ui_assets_pending');await f.canvas.ready();assert.equal(f.draw([A]).status,'completed');assert.equal(f.counts().loads,2);assert.equal(f.counts().uploads,2);
 }finally{f.dispose();}
});

test('one shared controller evicts idle UI under world pressure and never evicts currently active UI',async()=>{
 const f=await fixture({policy:{max_bytes:16,max_entries:1,idle_frames:100}});try{
  await f.warm();f.draw([]);let worldRetired=0;const world={};f.cache.trackOwner(world,{bytes:()=>16,loading:()=>false,retire:()=>worldRetired++});f.cache.sweep();
  assert.equal(f.gpu.metrics().image_textures,0);assert.equal(f.cache.metrics().entries,1);assert.equal(worldRetired,0);assert.equal(f.counts().closes,1);f.cache.untrackOwner(world);
  await f.warm([A,B]);f.cache.sweep();assert.equal(f.gpu.metrics().image_active_owners,2);assert.equal(f.cache.metrics().pressure_bytes,16);assert.equal(f.cache.metrics().entries,2);
  f.draw([]);f.draw([]);assert.equal(f.gpu.metrics().image_cached_owners,1);assert.equal(f.cache.metrics().entries,1);assert.equal(f.cache.metrics().pressure_bytes,0);
 }finally{f.dispose();}
});

test('UI leaves share one linear texture while the sprite sampler remains a separately counted physical owner',async()=>{
 const f=await fixture(),pool=createSpriteResourcePool({THREE,renderer:f.renderer,textureCache:f.cache,getCatalog:()=>f.catalog,getImages:()=>f.broker});try{
  await f.warm();const ui=f.image,frame=f.cache.frame,batch={kind:'image_batch',id:'batch',rect:{x:0,y:0,width:20,height:20},quads:[{asset:A,rect:{x:0,y:0,width:10,height:10}}]};
  f.canvas.draw({world:{ui:{children:[node(A),{...node(A),id:'second'},batch]}}});assert.equal(f.gpu.metrics().image_textures,1);assert.equal(f.cache.frame,frame,'UI must not advance the shared rendered-frame authority');
  const world=pool.public.prepare({id:'world',asset:A});await world.readyPromise;const sprite=pool.read(world).texture;
  assert.notEqual(sprite,ui);assert.equal(sprite.image,ui.image);assert.equal(ui.minFilter,THREE.LinearFilter);assert.equal(ui.colorSpace,THREE.NoColorSpace);assert.equal(ui.flipY,false);assert.equal(ui.premultiplyAlpha,true);assert.equal(ui.generateMipmaps,false);
  assert.equal(sprite.minFilter,THREE.NearestFilter);assert.equal(sprite.colorSpace,THREE.SRGBColorSpace);assert.equal(f.cache.metrics().entries,2);assert.equal(f.cache.metrics().decoded_texture_bytes_estimate,32);
  world.release();assert.equal(f.cache.metrics().entries,1);assert.equal(f.gpu.metrics().image_active_owners,1);
 }finally{pool.dispose();f.dispose();}
});

test('image-identity mismatch is never reported ready and a valid subsequent image can recover',async()=>{
 const f=await fixture();try{
  await f.warm();const old=f.image;let disposed=0;old.addEventListener('dispose',()=>disposed++);
  assert.throws(()=>f.direct([A],new Map([[A,{image:{width:2,height:2}}]])),/LEASE_NOT_READY_OR_CHANGED/);
  assert.equal(disposed,1);assert.equal(f.gpu.metrics().image_textures,0);assert.equal(f.cache.metrics().entries,0);assert.equal(f.counts().closes,0);
  assert.equal(f.draw([A]).status,'completed');assert.notEqual(f.image,old);assert.equal(f.counts().loads,1);
 }finally{f.dispose();}
});

test('broker/catalog replacement fences the old scope and requires actual new ready pixels',async()=>{
 const f=await fixture();try{
  await f.warm();const old=f.image;f.replace();assert.throws(()=>f.draw([A]),/LEASE_NOT_READY_OR_CHANGED/);assert.equal(f.gpu.metrics().image_textures,0);
  f.canvas.invalidateAssets();await f.canvas.ready();assert.equal(f.draw([A]).status,'completed');assert.notEqual(f.image,old);assert.equal(f.gpu.metrics().image_textures,1);
 }finally{f.dispose();}
});

test('later resource failure rolls back newly staged owners and preserves unrelated committed owners',async()=>{
 const f=await fixture({policy:{max_bytes:128,max_entries:8,idle_frames:3}});let pin;try{
  await f.warm([C]);const committed=f.image;pin=f.broker.acquire(A);await pin.promise;
  assert.throws(()=>f.direct([A,B],new Map([[A,{image:pin.image}],[B,{image:{width:2,height:2}}]])),/LEASE_NOT_READY_OR_CHANGED/);
  assert.equal(f.gpu.metrics().image_textures,1);assert.equal(f.gpu.metrics().image_active_owners,1);assert.equal(f.cache.metrics().entries,1);assert.equal(f.gpu.metrics().image_bytes_estimate,16);
  assert.equal(f.draw([C]).status,'completed');assert.equal(f.image,committed);assert.equal(f.gpu.metrics().image_owners_retired,1);
 }finally{pin?.release();f.dispose();}
});

test('upload failure releases the independent lease and cannot publish an untracked UI owner',async()=>{
 const f=await fixture({failUpload:true});let retired=0;f.renderer.initTexture=texture=>{texture.addEventListener('dispose',()=>retired++);throw Error('UPLOAD_FAILED');};
 try{await assert.rejects(f.warm(),/UPLOAD_FAILED/);assert.equal(retired,1);assert.equal(f.cache.metrics().entries,0);assert.equal(f.gpu.metrics().image_textures,0);assert.equal(f.counts().closes,0);f.canvas.dispose();assert.equal(f.counts().closes,1);}
 finally{f.dispose();}
});

test('context/clear retirement unpublishes owners before callbacks, attempts all, and preserves separate Canvas pixels',async()=>{
 const f=await fixture();try{
  await f.warm([A,B]);const textures=f.meshes.map(m=>m.material.uniforms.uiTexture.value);let disposed=0;
  for(const texture of textures)texture.addEventListener('dispose',()=>{disposed++;assert.equal(f.gpu.metrics().image_textures,0);assert.throws(()=>f.direct([],new Map()),/RETIRING/);if(disposed===1)throw Error('FIRST_DISPOSE_FAILED');});
  assert.throws(()=>f.gpu.contextLost(),/FIRST_DISPOSE_FAILED/);assert.equal(disposed,2);assert.equal(f.cache.metrics().entries,0);assert.equal(f.gpu.metrics().image_active_owners,0);assert.equal(f.gpu.metrics().image_cached_owners,0);assert.equal(f.counts().closes,0);
  assert.equal(f.draw([A,B]).status,'completed');assert.equal(f.counts().loads,2);assert.equal(f.gpu.metrics().image_texture_builds,4);
 }finally{f.dispose();}
});

test('a context retirement inside upload cannot publish its late old-epoch texture',async()=>{
 const f=await fixture();const upload=f.renderer.initTexture;f.renderer.initTexture=texture=>{upload(texture);f.gpu.contextLost();};try{
  await assert.rejects(f.warm(),/CANCELLED/);assert.equal(f.gpu.metrics().image_textures,0);assert.equal(f.cache.metrics().entries,0);
  f.renderer.initTexture=upload;assert.equal(f.draw([A]).status,'completed');assert.equal(f.gpu.metrics().image_texture_builds,1);assert.equal(f.counts().loads,1);
 }finally{f.dispose();}
});

test('cached texture disposal failure still releases its final broker lease and cannot resurrect during retirement',async()=>{
 const f=await fixture();try{
  await f.warm();const texture=f.image;f.draw([]);texture.addEventListener('dispose',()=>{assert.throws(()=>f.direct([],new Map()),/RETIRING/);throw Error('DISPOSE_FAILED');});
  assert.throws(()=>f.cache.clear(),/DISPOSE_FAILED/);assert.equal(f.gpu.metrics().image_textures,0);assert.equal(f.gpu.metrics().image_bytes_estimate,0);assert.equal(f.broker.report().active_entries,0);assert.equal(f.counts().closes,1);
  f.gpu.dispose();assert.equal(f.gpu.draw({}).skipped,true);assert.equal(f.gpu.target(),null);assert.equal(f.counts().loads,1);
 }finally{f.dispose();}
});

test('same-epoch upload reentry cannot publish a second pinned owner for the same asset',async()=>{
 const f=await fixture(),upload=f.renderer.initTexture;let once=true,blocked=false;
 f.renderer.initTexture=texture=>{upload(texture);if(once){once=false;try{f.direct([A],new Map([[A,{image:texture.image}]]));}catch(error){assert.match(error.message,/REENTRANT/);blocked=true;}}};
 try{await f.warm();assert.equal(blocked,true);assert.equal(f.gpu.metrics().image_textures,1);assert.equal(f.cache.metrics().entries,1);assert.equal(f.gpu.metrics().image_active_owners,1);assert.equal(f.counts().uploads,1);
  f.gpu.clear();assert.equal(f.cache.metrics().entries,0);assert.equal(f.gpu.metrics().image_bytes_estimate,0);assert.equal(f.gpu.metrics().image_active_owners,0);
 }finally{f.dispose();}
});

test('cached owner remains pinned when a crop-diagnostic callback attempts a nested empty draw',async()=>{
 const f=await fixture();try{
  await f.warm();const image=f.image.image;f.draw([]);let nested=false,blocked=false;
  const invalid={...node(A),slice:{left:2,right:1,top:0,bottom:0,pixels_per_unit:1}},valid={...node(A),id:'valid'};
  f.directNodes([invalid,valid],new Map([[A,{image}]]),()=>{nested=true;try{f.direct([],new Map());}catch(error){assert.match(error.message,/REENTRANT/);blocked=true;}});
  assert.equal(nested,true);assert.equal(f.gpu.metrics().image_active_owners,1);assert.equal(f.gpu.metrics().image_cached_owners,0);assert.equal(f.cache.metrics().pinned_bytes_estimate,16);assert.equal(blocked,true);
  for(let i=0;i<4;i++){f.cache.begin();f.cache.sweep();}assert.equal(f.gpu.metrics().image_textures,1);assert.equal(f.counts().closes,0);
 }finally{f.dispose();}
});

test('scope getter context retirement cancels this draw before republishing GPU ownership',async()=>{
 const f=await fixture();try{await f.warm();f.onScopeRead(()=>{f.onScopeRead(null);f.gpu.contextLost();});assert.equal(f.draw([A]).status,'skipped');assert.equal(f.gpu.metrics().image_textures,0);assert.equal(f.cache.metrics().entries,0);
  assert.equal(f.draw([A]).status,'completed');assert.equal(f.counts().loads,1);
 }finally{f.dispose();}
});

test('render callback nested draw is fenced and context retirement cannot return a completed UI pass',async()=>{
 const f=await fixture(),render=f.renderer.render;let blocked=false;
 f.renderer.render=scene=>{render(scene);try{f.direct([],new Map());}catch(error){assert.match(error.message,/REENTRANT/);blocked=true;}f.gpu.contextLost();};
 try{f.draw([A]);await f.canvas.ready();assert.equal(f.draw([A]).status,'skipped');assert.equal(blocked,true);assert.equal(f.cache.metrics().entries,0);f.renderer.render=render;assert.equal(f.draw([A]).status,'completed');assert.equal(f.counts().loads,1);}
 finally{f.dispose();}
});
