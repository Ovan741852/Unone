import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeCore} from './runtime-core.mjs';

function fixture(physical=false){
 let length=0,ticks=0;const calls=[],module={HEAPU8:new Uint8Array(16384),_unone_web_alloc:()=>0,_unone_web_observation_ptr:()=>8192,_unone_web_observation_len:()=>length};
 const snapshot={world:{frame:12,instances3d:{}}};
 const publish=value=>{const b=new TextEncoder().encode(JSON.stringify(value));module.HEAPU8.set(b,8192);length=b.length;return 0;};
 module._unone_web_load_project=(p,n)=>{calls.push({kind:'load',payload:JSON.parse(new TextDecoder().decode(module.HEAPU8.slice(p,p+n)))});return publish(snapshot);};
 module._unone_web_set_instance_transport=()=>publish(snapshot);
 module._unone_web_set_viewport_aspect=value=>{calls.push({kind:'aspect',value});return 0;};
 module._unone_web_tick=()=>{ticks++;return publish(snapshot);};
 if(physical)module._unone_web_set_viewport_size=(width,height)=>{calls.push({kind:'physical',width,height});return publish(snapshot);};
 return {module,calls,snapshot,ticks:()=>ticks};
}

test('explicit aspect-only load adapts a copy and preserves original payload metadata',async()=>{
 const f=fixture(),core=createRuntimeCore(f.module,{requirePhysicalViewport:false});
 const payload=Object.freeze({config:Object.freeze({}),viewport_size:Object.freeze([800,600]),viewport_aspect:9,restored_save:{coins:17}});
 await core.execute({kind:'load',payload,seed:'42'});
 assert.deepEqual(f.calls[0].payload,{config:{},viewport_aspect:4/3,restored_save:{coins:17}});
 assert.deepEqual(payload.viewport_size,[800,600]);assert.equal(payload.viewport_aspect,9);
 assert.deepEqual(core.report().viewport,{mode:'aspect-only',required:false,physical_api:false,aspect_api:true});
 assert.deepEqual(await core.execute({kind:'viewport',width:360,height:900}),f.snapshot);
 assert.deepEqual(f.calls[1],{kind:'aspect',value:.4});assert.equal(f.ticks(),0);
 await core.execute({kind:'load',payload:{config:{},viewport_size:[900,600]}});
 assert.equal(f.calls.at(-1).payload.viewport_aspect,1.5);core.close();
});

test('default strict contract rejects unavailable physical load and resize instead of silently downgrading',async()=>{
 for(const options of [{},{requirePhysicalViewport:true}]){
  const f=fixture(),core=createRuntimeCore(f.module,options);
  await assert.rejects(core.execute({kind:'load',payload:{config:{},viewport_size:[800,600]}}),/PROJECTED_VIEWPORT_ABI_UNAVAILABLE/);
  assert.equal(f.calls.length,0);await assert.rejects(core.execute({kind:'tick',input:{}}),/RUNTIME_NOT_LOADED/);
  await core.execute({kind:'load',payload:{config:{}}});
  await assert.rejects(core.execute({kind:'viewport',width:800,height:600}),/PROJECTED_VIEWPORT_ABI_UNAVAILABLE/);
  assert.equal(core.report().viewport.mode,'physical-unavailable');assert.equal(f.ticks(),0);core.close();
 }
});

test('a physical-capable runtime preserves the full original payload and physical resize in either policy',async()=>{
 for(const requirePhysicalViewport of [true,false]){
  const f=fixture(true),core=createRuntimeCore(f.module,{requirePhysicalViewport}),payload={config:{},viewport_size:[800,600],viewport_aspect:2};
  await core.execute({kind:'load',payload});assert.deepEqual(f.calls[0].payload,payload);
  await core.execute({kind:'viewport',width:360,height:900});assert.deepEqual(f.calls[1],{kind:'physical',width:360,height:900});
  assert.equal(core.report().viewport.mode,'physical');assert.equal(f.ticks(),0);core.close();
 }
});

test('aspect-only compatibility validates dimensions and does not mask a missing aspect ABI',async()=>{
 for(const size of [[0,100],[100.5,200],[100,40000],[100],[100,200,300],{},'wide']){
  const f=fixture(),core=createRuntimeCore(f.module,{requirePhysicalViewport:false});
  await assert.rejects(core.execute({kind:'load',payload:{config:{},viewport_size:size}}),/PROJECTED_VIEWPORT_INVALID/);
  assert.equal(f.calls.length,0);core.close();
 }
 const f=fixture(),core=createRuntimeCore(f.module,{requirePhysicalViewport:false});
 await core.execute({kind:'load',payload:{config:{}}});delete f.module._unone_web_set_viewport_aspect;
 await assert.rejects(core.execute({kind:'viewport',width:100,height:100}),/VIEWPORT_ASPECT_ABI_UNAVAILABLE/);core.close();
 assert.throws(()=>createRuntimeCore(f.module,{requirePhysicalViewport:'yes'}),/VIEWPORT_POLICY_INVALID/);
});
