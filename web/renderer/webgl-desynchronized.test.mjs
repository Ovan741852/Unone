import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDesynchronizedWebGL,webglDesynchronizedMetrics} from './webgl-desynchronized.js';
import {createPlayerRenderer,normalizeWebglDesynchronized} from '../shared/renderer-selection.mjs';

test('omitted and false retain standard Three context creation',()=>{
  const canvas={getContext(){throw Error('must not request any context')}};
  for(const requested of [false,undefined]){
    assert.deepEqual(prepareDesynchronizedWebGL(canvas,false,requested),{requested:false,attempted:false,precreated:false});
  }
  assert.equal(normalizeWebglDesynchronized(),false);
  assert.throws(()=>normalizeWebglDesynchronized(null),/WEBGL_DESYNCHRONIZED_INVALID/);
});

test('opt-in preserves Three context attributes and Three reacquires the identical context',()=>{
  const calls=[],context={getContextAttributes:()=>({alpha:true,depth:true,desynchronized:true})};
  let existing;
  const canvas={getContext(kind,attributes){calls.push({kind,attributes});return existing??=(context)}};
  const prepared=prepareDesynchronizedWebGL(canvas,false,true);
  assert.deepEqual(prepared,{requested:true,attempted:true,precreated:true});
  const threeAttributes={alpha:true,depth:true,stencil:false,antialias:false,premultipliedAlpha:true,
    preserveDrawingBuffer:false,powerPreference:'high-performance',failIfMajorPerformanceCaveat:false};
  assert.deepEqual(calls[0],{kind:'webgl2',attributes:{...threeAttributes,desynchronized:true}});
  assert.equal(canvas.getContext('webgl2',threeAttributes),context);
  assert.deepEqual(webglDesynchronizedMetrics({getContext:()=>context},prepared,'webgl'),
    {...prepared,backend:'webgl',actual:true});
});

test('a refused hint falls back to standard context creation; ignored hints report false',()=>{
  for(const failure of [()=>null,()=>{throw Error('unsupported')}]){
    let count=0;const ordinary={getContextAttributes:()=>({desynchronized:false})};
    const canvas={getContext(){return count++===0?failure():ordinary}};
    const result=prepareDesynchronizedWebGL(canvas,true,true);
    assert.deepEqual(result,{requested:true,attempted:true,precreated:false});
    assert.equal(canvas.getContext('webgl2'),ordinary);
    assert.equal(webglDesynchronizedMetrics({getContext:()=>ordinary},result,'webgl').actual,false);
  }
  const ignored={getContextAttributes:()=>({desynchronized:false})},prepared=prepareDesynchronizedWebGL({getContext:()=>ignored},false,true);
  assert.equal(webglDesynchronizedMetrics({getContext:()=>ignored},prepared,'webgl').actual,false);
  assert.equal(webglDesynchronizedMetrics({},prepared,'webgpu').actual,null);
});

test('selection forwards a validated opt-in only to the official renderer',async()=>{
  let seen;const createOfficial=async(_canvas,options)=>{seen=options;return {}};
  const host={createOfficial,contentRoot:new URL('https://test.invalid/content/')};
  await createPlayerRenderer({}, {}, {webgl_desynchronized:true},host);
  assert.equal(seen.webglDesynchronized,true);
  await createPlayerRenderer({}, {}, {},host);
  assert.equal('webglDesynchronized' in seen,false);
  await assert.rejects(createPlayerRenderer({}, {}, {webgl_desynchronized:null},host),/WEBGL_DESYNCHRONIZED_INVALID/);
  await assert.rejects(createPlayerRenderer({}, {}, {renderer_mode:'custom',webgl_desynchronized:true},host),/WEBGL_DESYNCHRONIZED_OFFICIAL_ONLY/);
});
