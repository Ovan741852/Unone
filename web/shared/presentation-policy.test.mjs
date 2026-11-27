import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {PRESENTATION_POLICY} from './presentation-policy.mjs';
import {prepareDesynchronizedWebGL} from '../renderer/webgl-desynchronized.js';
import {inspectHostSnapshot,resolveSystems,assembleHost,validateDependencies} from '../../scripts/web-export-host.mjs';

const source=fs.readFileSync(new URL('../renderer/three.js',import.meta.url),'utf8');
const begin=source.indexOf('export async function createThreeRenderer(');
const end=source.indexOf('  renderer.setPixelRatio(',begin);
assert(begin>=0&&end>begin,'official renderer construction boundary');
const construction=source.slice(begin,end).replace('export async function','async function')+'return {renderer,backend};\n}';

async function construct({kind='three-webgl',desynchronized=false,gpuFailure=false}={}){
  const calls=[];
  class WebGLRenderer {constructor(options){calls.push({backend:'webgl',options});}}
  class WebGPURenderer {constructor(options){calls.push({backend:'webgpu',options});}async init(){if(gpuFailure)throw Error('adapter refused');}}
  const canvas={getContext(kind,attributes){calls.push({backend:'precreated',kind,attributes});return {getContextAttributes:()=>attributes};}};
  const context={PRESENTATION_POLICY,prepareDesynchronizedWebGL,navigator:{gpu:{}},
    window:{matchMedia(){throw Error('must not query or replace OS motion preferences');}},
    LOCAL_THREE_URL:'webgl',LOCAL_THREE_WEBGPU_URL:'webgpu',
    loadThree:async name=>name==='webgpu'?{WebGPURenderer}:{WebGLRenderer},
    parseTextureCache(){},parseSpriteResourceBudget(){},normalizeAntialias:x=>x??false,normalizeWebglDesynchronized:x=>x??false,
    parseProjectedRaster:()=>({requested:'native'}),parseFrameProfile:()=>null,normalizePostProcessing:()=>null,
    assertRasterBackend(){},assertFrameOptions(){}};
  vm.createContext(context);vm.runInContext(construction,context);
  const result=await context.createThreeRenderer(canvas,{kind,antialias:true,webglDesynchronized:desynchronized,powerPreference:'low-power'});
  return {calls,result};
}

test('official presentation policy is fixed and independent of system motion preferences',()=>{
  assert.deepEqual(PRESENTATION_POLICY,{ignoreSystemMotionPreferences:true,powerPreference:'high-performance'});
  assert(Object.isFrozen(PRESENTATION_POLICY));
  assert.throws(()=>{PRESENTATION_POLICY.powerPreference='low-power';},TypeError);
  const page=fs.readFileSync(new URL('../player/index.html',import.meta.url),'utf8');
  assert(!page.includes('prefers-reduced-motion'),'startup must not disable authored motion for an OS preference');
  assert.match(page,/animation:unone-startup-wait 1\.2s ease-in-out infinite/);
  assert.match(page,/transition:opacity \.3s ease/);
});

test('actual WebGL and WebGPU constructor paths always request the shared high-performance hint',async()=>{
  for(const kind of ['three-webgl','three-webgpu']){
    const {calls}=await construct({kind});assert.equal(calls.length,1);
    assert.equal(calls[0].options.powerPreference,PRESENTATION_POLICY.powerPreference);
    assert.equal(calls[0].options.antialias,true);assert.equal(calls[0].options.alpha,false);
  }
});

test('automatic WebGPU failure keeps the same high-performance policy on the WebGL fallback',async()=>{
  const {calls,result}=await construct({kind:'three',gpuFailure:true});
  assert.deepEqual(calls.map(call=>call.backend),['webgpu','webgl']);assert.equal(result.backend,'webgl');
  for(const call of calls)assert.equal(call.options.powerPreference,'high-performance');
});

test('desynchronized context creation and the later renderer share one GPU preference',async()=>{
  const {calls}=await construct({desynchronized:true});assert.deepEqual(calls.map(call=>call.backend),['precreated','webgl']);
  assert.equal(calls[0].attributes.powerPreference,calls[1].options.powerPreference);
  assert.equal(calls[0].attributes.powerPreference,'high-performance');
  assert.equal(calls[0].attributes.alpha,true,'Three internal context alpha semantics remain intact');
  assert.equal(calls[0].attributes.antialias,true);assert.equal(calls[0].attributes.desynchronized,true);
});

test('official export inventory contains the policy and has complete static module dependencies',()=>{
  const root=fileURLToPath(new URL('../../',import.meta.url)),snapshot=inspectHostSnapshot(root);
  assert(snapshot.web_files.includes('web/shared/presentation-policy.mjs'));
  const enabled=resolveSystems(root,{effekseer:false});
  const host=assembleHost(root,snapshot,enabled,{javascript:'engine.js',compiled_systems:enabled},{assets:[]});
  assert(host.files.has('web/shared/presentation-policy.mjs'));
  assert(validateDependencies(host.files)>50);
});
