import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWebglDefaultDepth,assertDefaultDepthOptions,assertDefaultDepthFrame,webglDefaultDepthMetrics} from './webgl-default-depth.js';
import {prepareDesynchronizedWebGL} from './webgl-desynchronized.js';
import {createPlayerRenderer} from '../shared/renderer-selection.mjs';
import {isSuspectedContextLoss} from './link-loss.js';
import fs from 'node:fs';
import vm from 'node:vm';

test('depth declaration is strict, opt-in, and defaults to the previous depth-enabled behavior',()=>{
  assert.equal(normalizeWebglDefaultDepth(),true);
  for(const value of [true,false])assert.equal(normalizeWebglDefaultDepth(value),value);
  for(const value of [null,0,'false',{},[]])assert.throws(()=>normalizeWebglDefaultDepth(value),/WEBGL_DEFAULT_DEPTH_INVALID/);
});

test('official renderer receives explicit depth and custom renderer rejects it',async()=>{
  const hooks={createOfficial:(_canvas,options)=>options,contentRoot:new URL('https://fixture.invalid/content/')};
  assert.equal((await createPlayerRenderer(null,{}, {},hooks)).webglDefaultDepth,undefined);
  assert.equal((await createPlayerRenderer(null,{}, {webgl_default_depth:false},hooks)).webglDefaultDepth,false);
  assert.equal((await createPlayerRenderer(null,{}, {webgl_default_depth:true},hooks)).webglDefaultDepth,true);
  await assert.rejects(createPlayerRenderer(null,{}, {webgl_default_depth:null},hooks),/WEBGL_DEFAULT_DEPTH_INVALID/);
  await assert.rejects(createPlayerRenderer(null,{}, {renderer_mode:'custom',webgl_default_depth:false},hooks),/WEBGL_DEFAULT_DEPTH_OFFICIAL_WEBGL_ONLY/);
});

test('desynchronized precreation and Three receive the same explicit depth policy',()=>{
  for(const depth of [false,true]){
    let actual;
    const canvas={getContext(kind,attrs){assert.equal(kind,'webgl2');actual=attrs;return {getContextAttributes:()=>attrs};}};
    assert.deepEqual(prepareDesynchronizedWebGL(canvas,false,true,depth),{requested:true,attempted:true,precreated:true});
    assert.equal(actual.depth,depth);assert.equal(actual.desynchronized,true);
  }
});

test('backend, checked raster, projected profiles and extension policies fail explicitly',()=>{
  assert.doesNotThrow(()=>assertDefaultDepthOptions({depth:true,declared:false,backend:'webgpu'}));
  assert.throws(()=>assertDefaultDepthOptions({depth:false,declared:true,backend:'webgpu'}),/OFFICIAL_WEBGL_ONLY/);
  assert.throws(()=>assertDefaultDepthOptions({depth:false,declared:true,backend:'webgl',checkedRaster:true}),/PROJECTED_UNSUPPORTED/);
  assert.throws(()=>assertDefaultDepthOptions({depth:false,declared:true,backend:'webgl',frameProfile:{}}),/PROJECTED_UNSUPPORTED/);
  assert.throws(()=>assertDefaultDepthOptions({depth:false,declared:true,backend:'webgl',renderPasses:{'custom.pass':()=>{}}}),/EXTENSIONS_UNSUPPORTED/);
  assert.throws(()=>assertDefaultDepthOptions({depth:false,declared:true,backend:'webgl',presentationCallbacks:true}),/EXTENSIONS_UNSUPPORTED/);
  assert.doesNotThrow(()=>assertDefaultDepthOptions({depth:true,declared:false,backend:'webgl',presentationCallbacks:true}));
});

test('depthless direct drawing rejects depth-sensitive world content instead of silently changing pixels',()=>{
  const base={depth:false,world:{},worldVisible:true,terrain:[],projected:[],offscreenDepth:false,sceneEnabled:true};
  assert.doesNotThrow(()=>assertDefaultDepthFrame(base));
  for(const world of [
    {entities:{a:{sprite:{visible:true}}}},{entities:{a:{mesh3d:{visible:true},transform3d:{}}}},
    {geometry3d:{a:{}}},{instances3d:{a:{}}},{particles:[{}]},{effects:[{}]},
  ])assert.throws(()=>assertDefaultDepthFrame({...base,world}),/WEBGL_DEFAULT_DEPTH_REQUIRED/);
  assert.throws(()=>assertDefaultDepthFrame({...base,terrain:[{}]}),/WEBGL_DEFAULT_DEPTH_REQUIRED/);
  assert.throws(()=>assertDefaultDepthFrame({...base,projected:[{}],offscreenDepth:true}),/PROJECTED_UNSUPPORTED/);
  assert.doesNotThrow(()=>assertDefaultDepthFrame({...base,world:{entities:{a:{sprite:{visible:false}}}}}));
  assert.doesNotThrow(()=>assertDefaultDepthFrame({...base,world:{camera3d:{},entities:{}}}));
  assert.doesNotThrow(()=>assertDefaultDepthFrame({...base,world:{particles:[{}]},offscreenDepth:true}));
  assert.doesNotThrow(()=>assertDefaultDepthFrame({...base,world:{camera3d:{}},sceneEnabled:false}));
  assert.doesNotThrow(()=>assertDefaultDepthFrame({...base,world:{camera3d:{}},depth:true}));
});

test('actual context is reported independently, including mismatch and loss',()=>{
  assert.deepEqual(webglDefaultDepthMetrics({getContext:()=>({getContextAttributes:()=>({depth:true})})},false,'webgl'),
    {requested:false,backend:'webgl',actual:true,scope:'default_framebuffer',reconfigure:'relaunch'});
  assert.equal(webglDefaultDepthMetrics({getContext(){throw Error('lost')}},false,'webgl').actual,null);
  assert.equal(webglDefaultDepthMetrics({},true,'webgpu').actual,null);
  let lost=false;
  const renderer={getContext:()=>({getContextAttributes:()=>lost?null:{depth:false}})};
  assert.equal(webglDefaultDepthMetrics(renderer,false,'webgl').actual,false);
  lost=true;assert.equal(webglDefaultDepthMetrics(renderer,false,'webgl').actual,null);
  lost=false;assert.equal(webglDefaultDepthMetrics(renderer,false,'webgl').actual,false);
});

test('depth policy errors remain fatal through the real suspected-loss draw wrapper',()=>{
  const source=fs.readFileSync(new URL('./three.js',import.meta.url),'utf8');
  const start=source.indexOf('  function drawOrSkip('),end=source.indexOf('\n  return {',start);
  assert(start>=0&&end>start,'official wrapper exists');
  let resets=0;
  const ctx={draw(){assertDefaultDepthFrame({depth:false,world:{particles:[{}]}});},isSuspectedContextLoss,
    renderer:{resetState(){resets++;}},startupPresentation:null,profile:null,DRAW_SKIPPED:{raster_unavailable:'skipped'}};
  vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
  assert.throws(()=>ctx.drawOrSkip({}),/WEBGL_DEFAULT_DEPTH_REQUIRED/);
  assert.equal(resets,0,'a depth contract error is not a context-loss skip');
  assert.equal(isSuspectedContextLoss(Error('WEBGL_DEFAULT_DEPTH_REQUIRED')),false);
});
