import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import {createAssetCatalog,createImageAssetBroker} from '../shared/asset-encoding.js';
const {createSpriteResourcePool}=await import(process.env.UNONE_SPRITE_RESOURCE_MODULE??'./sprite-resources.js');
import {createSpritePresentation} from './sprite-presentation.js';
import {createTextureCachePolicy} from './texture-cache-policy.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const definition=value=>({fragment:'vec4 unoneShade(vec2 uv,vec4 color){return color*strength;}',uniforms:{strength:value,tint:[1,.5,.25]}});
function fixture({pending=[],budget={max_bytes:128,max_entries:8},texturePolicy,failCompile=false,failMaterialId=null,failUpload=false,failFirstUse=false,inspectImage=async()=>({format:'png',width:2,height:2}),imageSize={width:2,height:2},legacy=null,throwImageRelease=false,withPreparationTargets}={}){
 const catalog=createAssetCatalog({assets:['a','b','c'].map(id=>({id,kind:'texture2d',source:id+'.png',encoding:{decoder:'image',format:'png',mime:'image/png'}}))});
 const waits=new Map(pending.map(id=>[id,deferred()])),loads=[],closed=[],uploads=[],compiles=[];
 const image=id=>({...imageSize,id,close(){closed.push(id);}});
 const broker=createImageAssetBroker(catalog,{resolveAssetUrl:a=>a.id,inspectImage,loadImage:async(id)=>{loads.push(id);return waits.has(id)?waits.get(id).promise:image(id);},unusedMaxBytes:0,unusedMaxEntries:0});
 const renderer={capabilities:{maxTextureSize:2048},initTexture:texture=>{uploads.push(texture);if(failUpload)throw Error('TEXTURE_UPLOAD_FAILED');},compile:scene=>{const material=scene.children[0].material;compiles.push(material);if(failCompile||material.name===`unone-shader:${failMaterialId}`)throw Error('SHADER_COMPILE_FAILED');},properties:{get(){return {currentProgram:{getUniforms(){if(failFirstUse)throw Error('SHADER_LINK_FAILED_ON_FIRST_USE');}}};}}};
 const root=new THREE.Group(),geometry=new THREE.PlaneGeometry(1,1),records=new Map();let presenter;
 const images=throwImageRelease?{inspect:broker.inspect,acquire(id){const lease=broker.acquire(id);return {get state(){return lease.state;},get image(){return lease.image;},get error(){return lease.error;},promise:lease.promise,release(){lease.release();if(id==='a')throw Error('IMAGE_RELEASE_HOOK_FAILED');}};}}:broker;
 const textureCache=createTextureCachePolicy(new Map(),texturePolicy);
 const pool=createSpriteResourcePool({THREE,renderer,textureCache,getCatalog:()=>catalog,getImages:()=>images,budget,onReset:()=>presenter?.reset(),withPreparationTargets});
 const recordFor=entity=>{let record=records.get(entity.id);if(!record){const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material);record={mesh,material};records.set(entity.id,record);root.add(mesh);}return record;};
 presenter=createSpritePresentation({THREE,root,geometry,records,recordFor,resources:pool,legacy});
 return {pool,presenter,textureCache,records,geometry,broker,loads,closed,uploads,compiles,resolve:id=>waits.get(id).resolve(image(id)),
  dispose(){pool.dispose();geometry.dispose();broker.dispose();}};
}
const entity=(asset='a',extra={})=>({id:'slot',transform:{x:0,y:0},sprite:{asset,sheet:{columns:2,rows:1},frame:0},shader_material:'test',...extra});
const world=(e,value=.25)=>({frame:1,time_seconds:0,entities:{[e.id]:e},shader_materials:{test:definition(value)}});
const uv=record=>Array.from(record.mesh.geometry.attributes.uv.array);

test('real broker + presenter retain COMPLETE old appearance until replacement GPU preparation and use latest values',async()=>{
 const f=fixture({pending:['b']});try{
  let w=world(entity());assert.equal(f.presenter.draw(w),false);await f.pool.ready();assert.equal(f.presenter.draw(w),true);
  const r=f.records.get('slot'),before={map:r.material.uniforms.unone_texture.value,uv:uv(r),strength:r.material.uniforms.strength.value,x:r.mesh.position.x};
  w=world(entity('b',{transform:{x:10,y:4},sprite:{asset:'b',sheet:{columns:1,rows:2},frame:1}}),.75);
  assert.equal(f.presenter.draw(w),false);await flush();assert.deepEqual({map:r.material.uniforms.unone_texture.value,uv:uv(r),strength:r.material.uniforms.strength.value,x:r.mesh.position.x},before);
  w.entities.slot.transform.x=12;w.shader_materials.test.uniforms.strength=.9;f.presenter.draw(w);f.resolve('b');await f.pool.ready();
  assert.equal(f.presenter.draw(w),true);assert.equal(r.mesh.position.x,12);assert.equal(r.material.uniforms.strength.value,.9);assert.notEqual(r.material.uniforms.unone_texture.value,before.map);assert.notDeepEqual(uv(r),before.uv);assert.deepEqual(f.loads,['a','b']);
 }finally{f.dispose();}
});

test('public lease is opaque, shared by12 slots with independent uniforms, caller release preserves committed ownership',async()=>{
 const f=fixture();try{
  const lease=f.pool.public.prepare({id:'1',asset:'a',material_id:'test',material:definition(.25)});await lease.readyPromise;
  assert(!Object.hasOwn(lease,'texture')&&!Object.hasOwn(lease,'material'));assert.equal(lease.bytes,16);
  const w={frame:1,entities:{}};for(let i=0;i<12;i++)w.entities['s'+i]=entity('a',{id:'s'+i,sprite_appearance:{resource:'1',revision:1},sprite_uniforms:{strength:i/12,tint:[1,i/12,.25]}});
  assert(f.presenter.draw(w));assert.deepEqual(f.pool.public.takeUpdates().appearances,[]);f.presenter.submitted();assert.equal(f.pool.public.takeUpdates().appearances.length,12);
  const rs=[...f.records.values()];assert.notEqual(rs[0].material,rs[1].material);assert.equal(rs[0].material.uniforms.unone_texture.value,rs[1].material.uniforms.unone_texture.value);assert.notEqual(rs[0].material.uniforms.tint.value,rs[1].material.uniforms.tint.value);
  lease.release();assert.equal(lease.state,'released');w.entities.s0.transform.x=9;assert(f.presenter.draw(w));assert.equal(rs[0].mesh.position.x,9);assert.equal(f.loads.length,1);
 }finally{f.dispose();}
});

test('hard admission rejects incoming payload BEFORE decode and preserves old active resource',async()=>{
 const f=fixture({budget:{max_bytes:16,max_entries:2}});try{
  const a=f.pool.public.prepare({id:'1',asset:'a'});await a.readyPromise;
  const b=f.pool.public.prepare({id:'2',asset:'b'});await assert.rejects(b.readyPromise,/BUDGET_EXCEEDED/);assert.deepEqual(f.loads,['a']);assert.equal(a.state,'ready');assert.equal(f.pool.metrics().cpu_reserved_bytes_estimate,16);
 }finally{f.dispose();}
});

test('A→Bpending→A cancels obsolete owner; late pixels do not build GPU resources',async()=>{
 const f=fixture({pending:['b']});try{
  const a=world(entity());f.presenter.draw(a);await f.pool.ready();f.presenter.draw(a);
  f.presenter.draw(world(entity('b')));await flush();f.presenter.draw(a);const count=f.uploads.length;f.resolve('b');await flush();assert.equal(f.uploads.length,count);assert.equal(f.records.get('slot').material.uniforms.unone_texture.value.image.id,'a');assert.deepEqual(f.closed,['b']);
 }finally{f.dispose();}
});

test('hide/reset/dispose fence pending callbacks; context restore keeps CPU images and invalidates readiness epoch',async()=>{
 const f=fixture({pending:['b']});
 const a=f.pool.public.prepare({id:'1',asset:'a'});await a.readyPromise;const epoch=a.epoch,loads=f.loads.length;
 f.pool.contextLost();assert.equal(a.state,'loading');assert(a.epoch>epoch);f.pool.contextRestored();await a.readyPromise;assert.equal(f.loads.length,loads);
 f.presenter.draw(world(entity('b')));await flush();f.presenter.draw(world(entity('b',{sprite:{asset:'b',visible:false}})));f.resolve('b');await flush();assert.equal(f.records.get('slot').mesh.visible,false);
 f.pool.public.reset();assert.equal(f.records.size,0);f.dispose();assert.throws(()=>f.pool.public.prepare({id:'3',asset:'a'}),/DISPOSED/);
});

test('unchanged100A/B switches reuse two resources; shader failure retires staged ownership and emits error',async()=>{
 const f=fixture();try{for(const asset of ['a','b']){const l=f.pool.public.prepare({id:asset,asset,material_id:'test',material:definition(.25)});await l.readyPromise;}
  for(let i=0;i<100;i++)assert(f.presenter.draw(world(entity(i%2?'b':'a'))));assert.equal(f.loads.length,2);assert.equal(f.uploads.length,2);assert.equal(f.compiles.length,2);
 }finally{f.dispose();}
 const bad=fixture({failCompile:true});try{const l=bad.pool.public.prepare({id:'1',asset:'a'});await assert.rejects(l.readyPromise,/COMPILE_FAILED/);assert.equal(l.state,'error');assert.equal(bad.pool.metrics().gpu_reserved_bytes_estimate,0);assert.equal(bad.pool.public.takeUpdates().resources[0].state,'error');}finally{bad.dispose();}
});

test('managed material source/defaults stay captured while resolved instance values remain independent',async()=>{
 const f=fixture();try{
  const original=definition(.25),lease=f.pool.public.prepare({id:'1',asset:'a',material_id:'test',material:original});await lease.readyPromise;
  const w=world(entity('a',{sprite_appearance:{resource:'1',revision:1},sprite_uniforms:{strength:.7,tint:[.2,.3,.4]}}));
  w.shader_materials.test={fragment:'vec4 unoneShade(vec2 uv,vec4 color){return vec4(0.0);}',uniforms:{unrelated:1}};
  original.fragment='mutated after preparation';original.uniforms.strength=.1;original.uniforms.tint[0]=0;
  assert(f.presenter.draw(w));const material=f.records.get('slot').material;
  assert(material.fragmentShader.includes('color*strength'));assert.equal(material.uniforms.strength.value,.7);
  assert.deepEqual(material.uniforms.tint.value,[.2,.3,.4]);assert.equal(f.compiles.length,1);
 }finally{f.dispose();}
});

test('hidden appearance receipts wait for completed submission and context loss never presents disposed pixels',async()=>{
 const f=fixture();try{
  const lease=f.pool.public.prepare({id:'1',asset:'a'});await lease.readyPromise;
  const w=world(entity('a',{shader_material:undefined,sprite_appearance:{resource:'1',revision:1}}));
  assert(f.presenter.draw(w));f.presenter.submitted();f.pool.public.takeUpdates();
  w.entities.slot.sprite.visible=false;w.entities.slot.sprite_appearance.revision=2;
  assert(f.presenter.draw(w));assert.equal(f.records.get('slot').mesh.visible,false);
  assert.deepEqual(f.pool.public.takeUpdates().appearances,[]);f.presenter.submitted();
  assert.deepEqual(f.pool.public.takeUpdates().appearances,[{entity:'slot',revision:2,state:'submitted',epoch:1}]);
  w.entities.slot.sprite.visible=true;assert(f.presenter.draw(w));f.pool.contextLost();
  assert.equal(f.presenter.draw(w),false);assert.equal(f.records.get('slot').mesh.visible,false);
 }finally{f.dispose();}
});

test('resource errors are nonempty bounded UTF8 metadata without leaking host error fields',async()=>{
 const f=fixture();try{
  const lease=f.pool.public.prepare({id:'1',asset:'missing'});
  assert.fail('unknown catalog asset must reject synchronously');
 }catch(error){assert.match(error.message,/ASSET_INVALID/);}finally{f.dispose();}
 const catalog=createAssetCatalog({assets:[{id:'a',kind:'texture2d',source:'a.png'}]});
 const broker=createImageAssetBroker(catalog,{resolveAssetUrl:a=>a.id,inspectImage:async()=>({format:'png',width:2,height:2}),loadImage:async()=>({width:2,height:2})});
 const pool=createSpriteResourcePool({THREE,renderer:{capabilities:{maxTextureSize:2048},initTexture(){},compile(){const e=Error('😀'.repeat(5000));e.glPrivate={};throw e;}},textureCache:createTextureCachePolicy(new Map()),getCatalog:()=>catalog,getImages:()=>broker});
 try{const lease=pool.public.prepare({id:'1',asset:'a'});await assert.rejects(lease.readyPromise);assert.equal(typeof lease.error,'string');
  const row=pool.public.takeUpdates().resources[0];assert(new TextEncoder().encode(row.error).length<=4096);assert(row.error.length>0);assert(!Object.hasOwn(row,'glPrivate'));
 }finally{pool.dispose();broker.dispose();}
});

test('unknown header metadata uses explicit ordinary fallback but cannot mark a managed lease ready',async()=>{
 let calls=0;const f=fixture({inspectImage:async()=>null,legacy(record){calls++;record.mesh.visible=true;return true;}});
 try{
  const w=world(entity());assert.equal(f.presenter.draw(w),false);await f.pool.ready();
  assert.equal(f.presenter.draw(w),true);assert.equal(calls,1);assert(f.presenter.legacyEntities().has('slot'));
  assert.equal(f.pool.metrics().builds,0);assert.equal(f.loads.length,0);
  for(let i=0;i<10;i++)assert(f.presenter.draw(w));assert.equal(calls,11);
  const lease=f.pool.public.prepare({id:'1',asset:'b'});await assert.rejects(lease.readyPromise,/DIMENSIONS_UNAVAILABLE/);
  assert.equal(lease.state,'error');assert.equal(f.pool.metrics().builds,0);assert.equal(f.loads.length,0);
 }finally{f.dispose();}
});

test('JPEG orientation may swap decoded dimensions without bypassing the same RGBA reservation',async()=>{
 const f=fixture({budget:{max_bytes:24,max_entries:1},inspectImage:async()=>({format:'jpeg',width:2,height:3}),imageSize:{width:3,height:2}});
 try{const lease=f.pool.public.prepare({id:'1',asset:'a'});await lease.readyPromise;assert.equal(lease.state,'ready');assert.equal(lease.bytes,24);assert.equal(f.pool.metrics().gpu_reserved_bytes_estimate,24);}
 finally{f.dispose();}
});

test('successful compile submission cannot report ready before lazy Three program link validation',async()=>{
 const f=fixture({failFirstUse:true});try{
  const lease=f.pool.public.prepare({id:'1',asset:'a',material_id:'test',material:definition(.25)});
  await assert.rejects(lease.readyPromise,/LINK_FAILED_ON_FIRST_USE/);assert.equal(f.compiles.length,1);
  assert.equal(lease.state,'error');assert.equal(f.pool.metrics().live_textures,0);assert.equal(f.pool.metrics().image_leases,0);
  assert.equal(f.pool.public.takeUpdates().resources[0].state,'error');
 }finally{f.dispose();}
});

test('completed scene-disabled frames acknowledge authored hidden absence but never a suppressed visible sprite',()=>{
 const f=fixture();try{
  const shown=entity('a',{id:'shown',sprite_appearance:{resource:'1',revision:1}});
  const hidden=entity('b',{id:'hidden',sprite:{asset:'b',visible:false},sprite_appearance:{resource:'2',revision:2}});
  assert(f.presenter.draw({entities:{shown,hidden}},false));assert.equal(f.loads.length,0);
  f.presenter.submitted(false);assert.deepEqual(f.pool.public.takeUpdates(),{resources:[],appearances:[{entity:'hidden',revision:2,state:'submitted',epoch:1}]});
  f.presenter.submitted(false);assert.deepEqual(f.pool.public.takeUpdates().appearances,[]);
 }finally{f.dispose();}
});

test('first sheet allocation failure cannot partially replace a displayed texture or uniforms',async()=>{
 const f=fixture();try{
  for(const asset of ['a','b'])await f.pool.public.prepare({id:asset,asset,material_id:'test',material:definition(.25)}).readyPromise;
  const a=world(entity('a',{sprite:{asset:'a'},sprite_appearance:{resource:'a',revision:1},sprite_uniforms:{strength:.25,tint:[1,.5,.25]}}));
  assert(f.presenter.draw(a));const record=f.records.get('slot'),old={texture:record.material.uniforms.unone_texture.value,strength:record.material.uniforms.strength.value,geometry:record.mesh.geometry,x:record.mesh.position.x};
  const b=world(entity('b',{transform:{x:10,y:4},sprite:{asset:'b',sheet:{columns:2,rows:1},frame:1},sprite_appearance:{resource:'b',revision:2},sprite_uniforms:{strength:.75,tint:[.1,.2,.3]}}));
  const clone=f.geometry.clone;f.geometry.clone=()=>{throw Error('CELL_ALLOCATION_FAILED');};
  assert.equal(f.presenter.draw(b),false);assert.equal(record.mesh.visible,true);
  assert.deepEqual({texture:record.material.uniforms.unone_texture.value,strength:record.material.uniforms.strength.value,geometry:record.mesh.geometry,x:record.mesh.position.x},old);
  f.geometry.clone=clone;assert(f.presenter.draw(b));assert.equal(record.mesh.position.x,10);assert.equal(record.material.uniforms.strength.value,.75);
 }finally{f.dispose();}
});

test('reset attempts every GPU/image retirement and fences leases even when first disposal and release throw',async()=>{
 const f=fixture({throwImageRelease:true});try{
  const a=f.pool.public.prepare({id:'1',asset:'a'}),b=f.pool.public.prepare({id:'2',asset:'b'});await Promise.all([a.readyPromise,b.readyPromise]);
  let secondDisposed=0;f.compiles[0].addEventListener('dispose',()=>{throw Error('GPU_RELEASE_HOOK_FAILED');});f.compiles[1].addEventListener('dispose',()=>secondDisposed++);
  assert.throws(()=>f.pool.public.reset(),/GPU_RELEASE_HOOK_FAILED/);assert.equal(secondDisposed,1);assert.equal(a.state,'released');assert.equal(b.state,'released');
  const report=f.pool.metrics();assert.equal(report.entries,0);assert.equal(report.image_leases,0);assert.equal(report.cpu_reserved_bytes_estimate,0);assert.equal(report.handles,0);assert.deepEqual(f.pool.public.takeUpdates(),{resources:[],appearances:[]});assert.deepEqual(f.closed,['a','b']);
  await assert.rejects(a.readyPromise,/RELEASED/);await assert.rejects(b.readyPromise,/RELEASED/);
 }finally{f.dispose();}
});

test('context loss fences ALL entries before throwing retirement and restores without new image decodes',async()=>{
 const f=fixture();try{
  const a=f.pool.public.prepare({id:'1',asset:'a'}),b=f.pool.public.prepare({id:'2',asset:'b'});await Promise.all([a.readyPromise,b.readyPromise]);const previous=a.epoch;
  f.compiles[0].addEventListener('dispose',()=>{throw Error('LOST_DISPOSE_FAILED');});assert.throws(()=>f.pool.contextLost(),/LOST_DISPOSE_FAILED/);
  assert(a.epoch>previous);assert.equal(a.state,'loading');assert.equal(b.state,'loading');assert.equal(f.pool.metrics().live_textures,0);assert.equal(f.pool.metrics().image_leases,2);
  await assert.rejects(a.readyPromise,/NOT_READY/);await assert.rejects(b.readyPromise,/NOT_READY/);
  assert.deepEqual(f.pool.public.takeUpdates().resources.map(x=>x.state),['loading','loading']);f.pool.contextRestored();await Promise.all([a.readyPromise,b.readyPromise]);assert.equal(f.loads.length,2);
 }finally{f.dispose();}
});

test('every known screen/offscreen preparation variant is compiled and first-use checked before readiness',async()=>{
 let visits=0;const f=fixture({withPreparationTargets:compile=>{for(const _target of ['screen','linear']){visits++;compile();}}});
 try{const lease=f.pool.public.prepare({id:'1',asset:'a'});await lease.readyPromise;assert.equal(visits,2);assert.equal(f.compiles.length,2);assert.equal(f.uploads.length,1);assert.equal(lease.state,'ready');}
 finally{f.dispose();}
});

test('two distinct materials share one asset texture and reservation; only the final owner retires pixels',async()=>{
 const f=fixture({budget:{max_bytes:16,max_entries:1}});try{
  const a=f.pool.public.prepare({id:'1',asset:'a',material_id:'first',material:definition(.25)});
  const b=f.pool.public.prepare({id:'2',asset:'a',material_id:'second',material:definition(.75)});
  await Promise.all([a.readyPromise,b.readyPromise]);assert.equal(f.loads.length,1);assert.equal(f.uploads.length,1);assert.equal(f.compiles.length,2);
  const texture=f.pool.read(a).texture;assert.equal(f.pool.read(b).texture,texture);assert.notEqual(f.pool.read(a).material,f.pool.read(b).material);
  assert.equal(f.pool.metrics().cpu_reserved_bytes_estimate,16);assert.equal(f.pool.metrics().gpu_reserved_bytes_estimate,16);assert.equal(f.pool.metrics().image_leases,1);
  let disposals=0;texture.addEventListener('dispose',()=>disposals++);a.release();assert.equal(disposals,0);assert.equal(b.state,'ready');assert.equal(f.pool.read(b).texture,texture);
  assert.equal(f.pool.metrics().entries,1);assert.equal(f.pool.metrics().live_textures,1);assert.equal(f.pool.metrics().gpu_reserved_bytes_estimate,16);
  b.release();b.release();assert.equal(disposals,1);assert.deepEqual(f.closed,['a']);assert.equal(f.pool.metrics().entries,0);assert.equal(f.pool.metrics().texture_entries,0);assert.equal(f.pool.metrics().gpu_reserved_bytes_estimate,0);
 }finally{f.dispose();}
});

test('one material compilation failure cannot retire a shared texture used by another ready material',async()=>{
 const f=fixture({budget:{max_bytes:16,max_entries:1},failMaterialId:'broken'});try{
  const a=f.pool.public.prepare({id:'1',asset:'a',material_id:'valid',material:definition(.25)});await a.readyPromise;const texture=f.pool.read(a).texture;
  let disposals=0;texture.addEventListener('dispose',()=>disposals++);
  const b=f.pool.public.prepare({id:'2',asset:'a',material_id:'broken',material:definition(.75)});await assert.rejects(b.readyPromise,/COMPILE_FAILED/);
  assert.equal(a.state,'ready');assert.equal(b.state,'error');assert.equal(f.pool.read(a).texture,texture);assert.equal(disposals,0);assert.equal(f.loads.length,1);assert.equal(f.uploads.length,1);
  assert.equal(f.pool.metrics().image_leases,1);assert.equal(f.pool.metrics().gpu_reserved_bytes_estimate,16);b.release();assert.equal(disposals,0);a.release();assert.equal(disposals,1);
 }finally{f.dispose();}
});

test('context restore rebuilds one shared texture and both programs without redecoding or stale readiness',async()=>{
 const f=fixture({budget:{max_bytes:16,max_entries:1}});try{
  const a=f.pool.public.prepare({id:'1',asset:'a',material_id:'first',material:definition(.25)}),b=f.pool.public.prepare({id:'2',asset:'a',material_id:'second',material:definition(.75)});
  await Promise.all([a.readyPromise,b.readyPromise]);const oldTexture=f.pool.read(a).texture,stale=b.readyPromise;let oldDisposals=0;oldTexture.addEventListener('dispose',()=>oldDisposals++);
  f.pool.contextLost();assert.equal(oldDisposals,1);assert.equal(a.state,'loading');assert.equal(b.state,'loading');assert.equal(f.pool.metrics().live_textures,0);assert.equal(f.pool.metrics().image_leases,1);
  await assert.rejects(stale,/NOT_READY/);f.pool.contextRestored();await Promise.all([a.readyPromise,b.readyPromise]);
  const current=f.pool.read(a).texture;assert.notEqual(current,oldTexture);assert.equal(f.pool.read(b).texture,current);assert.equal(f.loads.length,1);assert.equal(f.uploads.length,2);assert.equal(f.compiles.length,4);assert.equal(f.pool.metrics().gpu_reserved_bytes_estimate,16);
  let currentDisposals=0;current.addEventListener('dispose',()=>currentDisposals++);a.release();assert.equal(currentDisposals,0);b.release();assert.equal(currentDisposals,1);assert.deepEqual(f.closed,['a']);
 }finally{f.dispose();}
});

test('different material identities do not create duplicate Texture Sources even with ample admission budget',async()=>{
 const f=fixture();try{
  const a=f.pool.public.prepare({id:'1',asset:'a',material_id:'first',material:definition(.25)}),b=f.pool.public.prepare({id:'2',asset:'a',material_id:'second',material:definition(.75)});
  await Promise.all([a.readyPromise,b.readyPromise]);assert.equal(f.uploads.length,1);assert.equal(f.pool.read(a).texture.source,f.pool.read(b).texture.source);assert.equal(f.pool.metrics().gpu_reserved_bytes_estimate,16);
 }finally{f.dispose();}
});

test('releasing one loading material never cancels shared pixels needed by a second owner',async()=>{
 const f=fixture({pending:['a'],budget:{max_bytes:16,max_entries:1}});try{
  const a=f.pool.public.prepare({id:'1',asset:'a',material_id:'first',material:definition(.25)}),b=f.pool.public.prepare({id:'2',asset:'a',material_id:'second',material:definition(.75)});
  await flush();a.release();assert.equal(b.state,'loading');assert.equal(f.pool.metrics().image_leases,1);f.resolve('a');await b.readyPromise;
  assert.equal(a.state,'released');assert.equal(b.state,'ready');assert.equal(f.loads.length,1);assert.equal(f.uploads.length,1);assert.equal(f.closed.length,0);b.release();assert.deepEqual(f.closed,['a']);
 }finally{f.dispose();}
});

test('shared upload failure retires exactly once and cannot leave either material spuriously ready',async()=>{
 const f=fixture({failUpload:true,budget:{max_bytes:16,max_entries:1}});try{
  const a=f.pool.public.prepare({id:'1',asset:'a',material_id:'first',material:definition(.25)}),b=f.pool.public.prepare({id:'2',asset:'a',material_id:'second',material:definition(.75)});
  await Promise.all([assert.rejects(a.readyPromise,/UPLOAD_FAILED/),assert.rejects(b.readyPromise,/UPLOAD_FAILED/)]);
  assert.equal(a.state,'error');assert.equal(b.state,'error');assert.equal(f.loads.length,1);assert.equal(f.uploads.length,1);assert.equal(f.compiles.length,0);assert.deepEqual(f.closed,['a']);
  assert.equal(f.pool.metrics().gpu_reserved_bytes_estimate,0);assert.equal(f.pool.metrics().texture_entries,0);assert.equal(f.pool.metrics().image_leases,0);
  a.release();b.release();assert.equal(f.pool.metrics().entries,0);assert.deepEqual(f.closed,['a']);
 }finally{f.dispose();}
});

const cacheLimits={max_bytes:64,max_entries:4,idle_frames:3};
function renderFrame(f,w){f.textureCache.begin();const complete=f.presenter.draw(w);f.textureCache.sweep();return complete;}
const hidden=()=>world(entity('a',{sprite:{asset:'a',visible:false}}));

test('auto idle expiry removes its material and texture, so a later true cold use remains pending',async()=>{
 const f=fixture({texturePolicy:cacheLimits});try{
  const shown=world(entity());assert.equal(renderFrame(f,shown),false);await f.pool.ready();assert(renderFrame(f,shown));
  assert(renderFrame(f,hidden()));assert.equal(f.pool.metrics().idle_material_entries,1);assert.equal(f.textureCache.metrics().entries,1);
  assert(renderFrame(f,hidden()));assert.equal(f.pool.metrics().texture_retired,0);
  assert(renderFrame(f,hidden()));assert.equal(f.pool.metrics().texture_retired,1);assert.equal(f.textureCache.metrics().entries,0);assert.deepEqual(f.closed,['a']);
  assert.equal(renderFrame(f,shown),false);await f.pool.ready();assert(renderFrame(f,shown));assert.equal(f.uploads.length,2);assert.equal(f.loads.length,2);
 }finally{f.dispose();}
});

test('100 automatic A/B substitutions reuse both prepared tuples within one bounded cache',async()=>{
 const f=fixture({texturePolicy:cacheLimits});try{
  for(const asset of ['a','b']){assert.equal(renderFrame(f,world(entity(asset))),false);await f.pool.ready();assert(renderFrame(f,world(entity(asset))));}
  for(let i=0;i<100;i++)assert(renderFrame(f,world(entity(i%2?'b':'a'))));
  assert.deepEqual(f.loads,['a','b']);assert.equal(f.uploads.length,2);assert.equal(f.compiles.length,2);
  assert.equal(f.textureCache.metrics().entries,2);assert.equal(f.textureCache.metrics().decoded_texture_bytes_estimate,32);assert.equal(f.textureCache.metrics().pinned_bytes_estimate,16);
 }finally{f.dispose();}
});

test('managed activity cannot refresh an expired auto idle permission or create one on last release',async()=>{
 const f=fixture({texturePolicy:cacheLimits});try{
  const managed=f.pool.public.prepare({id:'managed',asset:'a',material_id:'test',material:definition(.25)});await managed.readyPromise;
  assert(renderFrame(f,world(entity())));assert(renderFrame(f,hidden()));assert.equal(f.pool.metrics().idle_material_entries,1);
  for(let i=0;i<4;i++){renderFrame(f,hidden());assert.equal(managed.state,'ready');}
  assert.equal(f.pool.metrics().idle_material_entries,0);assert.equal(f.textureCache.metrics().pinned_bytes_estimate,16);
  managed.release();assert.equal(f.pool.metrics().texture_entries,0);assert.equal(f.textureCache.metrics().entries,0);assert.deepEqual(f.closed,['a']);
  const neverAuto=f.pool.public.prepare({id:'only',asset:'b'});await neverAuto.readyPromise;neverAuto.release();
  assert.equal(f.pool.metrics().idle_material_entries,0);assert.equal(f.textureCache.metrics().entries,0);assert.deepEqual(f.closed,['a','b']);
 }finally{f.dispose();}
});

test('switching a committed managed appearance to an ordinary sprite grants only the ordinary cache owner',async()=>{
 const f=fixture({texturePolicy:cacheLimits});try{
  const prepared=f.pool.public.prepare({id:'managed',asset:'a',material_id:'test',material:definition(.25)});await prepared.readyPromise;
  assert(renderFrame(f,world(entity('a',{sprite_appearance:{resource:'managed',revision:1}}))));prepared.release();
  assert(renderFrame(f,world(entity())));assert(renderFrame(f,hidden()));assert.equal(f.pool.metrics().idle_material_entries,1);
  assert(renderFrame(f,world(entity())));assert.equal(f.loads.length,1);assert.equal(f.uploads.length,1);assert.equal(f.compiles.length,1);
 }finally{f.dispose();}
});

test('idle material variants are independently bounded while their one physical texture is counted once',async()=>{
 const f=fixture({texturePolicy:{...cacheLimits,max_entries:1},budget:{max_bytes:16,max_entries:1}});try{
  const a=f.pool.acquire({asset:'a',material_id:'first',material:definition(.25)}),b=f.pool.acquire({asset:'a',material_id:'second',material:definition(.75)});
  await Promise.all([a.readyPromise,b.readyPromise]);assert.equal(f.textureCache.metrics().entries,1);assert.equal(f.textureCache.metrics().decoded_texture_bytes_estimate,16);
  a.release();b.release();assert.equal(f.pool.metrics().idle_material_entries,1);assert.equal(f.pool.metrics().entries,1);assert.equal(f.pool.metrics().texture_retired,0);
  assert.equal(f.uploads.length,1);assert.equal(f.loads.length,1);f.textureCache.clear();assert.equal(f.pool.metrics().entries,0);assert.equal(f.pool.metrics().texture_retired,1);assert.deepEqual(f.closed,['a']);
 }finally{f.dispose();}
});

test('hard pool admission reclaims eligible idle owners through the same controller without evicting live leases',async()=>{
 const f=fixture({texturePolicy:{...cacheLimits,max_bytes:32,max_entries:2},budget:{max_bytes:16,max_entries:1}});try{
  const a=f.pool.acquire({asset:'a'});await a.readyPromise;a.release();assert.equal(f.pool.metrics().idle_material_entries,1);
  const b=f.pool.public.prepare({id:'next',asset:'b'});await b.readyPromise;assert.equal(b.state,'ready');assert.deepEqual(f.closed,['a']);
  assert.equal(f.textureCache.metrics().entries,1);assert.equal(f.pool.metrics().gpu_reserved_bytes_estimate,16);
  const c=f.pool.public.prepare({id:'blocked',asset:'c'});await assert.rejects(c.readyPromise,/BUDGET_EXCEEDED/);
  assert.equal(b.state,'ready');assert.deepEqual(f.loads,['a','b']);assert.equal(f.textureCache.metrics().entries,1);
 }finally{f.dispose();}
});

test('hiding a pending auto appearance never admits idle ownership or resurrects a late decoded image',async()=>{
 const f=fixture({pending:['a'],texturePolicy:cacheLimits});try{
  assert.equal(renderFrame(f,world(entity())),false);await flush();assert.equal(f.loads.length,1);
  assert(renderFrame(f,hidden()));assert.equal(f.pool.metrics().entries,0);assert.equal(f.textureCache.metrics().entries,0);
  f.resolve('a');await flush();assert.equal(f.uploads.length,0);assert.equal(f.pool.metrics().idle_material_entries,0);assert.deepEqual(f.closed,['a']);
 }finally{f.dispose();}
});

test('context loss retires all idle owners despite one release failure and fences every retained live owner',async()=>{
 const f=fixture({texturePolicy:cacheLimits,throwImageRelease:true});try{
  const idleA=f.pool.acquire({asset:'a'}),idleB=f.pool.acquire({asset:'b'}),active=f.pool.public.prepare({id:'live',asset:'c'});
  await Promise.all([idleA.readyPromise,idleB.readyPromise,active.readyPromise]);idleA.release();idleB.release();
  f.compiles[0].addEventListener('dispose',()=>assert.equal(active.state,'loading','Every live owner is fenced before the first idle disposal callback'));
  const epoch=active.epoch;assert.throws(()=>f.pool.contextLost(),/IMAGE_RELEASE_HOOK_FAILED/);
  assert(active.epoch>epoch);assert.equal(active.state,'loading');assert.equal(f.pool.metrics().idle_material_entries,0);assert.equal(f.pool.metrics().entries,1);
  assert.equal(f.pool.metrics().live_textures,0);assert.equal(f.textureCache.metrics().entries,1);assert.deepEqual(f.closed,['a','b']);
  await assert.rejects(active.readyPromise,/NOT_READY/);f.pool.contextRestored();await active.readyPromise;
  assert.equal(f.loads.length,3);assert.equal(f.uploads.length,4);active.release();assert.equal(f.textureCache.metrics().entries,0);assert.deepEqual(f.closed,['a','b','c']);
 }finally{f.dispose();}
});

test('physical controller retirement removes every cached material sharing one texture exactly once',async()=>{
 const f=fixture({texturePolicy:cacheLimits});try{
  const a=f.pool.acquire({asset:'a',material_id:'first',material:definition(.25)}),b=f.pool.acquire({asset:'a',material_id:'second',material:definition(.75)});
  await Promise.all([a.readyPromise,b.readyPromise]);let disposed=0;f.pool.read(a).texture.addEventListener('dispose',()=>disposed++);
  a.release();b.release();assert.equal(f.pool.metrics().idle_material_entries,2);assert.equal(f.textureCache.metrics().entries,1);
  f.textureCache.clear();assert.equal(disposed,1);assert.equal(f.pool.metrics().entries,0);assert.equal(f.textureCache.metrics().entries,0);assert.deepEqual(f.closed,['a']);
 }finally{f.dispose();}
});

test('reset and context retirement reject reentrant acquisition while completing every existing owner',async()=>{
 for(const action of ['reset','contextLost']){
  const f=fixture({texturePolicy:cacheLimits});try{
   const a=f.pool.public.prepare({id:'old-a',asset:'a'}),b=f.pool.public.prepare({id:'old-b',asset:'b'});await Promise.all([a.readyPromise,b.readyPromise]);
   let reentryError;f.compiles[0].addEventListener('dispose',()=>{try{f.pool.public.prepare({id:'reentrant',asset:'c'});}catch(error){reentryError=error;}});
   if(action==='reset')f.pool.public.reset();else f.pool.contextLost();
   assert.match(reentryError?.message??'',/SPRITE_RESOURCES_RETIRING/);assert.equal(f.pool.fromId('reentrant'),undefined);
   if(action==='reset'){assert.equal(f.textureCache.metrics().entries,0);assert.equal(f.pool.metrics().gpu_reserved_bytes_estimate,0);assert.equal(b.state,'released');}
   else{assert.equal(a.state,'loading');assert.equal(b.state,'loading');f.pool.contextRestored();await Promise.all([a.readyPromise,b.readyPromise]);assert.equal(f.loads.length,2);}
  }finally{f.dispose();}
 }
});

test('cached physical retirement cannot reacquire an untracked texture from a material disposal callback',async()=>{
 const f=fixture({texturePolicy:cacheLimits});try{
  const a=f.pool.acquire({asset:'a'});await a.readyPromise;let reentryError;
  f.pool.read(a).material.addEventListener('dispose',()=>{try{f.pool.acquire({asset:'a'});}catch(error){reentryError=error;}});a.release();
  f.textureCache.clear();assert.match(reentryError?.message??'',/SPRITE_RESOURCES_RETIRING/);
  assert.equal(f.pool.metrics().texture_entries,0);assert.equal(f.pool.metrics().entries,0);assert.equal(f.textureCache.metrics().entries,0);assert.deepEqual(f.closed,['a']);
  const after=f.pool.acquire({asset:'a'});await after.readyPromise;assert.equal(f.textureCache.metrics().entries,1);assert.equal(f.loads.length,2);
 }finally{f.dispose();}
});
