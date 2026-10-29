import test from 'node:test';
import assert from 'node:assert/strict';
import {createRasterCapability} from './projected-raster-capability.js';
import {parseProjectedRaster,assertRasterBackend,assertRasterProfile,assertRasterSnapshot} from './projected-raster-policy.js';
const profile={version:'upper-left-v1',hash:'ab'.repeat(32)},view={width:1280,height:720,dpr:1};
function fixture(validate=()=>({samples:49,passed:49})){
 const states=[],calls=[];const cap=createRasterCapability({policy:parseProjectedRaster('upper_left_checked'),profile,
  onState:s=>states.push(s),validate:context=>{calls.push(structuredClone(context));return validate(context);}});
 return {cap,states,calls};
}
test('checking precedes actual validation; current generation caches only its exact epoch/size/DPR',()=>{
 const f=fixture();assert.equal(f.cap.metrics().status,'unchecked');f.cap.ensure(view);
 assert.deepEqual(f.states.map(s=>s.status),['checking','validated']);assert.equal(f.calls.length,1);
 assert.equal(f.cap.metrics().profile_version,profile.version);assert.equal(f.cap.metrics().probe_hash,profile.hash);
 f.cap.ensure(view);assert.equal(f.calls.length,1);f.cap.ensure({...view,dpr:2});assert.equal(f.calls.length,2);
 f.cap.ensure({...view,width:800,height:600,dpr:2});assert.equal(f.calls.length,3);
 f.cap.ensure(view);assert.equal(f.calls.length,4);assert.equal(f.cap.metrics().target_generation,4);
 f.states[0].physical_size[0]=999;assert.deepEqual(f.cap.metrics().physical_size,[1280,720]);
});
test('capability failure is terminal and explicit, never uses fallback or silently retries',()=>{
 const f=fixture(()=>({samples:49,passed:45,failures:[{point:[2,2],expected:[255,0,0],actual:[17,24,39]}]}));
 assert.throws(()=>f.cap.ensure(view),/PROJECTED_RASTER_CAPABILITY_FAILED/);assert.equal(f.cap.metrics().status,'failed');
 assert.throws(()=>f.cap.ensure(view),/PROJECTED_RASTER_CAPABILITY_FAILED/);assert.equal(f.calls.length,1);
 assert.equal(f.cap.metrics().last_validation,null);assert.equal(f.cap.metrics().failure.failures.length,1);
});
test('loss revokes old validation; restore requires new actual readback before any current validated state',()=>{
 const f=fixture();f.cap.ensure(view);const old=f.cap.metrics().last_validation;f.cap.lost();
 assert.equal(f.cap.metrics().status,'lost');assert.equal(f.cap.ensure(view),false);assert.equal(f.calls.length,1);
 f.cap.restored();assert.equal(f.cap.metrics().status,'unchecked');assert.equal(f.cap.metrics().context_epoch,2);
 assert.deepEqual(f.cap.metrics().last_validation,old);assert.equal(f.cap.metrics().target_generation,null);
 f.cap.ensure(view);assert.equal(f.calls.length,2);assert.equal(f.cap.metrics().last_validation.context_epoch,2);
 f.cap.dispose();f.cap.dispose();assert.throws(()=>f.cap.ensure(view),/DISPOSED/);
});
test('invalid dimensions and thrown readback faults fail closed; no fake validated or READY state',()=>{
 const a=fixture();assert.throws(()=>a.cap.ensure({width:1,height:2,dpr:1}),/PROJECTED_RASTER_CAPABILITY_FAILED/);
 assert.equal(a.calls.length,0);assert.equal(a.cap.metrics().status,'failed');
 const b=fixture(()=>{throw Error('readback denied');});assert.throws(()=>b.cap.ensure(view),/readback denied/);
 assert.equal(b.cap.metrics().status,'failed');assert.ok(!b.states.some(s=>s.status==='validated'));
});
test('strict policy rejects unsupported backend/profile and every nonhidden snapshot including empty',()=>{
 const checked=parseProjectedRaster('upper_left_checked');assert.equal(parseProjectedRaster(undefined).declared,false);
 for(const v of [null,true,'upper_left',{},0])assert.throws(()=>parseProjectedRaster(v),/INVALID/);
 for(const backend of ['webgpu','native'])assert.throws(()=>assertRasterBackend(checked,backend),/OFFICIAL_WEBGL_ONLY/);
 assert.doesNotThrow(()=>assertRasterBackend(parseProjectedRaster(undefined),'webgpu'));
 const valid={antialias:false,effectiveAA:false,bloom:false,ao:false};assert.doesNotThrow(()=>assertRasterProfile(checked,valid));
 for(const change of [{antialias:true},{effectiveAA:null},{bloom:true},{ao:true},{postprocessing:{}},{outputSupported:false}])
  assert.throws(()=>assertRasterProfile(checked,{...valid,...change}),/PROFILE_UNSUPPORTED/);
 for(const snapshot of [{},{projected_geometry:{}},{projected_world_visible:true,projected_geometry:{}}])
  assert.throws(()=>assertRasterSnapshot(checked,snapshot),/WORLD_DEPTH_UNSUPPORTED/);
 assert.doesNotThrow(()=>assertRasterSnapshot(checked,{projected_world_visible:false,projected_geometry:{}}));
});
