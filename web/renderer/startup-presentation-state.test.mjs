import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createStartupPresentationState} from './startup-presentation-state.js';
import {createRasterCapability} from './projected-raster-capability.js';
import {createTextureCachePolicy} from './texture-cache-policy.js';
import {createProjectedFrameDecoder} from '../shared/projected-frame.mjs';
import {DRAW_COMPLETED,DRAW_SKIPPED} from '../shared/player-completion.mjs';
function fixture(){
 let lost=false,width=1280,height=720,dpr=1,renders=0;const trace=[];
 const cap=createRasterCapability({policy:{requested:'upper_left_checked'},profile:{version:'test',hash:'ab'},validate:()=>({samples:1,passed:1})});
 const view=()=>({width,height,dpr});cap.ensure(view());
 const available=()=>{if(lost){cap.lost();return false;}return cap.metrics().status!=='lost';};
 const startup=createStartupPresentationState({available,metrics:cap.metrics,view});
 const noop=()=>{},projected={entries:()=>[],prepare:noop,draw:noop},snapshot={entities:{},projected_world_visible:false};
 const context={spritePresentation:null,spriteResources:null,ui:null,worldSubmitted:false,DRAW_COMPLETED,DRAW_SKIPPED,uiImageBatchPrefix:{clear:noop},projectedFrame:()=>null,assertFrameSnapshot:noop,frameProfile:null,framePublication:null,assertProjectedBackend:noop,assertRasterSnapshot:noop,rasterAvailable:available,projectedEntries:()=>[],heightfieldEntries:()=>[],
  rasterPolicy:{requested:'upper_left_checked'},backend:'webgl',bloom:null,effects:null,lastDrawTime:null,presentationContext:()=>({}),presentationHooks:[],renderer:{info:{reset:noop},render(){renders++;}},
  worldOf:x=>x,resize:noop,checkedRaster:true,validateRaster:()=>cap.ensure(view()),specsOf:()=>new Map(),visibleSprites:()=>[],records:new Map(),
  shaderMaterials:{retain:noop},scene:{},camera:{},camera3d:{},dataTextures:{sync(){},clear(){},contextLost(){},metrics:()=>({})},geometry3d:{draw:()=>false,clear(){},contextLost(){},metrics:()=>({})},curvature:{prepare(){},viewport(){},curvature:0},world3d:{scale:{z:1}},bufferSize:{x:1,y:1},drawInRect:(_,draw)=>draw(),meshEntities:{draw:()=>false,clear(){},contextLost(){}},heightfields:{draw:noop},instances:{draw:noop},particles:{draw:noop},
  projected,rasterPass:{draw:noop},startupPresentation:startup,
  // draw() begins/sweeps the production texture cache; supply the real default (unbounded) policy.
  textureCache:createTextureCachePolicy(new Map()),frameDecoder:createProjectedFrameDecoder(),profile:null};
 const source=fs.readFileSync(process.env.UNONE_STARTUP_THREE_SOURCE??new URL('./three.js',import.meta.url),'utf8');
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  function draw('),source.indexOf('  function clearTextures(')),context);
 return {startup,cap,context,snapshot,trace,get renders(){return renders;},lose(){lost=true;},
  restore(){lost=false;cap.restored();startup.changed();},resize(w,h,r){width=w;height=h;dpr=r;},
  draw:()=>context.draw(snapshot)};
}
test('actual production game draw completes a legal empty pass before startup token exists',()=>{
 const f=fixture();assert.equal(f.startup.sample().state,'needs_draw');f.draw();assert.equal(f.renders,1);
 assert.equal(f.startup.sample().state,'presented');assert.equal(f.startup.metrics().game_draw_sequence,1);
 const copy=f.startup.metrics();copy.physical_size[0]=1;assert.deepEqual(f.startup.metrics().physical_size,[1280,720]);
});
test('actual lost skipped draw cannot count; new epoch/physical-size/DPR need another completed game pass',()=>{
 const f=fixture();f.draw();f.lose();f.draw();assert.equal(f.renders,1);assert.equal(f.startup.sample().state,'lost');
 f.restore();assert.equal(f.startup.sample().state,'needs_draw');f.draw();assert.equal(f.startup.metrics().context_epoch,2);
 f.resize(800,600,2);assert.equal(f.startup.sample().state,'needs_draw');f.draw();
 assert.deepEqual(f.startup.metrics().physical_size,[800,600]);assert.equal(f.startup.metrics().dpr,2);
 assert.equal(f.startup.metrics().game_draw_sequence,3);assert.equal(f.startup.metrics().target_generation,3);
});
test('loss during actual host render revokes token, subscription cleanup and dispose are idempotent',()=>{
 const f=fixture();let changes=0;const off=f.startup.subscribe(()=>changes++);f.draw();
 f.context.renderer.render=()=>f.lose();f.draw();assert.equal(f.startup.metrics(),null);assert.equal(f.startup.sample().state,'lost');
 f.startup.changed();assert.equal(changes,1);off();off();f.startup.changed();assert.equal(changes,1);
 const off2=f.startup.subscribe(()=>changes++);f.startup.dispose();f.startup.dispose();off2();assert.equal(changes,2);
 assert.throws(()=>f.startup.sample(),/DISPOSED/);
});
