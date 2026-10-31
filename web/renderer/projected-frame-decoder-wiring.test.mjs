import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createTextureCachePolicy} from './texture-cache-policy.js';
import {DRAW_COMPLETED,DRAW_SKIPPED} from '../shared/player-completion.mjs';
const source=fs.readFileSync(process.env.UNONE_DECODER_THREE_SOURCE??new URL('./three.js',import.meta.url),'utf8');
const between=(a,b)=>source.slice(source.indexOf(`  function ${a}(`),source.indexOf(`  function ${b}(`));
function fixture(){
 const calls={uncached:0,retained:0,cleared:0},noop=()=>{};
 const context={ui:null,worldSubmitted:false,DRAW_COMPLETED,DRAW_SKIPPED,uiImageBatchPrefix:{clear:noop},projectedFrame:()=>{calls.uncached++;return null;},frameDecoder:{decode:()=>{calls.retained++;return null;},clear(){calls.cleared++;}},
  assertFrameSnapshot:noop,frameProfile:null,framePublication:null,assertProjectedBackend:noop,assertRasterSnapshot:noop,rasterAvailable:()=>true,
  projectedEntries:()=>[],heightfieldEntries:()=>[],rasterPolicy:{requested:'off'},backend:'webgl',bloom:null,effects:null,lastDrawTime:null,presentationContext:()=>({}),presentationHooks:[],
  renderer:{info:{reset:noop},render:noop},worldOf:x=>x,resize:noop,checkedRaster:false,specsOf:()=>new Map(),visibleSprites:()=>[],records:new Map(),
  shaderMaterials:{retain:noop,clear:noop},scene:{remove:noop},camera:{},camera3d:{},geometry3d:{draw:()=>false,clear(){},contextLost(){},metrics:()=>({})},curvature:{prepare(){},viewport(){},curvature:0},world3d:{scale:{z:1}},bufferSize:{x:1,y:1},drawInRect:(_,draw)=>draw(),meshEntities:{draw:()=>false,clear(){},contextLost(){}},meshAssets:new Map(),heightfields:{draw:noop,clear:noop},
  instances:{draw:noop,clear:noop},particles:{draw:noop},projected:{entries:()=>[],prepare:noop,draw:noop,clear:noop},rasterPass:null,startupPresentation:null,frameDraws:null,
  textureCache:createTextureCachePolicy(new Map()),profile:null};
 vm.createContext(context);vm.runInContext(between('draw','clearTextures')+between('clearTextures','dispose'),context);
 return {context,calls};
}
test('actual draw decodes every presentation pass through one retained frame decoder',()=>{
 const f=fixture(),snapshot={entities:{},projected_world_visible:false};
 f.context.draw(snapshot);f.context.draw(snapshot);
 assert.deepEqual(f.calls,{uncached:0,retained:2,cleared:0});
});
test('actual clearTextures releases retained decoded frame geometry',()=>{
 const f=fixture();f.context.clearTextures();assert.equal(f.calls.cleared,1);
});
