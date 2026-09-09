import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.core.js';
import {createBloom,bloomMeasurementMode} from './bloom.js';

function fixture({timerAvailable=true}={}){
  let ready=false,id=0,disjoint=false;const draws=[],deleted=[];
  const timer={TIME_ELAPSED_EXT:1,GPU_DISJOINT_EXT:2};
  const gl={QUERY_RESULT_AVAILABLE:3,QUERY_RESULT:4,getExtension:n=>n==='EXT_disjoint_timer_query_webgl2'&&timerAvailable?timer:null,getParameter:()=>disjoint,
    createQuery:()=>({id:++id}),beginQuery(){},endQuery(){},deleteQuery:q=>deleted.push(q.id),
    getQueryParameter:(q,p)=>p===3?ready:q.id*1e6};
  const renderer={getContext:()=>gl,getDrawingBufferSize:v=>v.set(1,1),setRenderTarget(){},render:s=>draws.push(s.children?.[0]?.material)};
  return {bloom:createBloom(THREE,renderer),draws,deleted,ready:()=>ready=true,disjoint:value=>disjoint=value,queries:()=>id};
}
function assertNoGpuSamples(metrics){
  for(const key of ['gpu_on','gpu_off','gpu_ao_only','gpu_bloom_with_ao'])assert.equal(metrics[key],null,key);
  assert.ok(Object.values(metrics.gpu_samples_by_mode).every(v=>v===null));
}
test('missing GPU timer still draws all modes and exposes null rather than zero timings',()=>{
  const f=fixture({timerAvailable:false});
  for(const [on,ao,passes]of [[false,false,1],[true,false,5],[false,true,2],[true,true,5]]){
    f.bloom.setEnabled(on);f.bloom.setAO(ao);const before=f.draws.length;
    f.bloom.draw({},new THREE.PerspectiveCamera());assert.equal(f.draws.length-before,passes);
    assert.equal(f.bloom.metrics().gpu_timer_available,false);assertNoGpuSamples(f.bloom.metrics());
  }
  assert.equal(f.queries(),0);
});
test('disjoint drops pending invalid samples without inventing GPU time',()=>{
  const f=fixture();f.bloom.draw({},new THREE.PerspectiveCamera());f.ready();f.disjoint(true);
  f.bloom.draw({},new THREE.PerspectiveCamera());assert.deepEqual(f.deleted,[1]);assertNoGpuSamples(f.bloom.metrics());
  f.bloom.draw({},new THREE.PerspectiveCamera());assert.deepEqual(f.deleted,[1,2]);assertNoGpuSamples(f.bloom.metrics());
  assert.equal(f.draws.length,15);
});
test('AO-only skips Bloom extraction and both blur passes, including first frame',()=>{
  const f=fixture();f.bloom.setEnabled(false);f.bloom.setAO(true);f.bloom.draw({},new THREE.PerspectiveCamera());
  assert.equal(f.draws.length,2);
  assert.equal(f.draws[1].uniforms.strength.value,0);
  assert.equal(f.draws[1].uniforms.aoStrength.value,1.7);
  assert.deepEqual(f.draws[1].uniforms.pixels.value.toArray(),[1,1]);
  assert.ok(!f.draws.some(m=>m?.uniforms.direction));
});
test('all four asynchronous GPU buckets retain their original mode and aliases',()=>{
  const f=fixture(),camera=new THREE.PerspectiveCamera();
  const modes=[[false,false,'gpu_off',1],[true,false,'gpu_on',5],[false,true,'gpu_ao_only',2],[true,true,'gpu_bloom_with_ao',5]];
  for(const [on,ao,,passes]of modes){f.bloom.setEnabled(on);f.bloom.setAO(ao);const start=f.draws.length;f.bloom.draw({},camera);assert.equal(f.draws.length-start,passes);}
  f.ready();f.bloom.setEnabled(false);f.bloom.setAO(false);f.bloom.draw({},camera);
  const metrics=f.bloom.metrics();
  modes.forEach(([on,ao,key],i)=>{assert.equal(metrics[key].median_ms,i+1);assert.equal(metrics[key],metrics.gpu_samples_by_mode[bloomMeasurementMode(on,ao)]);});
  f.bloom.resetMeasurements();assert.ok(Object.values(f.bloom.metrics().gpu_samples_by_mode).every(v=>v===null));assert.equal(f.deleted.length,5);
});
test('overlay state changes apply next frame without relabelling the in-flight GPU sample',()=>{
  const f=fixture(),camera=new THREE.PerspectiveCamera();f.bloom.setEnabled(false);
  f.bloom.draw({},camera,()=>{f.bloom.setAO(true);f.bloom.setEnabled(true);});
  f.ready();f.bloom.draw({},camera);assert.equal(f.bloom.metrics().gpu_off.median_ms,1);
});
