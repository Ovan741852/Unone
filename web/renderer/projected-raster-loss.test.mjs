import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRasterCapability} from './projected-raster-capability.js';
import {assertRasterProfile} from './projected-raster-policy.js';
import {createTextureCachePolicy} from './texture-cache-policy.js';
import {createProjectedFrameDecoder} from '../shared/projected-frame.mjs';
const path=process.env.UNONE_RASTER_THREE_SOURCE??new URL('./three.js',import.meta.url);
const source=fs.readFileSync(path,'utf8');
function body(name,next){return source.slice(source.indexOf(`  function ${name}(`),source.indexOf(`  function ${next}(`));}
function fixture(){
 let lost=false,attrs=0,invalidates=0,clears=0,resizes=0,queries=0,hooks=0;
 class WebGL2RenderingContext{isContextLost(){return lost;}getContextAttributes(){attrs++;return lost?null:{antialias:false};}}
 const gl=new WebGL2RenderingContext(),states=[];
 const cap=createRasterCapability({policy:{requested:'upper_left_checked',declared:true},profile:{version:'test',hash:'aa'},
  validate:()=>({samples:1,passed:1}),onState:s=>states.push(s)});
 cap.ensure({width:1280,height:720,dpr:1});
 const renderer={getContext:()=>gl,getDrawingBufferSize:v=>{queries++;return {x:1280,y:720};},getPixelRatio:()=>1,
  outputColorSpace:'srgb',toneMapping:'none',capabilities:{},info:{reset(){throw Error('GPU resources reached');}}};
 const context={frameDraws:null,framePass:null,projectedFrame:()=>null,frameProfile:null,framePublication:null,assertFrameSnapshot(){},renderer,rasterCapability:cap,projected:{entries:()=>[],clear(){clears++;}},rasterPass:{invalidate(){invalidates++;}},
  checkedRaster:true,rasterPolicy:{requested:'upper_left_checked'},WebGL2RenderingContext,assertRasterProfile,
  antialias:false,bloomEnabled:false,aoEnabled:false,options:{},THREE:{Vector2:class{},SRGBColorSpace:'srgb',NoToneMapping:'none'},
  assertProjectedBackend(){},assertRasterSnapshot(){},projectedEntries:()=>[],heightfieldEntries:()=>[],backend:'webgl',bloom:null,
  lastDrawTime:null,presentationContext:()=>({}),presentationHooks:[{beforeRender(){hooks++;lost=true;}}],
  resize(){resizes++;},worldOf:x=>x,
  // draw() begins/sweeps the production texture cache; supply the real default (unbounded) policy.
  textureCache:createTextureCachePolicy(new Map()),frameDecoder:createProjectedFrameDecoder(),profile:null};
 vm.createContext(context);
 // Execute the actual production entry functions with allocation/query sentinels.
 const start=source.indexOf('  function validateRaster('),end=source.indexOf('  canvas.addEventListener',start);
 vm.runInContext(source.slice(start,end)+body('draw','clearTextures'),context);
 return {context,cap,states,renderer,gl,setLost:v=>lost=v,counts:()=>({attrs,invalidates,clears,resizes,queries,hooks})};
}
test('actual draw detects raw context loss before event, AA query, resize or GPU allocation',()=>{
 const f=fixture();f.setLost(true);assert.doesNotThrow(()=>f.context.draw({projected_world_visible:false}));
 assert.equal(f.cap.metrics().status,'lost');assert.deepEqual(f.counts(),{attrs:0,invalidates:1,clears:1,resizes:0,queries:0,hooks:0});
 const n=f.states.length;f.context.rasterLost();assert.equal(f.states.length,n);assert.equal(f.counts().invalidates,1);
 assert.equal(f.cap.metrics().context_epoch,1);f.setLost(false);f.context.rasterRestored();f.context.rasterRestored();
 assert.equal(f.cap.metrics().context_epoch,2);assert.equal(f.cap.metrics().status,'unchecked');
 assert.equal(f.context.validateRaster(),true);assert.equal(f.cap.metrics().last_validation.context_epoch,2);
});
test('actual draw rechecks after external hook, before resize and GPU resources',()=>{
 const f=fixture();assert.doesNotThrow(()=>f.context.draw({projected_world_visible:false}));
 assert.equal(f.cap.metrics().status,'lost');assert.equal(f.counts().hooks,1);assert.equal(f.counts().resizes,0);
 assert.equal(f.counts().attrs,0);
});
test('actual profile query handles loss between isContextLost and getContextAttributes',()=>{
 const f=fixture();f.gl.getContextAttributes=()=>{f.setLost(true);return null;};
 assert.equal(f.context.validateRaster(),false);assert.equal(f.cap.metrics().status,'lost');assert.equal(f.counts().queries,0);
});
test('loss discovered by actual validation is recoverable, duplicate events do not create epochs',()=>{
 let first=true;const states=[],cap=createRasterCapability({policy:{requested:'upper_left_checked'},profile:{version:'test',hash:'ab'},
  onState:s=>states.push(s),validate:()=>first?(first=false,{lost:true}):({samples:3,passed:3})});
 assert.equal(cap.ensure({width:1280,height:720,dpr:1}),false);assert.equal(cap.metrics().status,'lost');
 assert.equal(cap.metrics().failure,null);assert.equal(cap.metrics().last_validation,null);cap.lost();cap.restored();cap.restored();
 assert.equal(cap.metrics().context_epoch,2);assert.equal(cap.ensure({width:1280,height:720,dpr:1}),true);
 assert.deepEqual(states.map(s=>s.status),['checking','lost','unchecked','checking','validated']);
 cap.dispose();cap.lost();cap.restored();assert.equal(cap.metrics().status,'disposed');
});
