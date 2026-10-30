import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three/three.player.min.js';
import {createUiImageBatchPrefix} from '../renderer/ui-image-batch-prefix.js';
import {createAssetCatalog,createImageAssetBroker} from './asset-encoding.js';
import {createCanvasUi} from './canvas-ui.mjs';
import {DRAW_COMPLETED,DRAW_SKIPPED} from './player-completion.mjs';

const ids={a:'texture://prefix-owner/a',b:'texture://prefix-owner/b',c:'texture://prefix-owner/c',d:'texture://prefix-owner/d'};
const rect={x:0,y:0,width:100,height:100};
const batch=(id,names)=>({kind:'image_batch',id,rect,quads:names.map((name,index)=>({asset:ids[name],rect:{x:index*12,y:id==='ground'?0:20,width:10,height:10},source:{x:1,y:2,width:4,height:3},opacity:index%2?.5:1}))});
const snapshot=({actor=true,hudAsset=null}={})=>({world:{ui:{kind:'screen',id:'screen',node:'stage',children:[batch('ground',['a','c','a']),batch('actor',actor?['b','c']:['c']),{kind:'text',id:'hud',rect:{x:0,y:80,width:50,height:10},text:'HUD'},...(hudAsset?[{kind:'image',id:'hud-image',asset:hudAsset,rect:{x:50,y:80,width:10,height:10}}]:[])]}}});
function fixture({onDiagnostic,requestRender,acquireOverride,textureFailure=false,geometryFailure=false,borrowedPrefix=false}={}){
 const trace=[],decoded=[],leases=[],painted=[],calls=[],gpuTextures=[],acquires=new Map();let lost=false;
 const broker=createImageAssetBroker(createAssetCatalog({assets:Object.values(ids).map(id=>({id,kind:'texture2d',source:id.split('/').at(-1)+'.png'}))}),{
  resolveAssetUrl:asset=>asset.source,unusedMaxBytes:0,unusedMaxEntries:0,inspectImage:async()=>({format:'png',width:8,height:8}),
  loadImage:async(url,{asset})=>{const image={id:asset.id,width:8,height:8,closed:0,close(){this.closed++;trace.push('pixels.close:'+this.id);}};decoded.push(image);return image;},
 });
 const acquireAsset=id=>{
  const count=(acquires.get(id)??0)+1;acquires.set(id,count);trace.push('acquire:'+id+':'+count);
  const owned=broker.acquire(id),record={id,count,released:0};leases.push(record);
  const lease={get state(){return owned.state;},get image(){return owned.image;},get error(){return owned.error;},promise:owned.promise,release(){record.released++;trace.push('lease.release:'+id+':'+count);owned.release();}};
  return acquireOverride?.(id,count,lease)??lease;
 };
 const THREE={...T,Texture:class extends T.Texture{constructor(image){if(typeof textureFailure==='function'?textureFailure(image):textureFailure)throw Error('texture-construction-failed');super(image);gpuTextures.push(this);}dispose(){this.disposedCalls=(this.disposedCalls??0)+1;trace.push('texture.dispose:'+this.image.id);super.dispose();}},BufferGeometry:class extends T.BufferGeometry{constructor(){if(geometryFailure)throw Error('geometry-construction-failed');super();}}};
 const gl={UNPACK_FLIP_Y_WEBGL:1,UNPACK_PREMULTIPLY_ALPHA_WEBGL:2,isContextLost:()=>lost,getParameter:()=>false,pixelStorei(){}};
 const renderer={autoClear:true,sortObjects:false,capabilities:{maxTextureSize:4096},outputColorSpace:T.SRGBColorSpace,getContext:()=>gl,getDrawingBufferSize:v=>v.set(100,100),getRenderTarget:()=>null,getViewport:v=>v.set(0,0,100,100),getScissor:v=>v.set(0,0,100,100),getScissorTest:()=>false,getPixelRatio:()=>1,setViewport(){},setScissor(){},setScissorTest(){},render(scene){this.scene=scene;calls.length=0;for(const mesh of [...scene.children].sort((a,b)=>a.renderOrder-b.renderOrder))for(const group of mesh.geometry.groups){const material=mesh.material[group.materialIndex];mesh.onBeforeRender(this,scene,null,mesh.geometry,material,group);const texture=material.uniforms.projectedTexture.value;assert.equal(texture.image.closed,0,'GPU submission must never use retired pixels');calls.push({mesh,geometry:mesh.geometry,material,texture,asset:group.asset,clip:[...material.uniforms.imageClip.value],opacity:mesh.geometry.attributes.imageOpacity.data.array[5],uv:mesh.geometry.attributes.uv.data.array[3]});}}};
 const prefix=createUiImageBatchPrefix(THREE,renderer),originalClear=prefix.clear;prefix.clear=()=>{trace.push('prefix.clear');originalClear();};
 if(borrowedPrefix){prefix.ownsImageLeases=false;const drawPrefix=prefix.drawPrefix;prefix.drawPrefix=(nodes,{acquireAsset,...context})=>drawPrefix(nodes,context);}
 const context={setTransform(){},clearRect(){},save(){},restore(){},beginPath(){},rect(){},clip(){},drawImage:image=>{assert.equal(image.closed,0);painted.push(image);},fillText(){},measureText:()=>({width:3})};
 const ui=createCanvasUi({width:100,height:100,getContext:()=>context},{acquireAsset,getImageBatchPresenter:()=>prefix,onDiagnostic,requestRender});
 return{ui,prefix,renderer,broker,decoded,trace,leases,calls,painted,gpuTextures,acquires,setLost(value){lost=value;},dispose(){ui.dispose();prefix.dispose();broker.dispose();}};
}
async function warm(f,value=snapshot()){assert.equal(f.ui.draw(value),DRAW_SKIPPED.ui_assets_pending);await f.ui.ready();assert.equal(f.ui.draw(value),DRAW_COMPLETED);}

test('removing one actor asset incrementally retires its texture without rebuilding surviving prefix owners',async t=>{
 const f=fixture();t.after(()=>f.dispose());await warm(f);const before=f.prefix.metrics(),meshes=[...f.renderer.scene.children],ground=meshes[0],actor=meshes[1],material=ground.material[0],geometry=ground.geometry,actorGeometry=actor.geometry,keptTextures=new Map(f.calls.filter(call=>call.asset!==ids.b).map(call=>[call.asset,call.texture]));f.trace.length=0;
 assert.equal(f.ui.draw(snapshot({actor:false})),DRAW_COMPLETED);const after=f.prefix.metrics();
 assert.equal(after.geometry_builds,before.geometry_builds);assert.equal(after.geometry_disposes,before.geometry_disposes);assert.equal(after.material_builds,before.material_builds);assert.equal(after.material_disposes,before.material_disposes);assert.equal(after.texture_builds,before.texture_builds);assert.equal(after.texture_disposes,before.texture_disposes+1);assert.equal(after.mesh_builds,before.mesh_builds);assert.equal(before.image_leases,3);assert.equal(after.image_leases,2);assert.equal(after.prefix_quads,4);
 assert.equal(f.renderer.scene.children[0],ground);assert.equal(f.renderer.scene.children[1],actor);assert.equal(ground.geometry,geometry);assert.equal(actor.geometry,actorGeometry);assert.equal(ground.material[0],material);assert.equal(actor.material[0],material);assert.deepEqual(f.calls.map(call=>call.asset),[ids.a,ids.c,ids.a,ids.c]);assert(f.calls.every(call=>call.texture===keptTextures.get(call.asset)));assert(!f.trace.includes('prefix.clear'));
 const image=f.decoded.find(value=>value.id===ids.b),cpuRelease=f.trace.indexOf('lease.release:'+ids.b+':1'),gpuDispose=f.trace.indexOf('texture.dispose:'+ids.b),gpuRelease=f.trace.indexOf('lease.release:'+ids.b+':2'),close=f.trace.indexOf('pixels.close:'+ids.b);assert(cpuRelease>=0&&cpuRelease<gpuDispose&&gpuDispose<gpuRelease&&gpuRelease<close);assert.equal(image.closed,1);assert.equal(f.broker.report().loads,3);assert.equal(f.broker.report().active_entries,2);
 assert.equal(f.calls[0].uv,.125);assert.deepEqual(f.calls[0].clip,[0,0,100,100]);assert.equal(material.depthTest,false);assert.equal(material.depthWrite,false);assert.equal(material.blending,T.CustomBlending);
 f.dispose();assert(f.decoded.every(value=>value.closed===1));assert(f.leases.every(value=>value.released===1));
});

test('removing Canvas-only artwork cannot clear or recreate unrelated accelerated prefix textures',async t=>{
 const f=fixture();t.after(()=>f.dispose());const value=snapshot({actor:false,hudAsset:ids.b});await warm(f,value);const before=f.prefix.metrics(),ground=f.renderer.scene.children[0],material=ground.material[0];f.trace.length=0;
 assert.equal(f.ui.draw(snapshot({actor:false})),DRAW_COMPLETED);assert.equal(f.prefix.metrics().geometry_builds,before.geometry_builds);assert.equal(f.prefix.metrics().texture_builds,before.texture_builds);assert.equal(f.prefix.metrics().texture_disposes,before.texture_disposes);assert.equal(f.prefix.metrics().material_builds,before.material_builds);assert.equal(f.renderer.scene.children[0],ground);assert.equal(ground.material[0],material);assert(!f.trace.includes('prefix.clear'));assert.equal(f.decoded.find(image=>image.id===ids.b).closed,1);
});

test('callback failure retires Canvas ownership but GPU pixels survive until the next incremental sweep',async t=>{
 let armed=false;const f=fixture({onDiagnostic(){if(armed)throw Error('diagnostic-threw');}});t.after(()=>f.dispose());await warm(f);const actor=f.decoded.find(image=>image.id===ids.b),before=f.prefix.metrics();f.trace.length=0;armed=true;
 assert.throws(()=>f.ui.draw(snapshot({actor:false,hudAsset:'texture://missing'})),/diagnostic-threw/);assert.equal(actor.closed,0);assert.equal(f.prefix.metrics().texture_disposes,before.texture_disposes);assert(!f.trace.includes('prefix.clear'));armed=false;
 assert.equal(f.ui.draw(snapshot({actor:false})),DRAW_COMPLETED);assert.equal(actor.closed,1);assert.equal(f.prefix.metrics().texture_disposes,before.texture_disposes+1);assert.equal(f.prefix.metrics().material_builds,before.material_builds);
});

test('reentrant recovery keeps the latest prefix image owners without an obsolete global clear',async t=>{
 let f,armed=false,recovered;f=fixture({onDiagnostic(){if(armed){armed=false;recovered=f.ui.draw(snapshot());}}});t.after(()=>f.dispose());await warm(f);const before=f.prefix.metrics(),meshes=[...f.renderer.scene.children];f.trace.length=0;armed=true;
 assert.equal(f.ui.draw(snapshot({actor:false,hudAsset:'texture://missing'})),DRAW_COMPLETED);assert.equal(recovered,DRAW_COMPLETED);assert.equal(f.prefix.metrics().geometry_builds,before.geometry_builds);assert.equal(f.prefix.metrics().material_builds,before.material_builds);assert.equal(f.prefix.metrics().texture_disposes,before.texture_disposes);assert.equal(f.prefix.metrics().image_leases,3);assert.deepEqual(f.renderer.scene.children,meshes);assert(f.decoded.every(image=>image.closed===0));assert(!f.trace.includes('prefix.clear'));
});

test('a diagnostic callback disposing the real prefix stops the draw with no surviving GPU image leases',async t=>{
 let f,armed=false;f=fixture({onDiagnostic(){if(armed){armed=false;f.ui.dispose();}}});t.after(()=>f.dispose());await warm(f);f.trace.length=0;armed=true;
 assert.throws(()=>f.ui.draw(snapshot({actor:false,hudAsset:'texture://missing'})),/UI_DISPOSED/);assert.equal(f.prefix.metrics().image_leases,0);assert.equal(f.prefix.metrics().live_textures,0);assert.equal(f.prefix.metrics().live_geometries,0);assert.equal(f.trace.filter(event=>event==='prefix.clear').length,1);assert(f.decoded.every(image=>image.closed===1));assert(f.leases.every(lease=>lease.released===1));assert.throws(()=>f.ui.draw(snapshot()),/UI_DISPOSED/);
});

test('context retirement and Canvas invalidation dispose GPU textures before releasing their independent leases',async t=>{
 const f=fixture();t.after(()=>f.dispose());await warm(f);const before=f.prefix.metrics(),images=[...f.decoded];f.trace.length=0;f.setLost(true);
 assert.equal(f.ui.draw(snapshot()),DRAW_SKIPPED.ui_target_unavailable);assert.equal(f.prefix.metrics().image_leases,0);assert(images.every(image=>image.closed===0),'Canvas still owns decoded pixels while the context is lost');for(const {id} of images)assert(f.trace.indexOf('texture.dispose:'+id)<f.trace.indexOf('lease.release:'+id+':2'));
 f.setLost(false);assert.equal(f.ui.draw(snapshot()),DRAW_COMPLETED);assert.equal(f.broker.report().loads,3);assert.equal(f.prefix.metrics().image_leases,3);assert.equal(f.prefix.metrics().texture_builds,before.texture_builds+3);
 f.trace.length=0;f.ui.invalidateAssets();assert(images.every(image=>image.closed===1));assert.equal(f.prefix.metrics().image_leases,0);assert.equal(f.ui.draw(snapshot()),DRAW_SKIPPED.ui_assets_pending);await f.ui.ready();assert.equal(f.ui.draw(snapshot()),DRAW_COMPLETED);assert.equal(f.broker.report().loads,6);f.dispose();assert(f.decoded.every(image=>image.closed===1));assert(f.leases.every(lease=>lease.released===1));assert.throws(()=>f.ui.draw(snapshot()),/UI_DISPOSED/);
});

for(const failure of ['loading','identity','constructor'])test(`a GPU ${failure} admission failure releases its new lease and leaves cleanup complete`,async t=>{
 const f=fixture({textureFailure:failure==='constructor',acquireOverride(id,count,lease){if(count!==2||failure==='constructor')return lease;return{...lease,state:failure==='loading'?'loading':'ready',image:failure==='identity'?{width:8,height:8}:lease.image};}});t.after(()=>f.dispose());assert.equal(f.ui.draw(snapshot()),DRAW_SKIPPED.ui_assets_pending);await f.ui.ready();
 assert.throws(()=>f.ui.draw(snapshot()),failure==='constructor'?/texture-construction-failed/:/UI_IMAGE_PREFIX_ASSET_(NOT_READY|IDENTITY)/);assert.equal(f.prefix.metrics().image_leases,0);assert.equal(f.prefix.metrics().live_geometries,0);assert.equal(f.prefix.metrics().live_textures,0);assert(f.decoded.every(image=>image.closed===0),'failed GPU admission cannot close a live Canvas consumer');f.dispose();assert(f.decoded.every(image=>image.closed===1));assert(f.leases.every(lease=>lease.released===1));
});

test('failed replacement admission keeps the previous geometry registered until final cleanup',async t=>{
 const f=fixture({acquireOverride(id,count,lease){return id===ids.b&&count===2?{...lease,state:'loading'}:lease;}});t.after(()=>f.dispose());await warm(f,snapshot({actor:false}));const before=f.prefix.metrics(),old=f.renderer.scene.children[1].geometry;
 const held=f.broker.acquire(ids.b);await held.promise;
 try{assert.throws(()=>f.ui.draw(snapshot()),/UI_IMAGE_PREFIX_ASSET_NOT_READY/);assert.equal(f.renderer.scene.children[1].geometry,old);assert.equal(f.prefix.metrics().geometry_builds,before.geometry_builds);assert.equal(f.prefix.metrics().live_geometries,2);assert(f.decoded.every(image=>image.closed===0));}finally{held.release();}
 f.dispose();assert.equal(f.prefix.metrics().live_geometries,0);assert.equal(f.prefix.metrics().live_textures,0);assert.equal(f.prefix.metrics().image_leases,0);assert(f.decoded.every(image=>image.closed===1));assert(f.leases.every(lease=>lease.released===1));
});

test('a second-asset failure rolls back newly staged textures and preserves already committed GPU owners',async t=>{
 const f=fixture({acquireOverride(id,count,lease){return id===ids.d&&count===2?{...lease,state:'loading'}:lease;}});t.after(()=>f.dispose());await warm(f,snapshot({actor:false}));const before=f.prefix.metrics(),meshes=[...f.renderer.scene.children],oldTextures=new Map(f.calls.map(call=>[call.asset,call.texture]));
 const held=[f.broker.acquire(ids.b),f.broker.acquire(ids.d)];await Promise.all(held.map(lease=>lease.promise));const next={world:{ui:{kind:'screen',id:'screen',node:'stage',children:[batch('ground',['a','c','a']),batch('replacement',['b','d'])]}}};
 try{assert.throws(()=>f.ui.draw(next),/UI_IMAGE_PREFIX_ASSET_NOT_READY/);const after=f.prefix.metrics();assert.equal(after.live_textures,before.live_textures);assert.equal(after.image_leases,before.image_leases);assert.equal(after.live_geometries,before.live_geometries);assert.equal(after.texture_builds,before.texture_builds+1);assert.equal(after.texture_disposes,before.texture_disposes+1);assert.deepEqual(f.renderer.scene.children,meshes);assert(f.decoded.every(image=>image.closed===0));for(const [asset,texture]of oldTextures)assert(!f.trace.includes('texture.dispose:'+asset)&&texture.image.closed===0);}finally{held.forEach(lease=>lease.release());}
 f.dispose();assert.equal(f.prefix.metrics().live_textures,0);assert.equal(f.prefix.metrics().image_leases,0);assert.equal(f.prefix.metrics().live_geometries,0);assert(f.decoded.every(image=>image.closed===1));assert(f.leases.every(lease=>lease.released===1));
});

test('geometry allocation failure rolls back every new texture lease acquired before allocation',async t=>{
 const f=fixture({geometryFailure:true});t.after(()=>f.dispose());assert.equal(f.ui.draw(snapshot()),DRAW_SKIPPED.ui_assets_pending);await f.ui.ready();const before=f.prefix.metrics();
 assert.throws(()=>f.ui.draw(snapshot()),/geometry-construction-failed/);const after=f.prefix.metrics();assert.equal(after.live_textures,before.live_textures);assert.equal(after.image_leases,before.image_leases);assert.equal(after.live_geometries,before.live_geometries);assert.equal(after.texture_builds,before.texture_builds+2);assert.equal(after.texture_disposes,before.texture_disposes+2);assert(f.decoded.every(image=>image.closed===0));f.dispose();assert(f.decoded.every(image=>image.closed===1));assert(f.leases.every(lease=>lease.released===1));
});

for(const borrowedPrefix of [false,true])test(`a later resource failure purges earlier changed resources and permits a clean ${borrowedPrefix?'borrowed':'broker-owned'} retry`,async t=>{
 let fail=true;const f=fixture({borrowedPrefix,textureFailure:image=>fail&&image.id===ids.d});t.after(()=>f.dispose());await warm(f,snapshot({actor:false}));const ground=f.renderer.scene.children[0],oldActor=f.renderer.scene.children[1],groundGeometry=ground.geometry,material=ground.material[0],before=f.prefix.metrics(),oldTextures=new Map(f.calls.map(call=>[call.asset,call.texture]));
 const held=[f.broker.acquire(ids.b),f.broker.acquire(ids.d)];await Promise.all(held.map(lease=>lease.promise));const next={world:{ui:{kind:'screen',id:'screen',node:'stage',children:[batch('ground',['a','c','a']),batch('actor',['b']),batch('late',['d'])]}}};
 try{assert.throws(()=>f.ui.draw(next),/texture-construction-failed/);const failed=f.prefix.metrics(),failedB=f.gpuTextures.find(texture=>texture.image.id===ids.b);assert.equal(failed.live_textures,before.live_textures);assert.equal(failed.image_leases,before.image_leases);assert.equal(failed.live_geometries,1);assert.equal(failed.live_meshes,1);assert.deepEqual(f.renderer.scene.children,[ground]);assert.equal(ground.geometry,groundGeometry);assert.equal(ground.material[0],material);assert.equal(oldActor.geometry.groups.length,0,'a failed resource cannot retain disposed texture/image references');assert.equal(failedB.disposedCalls,1);assert(f.decoded.every(image=>image.closed===0));
  fail=false;assert.equal(f.ui.draw(next),DRAW_COMPLETED);assert.equal(f.prefix.metrics().live_geometries,3);assert.equal(f.prefix.metrics().live_meshes,3);assert.equal(f.renderer.scene.children[0],ground);assert.equal(ground.geometry,groundGeometry);assert.deepEqual(f.calls.map(call=>call.asset),[ids.a,ids.c,ids.a,ids.b,ids.d]);for(const call of f.calls)if(oldTextures.has(call.asset))assert.equal(call.texture,oldTextures.get(call.asset));assert.notEqual(f.calls.find(call=>call.asset===ids.b).texture,failedB,'retry must not use the rolled-back disposed texture');
 }finally{held.forEach(lease=>lease.release());}
 f.dispose();assert.equal(f.prefix.metrics().live_geometries,0);assert.equal(f.prefix.metrics().live_textures,0);assert.equal(f.prefix.metrics().image_leases,0);assert(f.decoded.every(image=>image.closed===1));assert(f.leases.every(lease=>lease.released===1));
});
