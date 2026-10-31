// Actual three.js draw()/rasterLost()/rasterRestored() bodies with real frame draws, decoder,
// texture cache and player profiler. The test plays main.js's role: one draw event per call.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../vendor/three/three.player.min.js';
import {createProjectedFrameDecoder} from '../shared/projected-frame.mjs';
import {assertFrameSnapshot} from './projected-frame-policy.js';
import {createFrameDraws} from './projected-frame-draws.js';
import {frameProfileCases} from './projected-frame-profile.js';
import {framePresentationIdentity} from './projected-frame-publication.js';
import {createTextureCachePolicy} from './texture-cache-policy.js';
import {createPlayerProfiler} from '../shared/raster-diagnostics.mjs';
import {DRAW_COMPLETED,DRAW_SKIPPED} from '../shared/player-completion.mjs';
const source=fs.readFileSync(process.env.UNONE_PROFILE_THREE_SOURCE??new URL('./three.js',import.meta.url),'utf8');
const at=name=>source.indexOf(`  function ${name}(`);
const drawStart=at('profileProviders')>=0?at('profileProviders'):at('draw');
const body=source.slice(drawStart,at('clearTextures'))+source.slice(at('rasterLost'),at('rasterAvailable'));
function fixture(profiler){
 const calls=[],noop=()=>{},texture=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);
 const records={white:{state:'ready',texture},pending:{state:'loading'}};let available=true,status='validated',epoch=1;
 const frameDraws=createFrameDraws(THREE,s=>records[s.id]),textureRecords=new Map();
 const context={ui:null,worldSubmitted:false,retireWorldGpuBindings:noop,DRAW_COMPLETED,DRAW_SKIPPED,uiImageBatchPrefix:{clear:noop},profile:profiler?.renderer??null,options:profiler?{profiler}:{},textureCache:createTextureCachePolicy(textureRecords),frameDecoder:createProjectedFrameDecoder(),
  framePublicationIdentity:null,framePresentationIdentity,frameProfile:'rgb8_encoded_rebuild_v1',framePublication:null,assertFrameSnapshot,
  assertProjectedBackend:noop,assertRasterSnapshot:noop,assertFrameGpuError:noop,rasterAvailable:()=>available,projectedEntries:()=>[],heightfieldEntries:()=>[],
  backend:'webgl',rasterPolicy:{requested:'upper_left_checked'},bloom:null,effects:null,lastDrawTime:null,presentationContext:()=>({}),presentationHooks:[],
  renderer:{info:{reset:noop,render:{calls:0,triangles:0},memory:{geometries:0,textures:0}},getContext:()=>({}),render(){calls.push('ordinary');}},worldOf:x=>x,resize:noop,
  checkedRaster:true,validateRaster:()=>true,specsOf:()=>new Map(Object.keys(records).map(id=>[id,{id,kind:'texture2d'}])),visibleSprites:()=>[],records:new Map(),
  shaderMaterials:{retain:noop},scene:{},camera:{},camera3d:{},geometry3d:{draw:()=>false,clear(){},contextLost(){},metrics:()=>({})},curvature:{prepare(){},viewport(){},curvature:0},world3d:{scale:{z:1}},bufferSize:{x:1,y:1},drawInRect:(_,draw)=>draw(),meshEntities:{draw:()=>false,clear(){},contextLost(){}},heightfields:{draw:noop},instances:{draw:noop},particles:{draw:noop},
  projected:{entries:()=>[],prepare:noop,draw:noop,clear(){calls.push('projected.clear');}},rasterPass:{draw:noop,invalidate(){calls.push('rasterPass.invalidate');}},frameDraws,
  framePass:{draw(d,c,frame){calls.push(['pass',frame.draws.length]);d.draw({getPixelRatio:()=>1,setScissor:noop,setScissorTest:noop,render(){calls.push('frame-draw');}},c,1280,720);return true;},invalidate(){calls.push('framePass.invalidate');}},
  startupPresentation:{invalidate(){calls.push('invalidate');},drawn(){calls.push('drawn');}},
  rasterCapability:{metrics:()=>({status,context_epoch:epoch,target_generation:epoch}),lost(){status='lost';calls.push('cap.lost');},restored(){status='unchecked';epoch++;calls.push('cap.restored');}}};
 vm.createContext(context);vm.runInContext(body,context);if(profiler)context.profileProviders?.(profiler);
 const frame=frameProfileCases(1280,720).find(c=>c.id==='alpha-always').frame;
 const snapshot={projected_world_visible:false,projected_frame:frame};
 function draw(s=snapshot){if(!profiler){context.draw(s);return null;}const e=profiler.begin('draw');profiler.within(e,'renderer_draw',()=>context.draw(s));return profiler.end(e,profiler.outcomeOf(e)??'returned');}
 return {context,calls,records,frameDraws,snapshot,frame,draw,setAvailable:v=>available=v};
}
const names=e=>e.spans.filter(s=>s.parent==='renderer_draw').map(s=>s.name);
test('actual draw reports ordered renderer phases, completed outcome, frame geometry and resource deltas',()=>{
 const p=createPlayerProfiler({limit:32}),f=fixture(p),e=f.draw();
 assert.equal(e.status,'completed');
 assert.deepEqual(names(e),['snapshot_policy','frame_decode_validate','frame_identity','legacy_projected_terrain_validate','presentation_hooks','resize_raster_validate',
  'scene_sync','subrenderer_prepare','projected_prepare_texture_sweep','frame_resource_prepare','ordinary_render_submit','frame_pass_submit']);
 const d=f.frame.draws[0];
 assert.deepEqual([e.attrs.frame_revision,e.attrs.frame_draws,e.attrs.frame_geometry_bytes],[String(f.frame.revision),1,d.vertex_count*40+d.index_count*4]);
 assert.equal(e.resources.frame_resources.delta.frame_geometry_builds,1);assert.equal(e.resources.frame_resources.after.frame_live_geometries,1);
 assert.equal(e.resources.frame_decoder.delta.geometry_decodes,1);assert.deepEqual(e.resources.raster.after,{status:'validated',context_epoch:1,target_generation:1});
});
test('repeated redraw without an update is a new draw identity that rebuilds and decodes nothing',()=>{
 const p=createPlayerProfiler({limit:32}),f=fixture(p),a=f.draw(),b=f.draw();
 assert.deepEqual([a.id,b.id],['draw:1','draw:2']);assert.equal(b.status,'completed');
 // Frozen frame draws skip staging for unchanged same-revision content: no rebuild, build, dispose or reuse count.
 assert.deepEqual(['frame_rebuilds','frame_geometry_builds','frame_geometry_disposes','frame_material_builds'].map(k=>b.resources.frame_resources.delta[k]),[0,0,0,0]);
 assert.equal(b.resources.frame_resources.after.frame_live_geometries,a.resources.frame_resources.after.frame_live_geometries);
 assert.equal(b.resources.frame_decoder.delta.geometry_decodes,0);assert.equal(b.resources.frame_decoder.delta.geometry_reuses,1);
});
test('pending textures and unavailable raster are explicit outcomes; context lifecycle is recorded',()=>{
 const p=createPlayerProfiler({limit:32}),f=fixture(p);f.snapshot.projected_frame=structuredClone(f.frame);f.snapshot.projected_frame.draws[0].texture='pending';
 const pending=f.draw();assert.equal(pending.status,'pending_frame_resources');assert.equal(names(pending).at(-1),'frame_resource_prepare');
 assert.equal(pending.resources.frame_resources.delta.frame_geometry_builds,0);
 f.setAvailable(false);assert.equal(f.draw().status,'skipped_raster_unavailable');
 f.context.rasterLost();f.context.rasterLost();f.context.rasterRestored();
 const ctx=p.report().events.filter(e=>e.kind==='context');
 assert.deepEqual(ctx.map(e=>[e.id,e.status,e.attrs.context_epoch]),[['context:1','lost',1],['context:2','restored',2]],'duplicate loss is not a second transition');
});
test('profiling does not change renderer calls, resources or same-revision new-Core behavior',()=>{
 function run(profiler){
  const f=fixture(profiler);f.draw();f.draw();
  const next=structuredClone(f.frame);next.draws[0].texture='pending';f.snapshot.projected_frame=next;f.draw();
  f.records.pending={state:'ready',texture:f.records.white.texture};f.draw();
  next.draws[0].material.depth.write=!next.draws[0].material.depth.write;f.draw();
  return {calls:f.calls,metrics:f.frameDraws.metrics(),decoder:f.context.frameDecoder.metrics()};
 }
 const off=run(null),on=run(createPlayerProfiler({limit:32}));
 assert.deepEqual(on,off);assert.equal(off.metrics.frame_geometry_builds,1,'new Core revision1 with same content keeps geometry');
});
