// A link failure with empty logs on a live context is a suspected loss
// (link-loss.js): seen in Android Chrome when the GPU process died and
// webglcontextlost arrived only after the next program link failed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../vendor/three/three.module.js';
import {createLinkLossGuard,isSuspectedContextLoss,suspectedContextLoss,LINK_LOSS_WAIT_MS} from './link-loss.js';
import {createShaderMaterials} from './shader-materials.js';
import {createGpuUi} from './ui-gpu.js';
import {createSpriteResourcePool} from './sprite-resources.js';
import {createRasterCapability} from './projected-raster-capability.js';
import {createTextureCachePolicy} from './texture-cache-policy.js';
import {createAssetCatalog,createImageAssetBroker} from '../shared/asset-encoding.js';
import {DRAW_COMPLETED,DRAW_SKIPPED} from '../shared/player-completion.mjs';

const source=fs.readFileSync(new URL('./three.js',import.meta.url),'utf8');
function between(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a,`three.js section ${start}`);return source.slice(a,b);}
// The actual production availability check and draw wrapper.
const production=between('  function rasterAvailable(',"  canvas.addEventListener('webglcontextlost',rasterLost)")+between('  function drawOrSkip(','\n  return {');

function clock(){
 let now=0,next=1;const timers=new Map();
 return {now:()=>now,setTimer:(run,ms)=>{const id=next++;timers.set(id,{run,at:now+ms});return id;},clearTimer:id=>timers.delete(id),
  timers:()=>timers.size,advance(ms){now+=ms;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.run();}}};
}
// WebGL answers getProgramParameter with null once the context is lost.
function fakeGl({programLog='',shaderLog=''}={}){
 let lost=false;const deleted=[];
 return {LINK_STATUS:0x8B82,deleted,isContextLost:()=>lost,setLost(value){lost=value;},getProgramParameter:program=>lost?null:program.linked,
  getProgramInfoLog:()=>programLog,getShaderInfoLog:()=>shaderLog,getShaderSource:()=>'void main(){gl_FragColor=vec4(1.0);}',deleteShader(shader){deleted.push(shader);}};
}
// The pinned three.js checks LINK_STATUS on a program's first use and calls
// debug.onShaderError; a throw leaves the program unchecked for its next use.
function threeProgram(renderer,gl,linked){
 const glProgram={linked};let cached;
 return {glProgram,getUniforms(){if(cached===undefined){if(renderer.debug.checkShaderErrors&&gl.getProgramParameter(glProgram,gl.LINK_STATUS)===false)renderer.debug.onShaderError(gl,glProgram,{stage:'vertex'},{stage:'fragment'});cached={};}return cached;}};
}

function playerFixture(logs){
 const c=clock(),canvas=new EventTarget(),gl=fakeGl(logs),notified=[];
 const linkLoss=createLinkLossGuard({canvas,...c,onChange:outcome=>notified.push(outcome)});
 const renderer={debug:{},resets:0,getContext:()=>gl,resetState(){this.resets++;}};
 const materials=createShaderMaterials(THREE,renderer,'webgl',{linkLoss});
 let status='host',program=threeProgram(renderer,gl,false),checks=0;
 const context={renderer,linkLoss,DRAW_COMPLETED,DRAW_SKIPPED,isSuspectedContextLoss,startupPresentation:null,profile:null,
  rasterCapability:{metrics:()=>({status})},rasterLost(){status='lost';},
  // Stands in for three.js draw(): skip while raster is unavailable, else render, which first uses the program.
  draw(){if(!context.rasterAvailable())return DRAW_SKIPPED.raster_unavailable;checks++;program.getUniforms();return DRAW_COMPLETED;}};
 vm.createContext(context);vm.runInContext(production,context);
 canvas.addEventListener('webglcontextlost',()=>context.rasterLost());
 // On restore three.js rebuilds every program in the new context.
 canvas.addEventListener('webglcontextrestored',()=>{status='host';program=threeProgram(renderer,gl,true);});
 return {c,canvas,gl,linkLoss,renderer,notified,draw:()=>context.drawOrSkip({}),checks:()=>checks,status:()=>status,
  dispose(){materials.dispose();linkLoss.dispose();}};
}

test('empty link logs on a live context skip frames until the loss that arrives later, and the player recovers',async()=>{
 const f=playerFixture();try{
  assert.equal(f.draw(),DRAW_SKIPPED.raster_unavailable,'the frame whose link failed is skipped, not fatal');
  assert.equal(f.renderer.resets,1,'three.js GL state is reset after the draw unwound');
  assert.deepEqual(f.gl.deleted,[],'the shaders stay attached so the program can be checked again');
  const settled=f.linkLoss.settled();
  f.c.advance(1000);assert.equal(f.draw(),DRAW_SKIPPED.raster_unavailable);
  assert.equal(f.checks(),1,'no draw reaches GPU work while the wait is open');
  f.gl.setLost(true);f.canvas.dispatchEvent(new Event('webglcontextlost'));
  assert.equal(await settled,'lost');assert.equal(f.linkLoss.pending(),false);assert.equal(f.status(),'lost');
  assert.equal(f.draw(),DRAW_SKIPPED.raster_unavailable);
  f.gl.setLost(false);f.canvas.dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(f.draw(),DRAW_COMPLETED);
  f.c.advance(10*LINK_LOSS_WAIT_MS);assert.equal(f.c.timers(),0);
  assert.equal(f.draw(),DRAW_COMPLETED,'a closed wait leaves nothing that fails later');
  assert.deepEqual(f.notified,['suspected','lost']);
  assert.deepEqual(f.linkLoss.metrics(),{waiting:false,suspected_losses:1,last_outcome:'lost',wait_ms:LINK_LOSS_WAIT_MS});
 }finally{f.dispose();}
});

test('isContextLost() turning true before webglcontextlost also ends the wait as a loss',async()=>{
 const f=playerFixture();try{
  assert.equal(f.draw(),DRAW_SKIPPED.raster_unavailable);const settled=f.linkLoss.settled();
  f.gl.setLost(true);
  assert.equal(f.draw(),DRAW_SKIPPED.raster_unavailable);assert.equal(f.status(),'lost','the raw flag reaches the ordinary loss path');
  assert.equal(await settled,'lost');assert.equal(f.c.timers(),0);
 }finally{f.dispose();}
});

test('a link failure with a log fails at once with SHADER_COMPILE_FAILED',()=>{
 const f=playerFixture({shaderLog:"ERROR: 0:3: 'strength' : undeclared identifier"});try{
  assert.throws(()=>f.draw(),error=>/^SHADER_COMPILE_FAILED: engine-program\n/.test(error.message)&&error.message.includes('undeclared identifier')&&!isSuspectedContextLoss(error));
  assert.equal(f.linkLoss.pending(),false);assert.equal(f.c.timers(),0);assert.deepEqual(f.notified,[]);
  assert.equal(f.gl.deleted.length,2);
 }finally{f.dispose();}
});

test('empty link logs and no loss: the same program fails with SHADER_COMPILE_FAILED after the bounded wait',()=>{
 const f=playerFixture();try{
  assert.equal(f.draw(),DRAW_SKIPPED.raster_unavailable);
  f.c.advance(LINK_LOSS_WAIT_MS-1);assert.equal(f.draw(),DRAW_SKIPPED.raster_unavailable);assert.equal(f.checks(),1);
  f.c.advance(1);assert.deepEqual(f.notified,['suspected','alive'],'the end of the wait is announced, so a waiting startup samples again');
  assert.throws(()=>f.draw(),error=>/^SHADER_COMPILE_FAILED: engine-program\n/.test(error.message)
   &&error.message.includes(`empty logs and the context stayed alive through a ${LINK_LOSS_WAIT_MS} ms wait`));
  assert.equal(f.checks(),2);assert.equal(f.gl.deleted.length,2);
 }finally{f.dispose();}
});

test('a wait that ended alive condemns only the programs that failed in it',()=>{
 const c=clock(),gl=fakeGl(),linkLoss=createLinkLossGuard(c),empty={program:'',vertex:'',fragment:''};
 const first={},second={},third={};
 assert.equal(linkLoss.classify(gl,first,empty),'suspected');
 assert.equal(linkLoss.classify(gl,second,empty),'suspected','another failure in the same wait joins it');
 assert.equal(linkLoss.classify(gl,first,empty),'suspected','checking again before the wait ends keeps waiting');
 c.advance(LINK_LOSS_WAIT_MS);
 assert.equal(linkLoss.classify(gl,first,empty),'fatal');assert.equal(linkLoss.classify(gl,second,empty),'fatal');
 assert.equal(linkLoss.classify(gl,third,empty),'suspected','a later program gets its own wait');
 gl.setLost(true);assert.equal(linkLoss.classify(gl,third,empty),'suspected');assert.equal(linkLoss.pending(),false);
 gl.setLost(false);assert.equal(linkLoss.classify(gl,first,empty),'suspected','a loss forgets programs of the old context');
 linkLoss.dispose();assert.equal(c.timers(),0);
});

function uiFixture(){
 let failure=null,resets=0;const calls=[];
 const renderer={autoClear:true,capabilities:{maxTextureSize:4096},getDrawingBufferSize:v=>v.set(100,100),getPixelRatio:()=>1,
  getContext:()=>({isContextLost:()=>false}),getScissorTest:()=>false,getRenderTarget:()=>'host-target',getViewport:v=>v.set(0,0,100,100),
  setRenderTarget(target){calls.push(['target',target]);},setScissorTest(){},setViewport(){},compile(){},properties:{get:()=>({currentProgram:{getUniforms(){}}})},
  initTexture(){},resetState(){resets++;},render(){if(failure)throw failure;calls.push('render');}};
 const gpu=createGpuUi(THREE,renderer);
 const box={kind:'box',id:'panel',rect:{x:0,y:0,width:50,height:50},style:{background:'#336699'}};
 const draw=()=>gpu.draw({nodes:[box],images:new Map(),batches:new Map(),scale:1,changed:true,identity:'fixture',hasText:()=>false,imageError(){}});
 return {gpu,calls,draw,fail(error){failure=error;},resets:()=>resets};
}

test('the GPU UI skips a frame whose program link is a suspected loss and still fails on other errors',()=>{
 const f=uiFixture();try{
  f.fail(suspectedContextLoss('engine-program'));
  assert.deepEqual(f.draw(),{skipped:true,regions:0});assert.equal(f.resets(),1);
  assert.deepEqual(f.calls.at(-1),['target','host-target'],'render state is restored after the skipped draw');
  f.fail(null);assert.equal(f.draw().skipped,false);assert(f.calls.includes('render'));
  f.fail(Error('SHADER_COMPILE_FAILED: engine-program'));assert.throws(()=>f.draw(),/SHADER_COMPILE_FAILED/);
 }finally{f.gpu.dispose();}
});

const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const spriteMaterial={fragment:'vec4 unoneShade(vec2 uv,vec4 color){return color;}',uniforms:{}};
// three.js fills program.diagnostics when no hook is installed; withHook routes
// first use through the engine's shader hook instead, as the player does.
function spriteFixture({logs={},withHook=false}={}){
 const c=clock(),canvas=new EventTarget(),gl=fakeGl({programLog:logs.program,shaderLog:logs.shader});
 const linkLoss=createLinkLossGuard({canvas,...c});
 const catalog=createAssetCatalog({assets:[{id:'a',kind:'texture2d',source:'a.png',encoding:{decoder:'image',format:'png',mime:'image/png'}}]});
 const broker=createImageAssetBroker(catalog,{resolveAssetUrl:a=>a.id,inspectImage:async()=>({format:'png',width:2,height:2}),loadImage:async()=>({width:2,height:2,close(){}}),unusedMaxBytes:0,unusedMaxEntries:0});
 let linked=false,compiles=0;const programs=new Map();
 const renderer={debug:{},capabilities:{maxTextureSize:2048},getContext:()=>gl,initTexture(){},
  compile(scene){compiles++;const material=scene.children[0].material;
   if(!programs.has(material)){
    const program=withHook?threeProgram(renderer,gl,linked):{program:{},diagnostics:linked?undefined:{runnable:false,programLog:logs.program??'',vertexShader:{log:logs.shader??''},fragmentShader:{log:logs.shader??''}},getUniforms(){}};
    programs.set(material,program);}},
  properties:{get:material=>({currentProgram:programs.get(material)})}};
 const materials=withHook?createShaderMaterials(THREE,renderer,'webgl',{linkLoss}):null;
 const pool=createSpriteResourcePool({THREE,renderer,textureCache:createTextureCachePolicy(new Map()),getCatalog:()=>catalog,getImages:()=>broker,budget:{max_bytes:128,max_entries:8},linkLoss});
 return {c,canvas,gl,linkLoss,pool,compiles:()=>compiles,link(){linked=true;programs.clear();},
  prepare:()=>pool.public.prepare({id:'1',asset:'a',material_id:'glow',material:spriteMaterial}),
  dispose(){pool.dispose();materials?.dispose();linkLoss.dispose();broker.dispose();}};
}

test('a sprite material whose link is a suspected loss waits; the loss refences it and the restore prepares it',async()=>{
 for(const withHook of [false,true]){
  const f=spriteFixture({withHook});try{
   const lease=f.prepare();await flush();
   assert.equal(lease.state,'loading','not an error while the loss is suspected');assert.equal(f.linkLoss.pending(),true);assert.equal(f.compiles(),1);
   f.gl.setLost(true);f.pool.contextLost();f.canvas.dispatchEvent(new Event('webglcontextlost'));await flush();
   assert.equal(lease.state,'loading');assert.deepEqual(f.pool.public.takeUpdates().resources.map(r=>r.state).filter(s=>s==='error'),[]);
   f.gl.setLost(false);f.link();f.canvas.dispatchEvent(new Event('webglcontextrestored'));f.pool.contextRestored();
   await lease.readyPromise;assert.equal(lease.state,'ready');assert.equal(f.compiles(),2);
  }finally{f.dispose();}
 }
});

test('a sprite material with empty link logs and no loss fails after the wait; one with a log fails at once',async()=>{
 for(const withHook of [false,true]){
  const f=spriteFixture({withHook});try{
   const lease=f.prepare();await flush();assert.equal(lease.state,'loading');
   f.c.advance(LINK_LOSS_WAIT_MS);await flush();
   assert.equal(lease.state,'error');assert.match(lease.error,withHook?/^SHADER_COMPILE_FAILED: engine-program\n[^]*stayed alive/:/^SPRITE_RESOURCE_SHADER_COMPILE_FAILED/);
   assert.equal(f.compiles(),2,'the same program is checked once more after the wait');
  }finally{f.dispose();}
  const g=spriteFixture({withHook,logs:{shader:'ERROR: 0:1: syntax error'}});try{
   const lease=g.prepare();await flush();
   assert.equal(lease.state,'error');assert.equal(g.linkLoss.pending(),false);assert.equal(g.compiles(),1);
  }finally{g.dispose();}
 }
});

test('checked raster validation that meets a suspected loss checks again instead of failing for good',()=>{
 let failure=suspectedContextLoss('engine-program');
 const cap=createRasterCapability({policy:{requested:'upper_left_checked',declared:true},profile:{version:'test',hash:'aa'},
  validate:()=>{if(failure)throw failure;return {samples:1,passed:1};}}),view={width:64,height:64,dpr:1};
 assert.equal(cap.ensure(view),false);assert.equal(cap.metrics().status,'unchecked');assert.equal(cap.metrics().failure,null);
 failure=null;assert.equal(cap.ensure(view),true);
 cap.lost();cap.restored();failure=Error('SHADER_COMPILE_FAILED: engine-program');
 assert.throws(()=>cap.ensure(view),/PROJECTED_RASTER_CAPABILITY_FAILED.*SHADER_COMPILE_FAILED/s);
});
