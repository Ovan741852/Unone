import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {projectedFrame,createProjectedFrameDecoder} from '../shared/projected-frame.mjs';
import {assertFrameSnapshot} from './projected-frame-policy.js';
import {createStartupPresentationState} from './startup-presentation-state.js';
import {createFrameDraws} from './projected-frame-draws.js';import {frameProfileCases} from './projected-frame-profile.js';
import * as THREE from '../vendor/three/three.player.min.js';
import {framePresentationIdentity} from './projected-frame-publication.js';
import {assertFrameGpuError} from './projected-frame-target-query.js';
import {DRAW_COMPLETED,DRAW_SKIPPED} from '../shared/player-completion.mjs';
const frameFixture=()=>({profile:'rgb8_encoded_rebuild_v1',initial:{rgb8:[17,24,39],depth:1},draws:[],revision:1});
function fixture(){
 const events=[],noop=()=>{};let complete=true;
 const context={DRAW_COMPLETED,DRAW_SKIPPED,uiImageBatchPrefix:{clear:noop},profile:null,textureCache:{begin:noop,sweep:noop},framePublicationIdentity:null,framePresentationIdentity,frameProfile:'rgb8_encoded_rebuild_v1',framePublication:null,projectedFrame,frameDecoder:createProjectedFrameDecoder(),assertFrameSnapshot,
  assertProjectedBackend:noop,assertRasterSnapshot:noop,assertFrameGpuError:noop,rasterAvailable:()=>true,projectedEntries:()=>[],heightfieldEntries:()=>[],
  backend:'webgl',rasterPolicy:{requested:'upper_left_checked'},bloom:null,effects:null,lastDrawTime:null,presentationContext:()=>({}),presentationHooks:[],
  renderer:{info:{reset:noop},getContext:()=>({NO_ERROR:0,getError:()=>0}),render(){events.push('ordinary');}},worldOf:x=>x,resize:noop,
  checkedRaster:true,validateRaster:()=>true,specsOf:()=>new Map(),visibleSprites:()=>[],records:new Map(),shaderMaterials:{retain:noop},
  scene:{},camera:{},camera3d:{},meshes3d:new Map(),heightfields:{draw:noop},instances:{draw:noop},particles:{draw:noop},
  projected:{entries:()=>[],prepare:noop,draw:noop},rasterPass:{draw:noop},
  frameDraws:{prepare(frame){events.push(['prepare',frame.draws.length]);return true;}},
  framePass:{draw(draws,camera,frame){events.push(['frame',frame.revision]);return complete;}},
  startupPresentation:{invalidate(){},drawn(){events.push('completed');}}};
 const source=fs.readFileSync(process.env.UNONE_FRAME_THREE_SOURCE??new URL('./three.js',import.meta.url),'utf8');vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('  function draw('),source.indexOf('  function clearTextures(')),context);
 const snapshot={projected_world_visible:false,projected_frame:frameFixture()};
 return {context,events,snapshot,draw:()=>context.draw(snapshot),incomplete:()=>complete=false};
}
test('actual official draw routes ordered Frame once and publishes only the completed frame revision',()=>{
 const f=fixture();f.draw();assert.equal(f.events.filter(e=>e[0]==='prepare').length,1);
 assert.equal(f.events.filter(e=>e[0]==='frame').length,1);assert.equal(f.events.at(-1),'completed');
 assert.equal(f.context.framePublication.revision,1);
});
test('actual official draw rejects undeclared Frame and missing/visible-world snapshots before GPU',()=>{
 const f=fixture();f.context.frameProfile=null;assert.throws(f.draw,/FRAME_NOT_DECLARED/);assert.deepEqual(f.events,[]);
 f.context.frameProfile='rgb8_encoded_rebuild_v1';delete f.snapshot.projected_frame;assert.throws(f.draw,/FRAME_REQUIRED/);
 f.snapshot.projected_frame=frameFixture();f.snapshot.projected_world_visible=true;assert.throws(f.draw,/FRAME_WORLD_DEPTH_UNSUPPORTED/);
});
test('actual Frame pass incomplete return never publishes completed-game token',()=>{
 const f=fixture();f.incomplete();f.draw();assert.equal(f.events.filter(e=>e==='completed').length,0);
});
test('new Core revision1 with new pending texture revokes the previous completed-game proof',()=>{
 const f=fixture(),texture=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);let ready=false;
 const records={white:{state:'ready',texture},pending:{state:'loading'}},draws=createFrameDraws(THREE,s=>records[s.id]);
 f.context.frameDraws=draws;f.context.specsOf=()=>new Map(Object.keys(records).map(id=>[id,{id,kind:'texture2d'}]));
 const metrics=()=>({status:'validated',context_epoch:1,target_generation:1,last_validation:{context_epoch:1,target_generation:1,physical_size:[1280,720],dpr:1}});
 const state=createStartupPresentationState({available:()=>true,metrics,view:()=>({width:1280,height:720,dpr:1,material_profile:f.context.frameProfile,frame_revision:f.context.framePublication?.revision??null})});
 f.context.startupPresentation=state;const frame=frameProfileCases(1280,720).find(c=>c.id==='alpha-always').frame;frame.revision=1;
 f.snapshot.projected_frame=frame;f.draw();assert.equal(state.sample().state,'presented');
 const next=structuredClone(frame);next.draws[0].texture='pending';f.snapshot.projected_frame=next;f.draw();
 assert.equal(state.sample().state,'needs_draw');assert.equal(state.metrics(),null);
 records.pending={state:'ready',texture};f.draw();assert.equal(state.sample().state,'presented');assert.equal(state.metrics().game_draw_sequence,2);
 draws.clear();texture.dispose();state.dispose();
});

test('actual entry attributes an ordinary-render GPU error before invoking the game Frame pass',()=>{
 const f=fixture();let pending=0;f.context.assertFrameGpuError=assertFrameGpuError;
 f.context.renderer.getContext=()=>({NO_ERROR:0,getError(){const e=pending;pending=0;return e;}});
 f.context.renderer.render=()=>{pending=0x0500;};
 assert.throws(f.draw,/stage=official\.ordinary-render gl_error=0x0500/);
 assert(!f.events.some(e=>e[0]==='frame'));assert(!f.events.includes('completed'));
});
