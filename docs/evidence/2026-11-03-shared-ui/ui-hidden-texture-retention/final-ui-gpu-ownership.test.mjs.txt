import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import {createGpuUi} from './ui-gpu.js';
import {createAssetCatalog,createImageAssetBroker} from '../shared/asset-encoding.js';

// Actual presenter/Three objects, with no GPU, DOM, raster-quality or GC claim.
async function fixture({maxTextureSize=8}={}){
 const images=new Map(),leases=[],closed=[],surfaces=[];let scene=null,renders=0,failPaint=false;
 const catalog=createAssetCatalog({assets:['a','b'].map(id=>({id,kind:'texture2d',source:id+'.png'}))});
 const broker=createImageAssetBroker(catalog,{resolveAssetUrl:a=>a.source,loadImage:async id=>({id,width:2,height:2,close(){closed.push(id);}}),unusedMaxBytes:0,unusedMaxEntries:0});
 for(const id of ['a','b']){const lease=broker.acquire(id);leases.push(lease);await lease.promise;images.set(id,{image:lease.image});}
 const createSurface=()=>{const canvas={width:1,height:1},context={setTransform(){},clearRect(){},save(){},restore(){},beginPath(){},rect(){},clip(){},fillText(){},getImageData(_x,_y,w,h){return {data:new Uint8ClampedArray(w*h*4)};}};canvas.getContext=()=>context;surfaces.push(canvas);return canvas;};
 const gl={isContextLost:()=>false,pixelStorei(){},texSubImage2D(){}};
 const renderer={autoClear:true,capabilities:{maxTextureSize},getDrawingBufferSize:v=>v.set(64,64),getPixelRatio:()=>1,
  getContext:()=>gl,state:{bindTexture(){}},properties:{get:texture=>({__webglTexture:texture})},getScissorTest:()=>false,getRenderTarget:()=>null,getViewport:v=>v.set(0,0,64,64),
  setRenderTarget(){},setScissorTest(){},setViewport(){},initTexture(){},render(value){scene=value;renders++;}};
 const ui=createGpuUi(THREE,renderer,{createSurface});
 const image=id=>({kind:'image',id,asset:id,fit:'stretch',rect:{x:0,y:0,width:10,height:10}});
 // 16px wide against an 8px atlas forces the real dedicated-text path.
 const text=(value='old')=>({kind:'text',id:'label',text:value,rect:{x:0,y:25,width:25,height:25}});
 const draw=nodes=>ui.draw({nodes,nodeKeys:nodes.map(n=>JSON.stringify(n)),batches:new Map(),images,scale:1,changed:true,identity:'fixed-font',hasText:n=>n.kind==='text',paintText(){if(failPaint)throw Error('PAINT_FAILED');},imageError(_node,_index,error){throw error;}});
 return {ui,broker,images,leases,closed,surfaces,image,text,draw,get renders(){return renders;},get meshes(){return scene?.children??[];},failPaint(){failPaint=true;},
  dispose(){ui.dispose();for(const lease of leases)lease.release();broker.dispose();}};
}
const sampler=mesh=>mesh.material.uniforms.uiTexture.value;
function watch(texture){let count=0;texture.addEventListener('dispose',()=>count++);return ()=>count;}

test('shrinking UI runs detach retired image/dedicated samplers while preserving active ownership',async()=>{
 const f=await fixture();try{
  f.draw([f.image('a'),f.image('b'),f.text()]);const meshes=[...f.meshes],textures=meshes.map(sampler),disposed=textures.map(watch);
  meshes[1].material.map=textures[1];
  f.draw([f.image('a')]);assert.equal(sampler(meshes[0]),textures[0]);assert.equal(meshes[0].visible,true);
  for(let i=1;i<meshes.length;i++){assert.equal(meshes[i].visible,false);assert.notEqual(sampler(meshes[i]),textures[i],'An inactive engine run must not retain retired CPU image/canvas through its sampler');}
  assert.equal(meshes[1].material.map,null);assert.deepEqual(disposed.map(read=>read()),[0,1,1]);assert.deepEqual(f.closed,[]);assert(f.leases.every(l=>l.state==='ready'));
  assert.equal(f.ui.metrics().image_textures,1);assert.equal(f.ui.metrics().dedicated_text_textures,0);
 }finally{f.dispose();}
});

test('an empty UI composition clears every old sampler even when no new render call occurs',async()=>{
 const f=await fixture();try{
  f.draw([f.image('a'),f.text()]);const meshes=[...f.meshes],old=meshes.map(sampler),renders=f.renders;
  f.draw([]);assert.equal(f.renders,renders);assert.equal(f.ui.metrics().quads,0);
  for(let i=0;i<meshes.length;i++){assert.equal(meshes[i].visible,false);assert.notEqual(sampler(meshes[i]),old[i]);}
  assert.equal(f.ui.metrics().image_textures,0);assert.equal(f.ui.metrics().dedicated_text_textures,0);assert.deepEqual(f.closed,[]);
 }finally{f.dispose();}
});

test('next reuse preserves reusable geometry/materials and binds only newly live textures',async()=>{
 const f=await fixture();try{
  f.draw([f.image('a'),f.image('b'),f.text()]);const meshes=[...f.meshes],materials=meshes.map(m=>m.material),geometries=meshes.map(m=>m.geometry),old=meshes.map(sampler),retired=old.map(watch);
  f.draw([f.image('a')]);f.draw([f.image('a'),f.image('b'),f.text('new')]);
  assert.deepEqual(f.meshes,meshes);for(let i=0;i<meshes.length;i++){assert.equal(meshes[i].material,materials[i]);assert.equal(meshes[i].geometry,geometries[i]);assert.equal(meshes[i].visible,true);}
  assert.equal(sampler(meshes[0]),old[0]);assert.notEqual(sampler(meshes[1]),old[1]);assert.notEqual(sampler(meshes[2]),old[2]);assert.deepEqual(retired.map(read=>read()),[0,1,1]);assert.deepEqual(f.closed,[]);
 }finally{f.dispose();}
});

test('shared A/B/A runs detach only the hidden borrower and preserve the still-live A sampler',async()=>{
 const f=await fixture();try{
  f.draw([f.image('a'),f.image('b'),{...f.image('a'),id:'a-again'}]);const meshes=[...f.meshes],a=sampler(meshes[0]),b=sampler(meshes[1]),aDisposed=watch(a),bDisposed=watch(b);
  assert.equal(sampler(meshes[2]),a);f.draw([f.image('a')]);
  assert.equal(sampler(meshes[0]),a);assert.notEqual(sampler(meshes[2]),a);assert.equal(aDisposed(),0);assert.equal(bDisposed(),1);
  f.draw([]);assert.equal(aDisposed(),1);for(const mesh of meshes)assert.notEqual(sampler(mesh),a);assert.deepEqual(f.closed,[]);
 }finally{f.dispose();}
});

test('hidden atlas borrowers detach without evicting cached text; context loss retires the page once',async()=>{
 const f=await fixture({maxTextureSize:64});try{
  f.draw([f.text(),f.image('a'),{...f.text('second'),id:'second'}]);const meshes=[...f.meshes],page=sampler(meshes[0]),disposed=watch(page);
  assert.equal(sampler(meshes[2]),page);assert.equal(f.ui.metrics().atlas_pages,1);assert.equal(f.ui.metrics().dedicated_text_textures,0);
  f.draw([]);for(const mesh of meshes)assert.notEqual(sampler(mesh),page);assert.equal(disposed(),0);assert.equal(f.ui.metrics().text_slots,2);
  f.ui.contextLost();assert.equal(disposed(),1);assert.equal(f.ui.metrics().atlas_pages,0);f.draw([f.text('restored')]);assert.notEqual(sampler(f.meshes[0]),page);assert.equal(f.ui.metrics().atlas_pages,1);
 }finally{f.dispose();}
});

test('a failed dedicated text raster leaves its preceding complete sampler and texture alive',async()=>{
 const f=await fixture();try{
  f.draw([f.text()]);const mesh=f.meshes[0],before=sampler(mesh),disposed=watch(before),renders=f.renders;
  f.failPaint();assert.throws(()=>f.draw([f.text('replacement')]),/PAINT_FAILED/);
  assert.equal(f.renders,renders);assert.equal(sampler(mesh),before);assert.equal(disposed(),0);assert.equal(f.ui.metrics().dedicated_text_textures,1);
 }finally{f.dispose();}
});

for(const method of ['clear','contextLost','dispose'])test(`${method} detaches all sampler references before physical texture disposal`,async()=>{
 const f=await fixture();try{
  f.draw([f.image('a'),f.text()]);const meshes=[...f.meshes],textures=meshes.map(sampler),disposed=textures.map(watch);
  for(const texture of textures)texture.addEventListener('dispose',()=>{for(const mesh of meshes)assert.notEqual(sampler(mesh),texture,'Retirement callbacks must not observe a run still borrowing the retiring image');});
  f.ui[method]();assert.deepEqual(disposed.map(read=>read()),[1,1]);assert.equal(f.ui.metrics().image_textures,0);assert.equal(f.ui.metrics().dedicated_text_textures,0);assert.deepEqual(f.closed,[]);
  if(method!=='dispose'){f.draw([f.image('a'),f.text('restored')]);assert.equal(f.ui.metrics().image_textures,1);assert.equal(f.ui.metrics().dedicated_text_textures,1);}
 }finally{f.dispose();}
});
