import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeCore} from './runtime-core.mjs';
test('host-time inspection is detached and cannot replace the latest world or tick it',async()=>{
 let len=0,ticks=0;const m={HEAPU8:new Uint8Array(8192),_unone_web_alloc:()=>0,_unone_web_observation_ptr:()=>4096,_unone_web_observation_len:()=>len};
 const publish=v=>{const b=new TextEncoder().encode(JSON.stringify(v));m.HEAPU8.set(b,4096);len=b.length;return 0;};
 const snapshot={world:{frame:7,instances3d:{}}};m._unone_web_load_project=()=>publish(snapshot);m._unone_web_set_instance_transport=()=>publish(snapshot);m._unone_web_set_viewport_aspect=()=>0;m._unone_web_tick=()=>{ticks++;return 0;};
 m._unone_web_host_time_request=()=>publish({mode:'replay',committed_samples:5,physical_source_calls:0});
 const core=createRuntimeCore(m);await core.execute({kind:'load',payload:{config:{}}});
 assert.equal((await core.execute({kind:'hostTime',request:{kind:'report'}})).committed_samples,5);
 assert.deepEqual(await core.execute({kind:'aspect',value:1}),snapshot);assert.equal(ticks,0);
 delete m._unone_web_host_time_request;await assert.rejects(core.execute({kind:'hostTime',request:{kind:'report'}}),/HOST_TIME_ABI_UNAVAILABLE/);
});
test('physical viewport updates publish dimensions without a simulation tick and fail on stale ABI',async()=>{
 let length=0,ticks=0;const module={HEAPU8:new Uint8Array(8192),_unone_web_alloc:()=>0,_unone_web_observation_ptr:()=>4096,_unone_web_observation_len:()=>length};
 const publish=v=>{const bytes=new TextEncoder().encode(JSON.stringify(v));module.HEAPU8.set(bytes,4096);length=bytes.length;return 0;};
 const snapshot={world:{frame:0,instances3d:{}}};module._unone_web_load_project=()=>publish(snapshot);module._unone_web_set_instance_transport=()=>publish(snapshot);
 module._unone_web_tick=()=>{ticks++;return 0;};module._unone_web_set_viewport_size=(width,height)=>publish({world:{...snapshot.world,projected_viewport:{width,height}}});
 const core=createRuntimeCore(module);await core.execute({kind:'load',payload:{config:{}}});
 assert.deepEqual((await core.execute({kind:'viewport',width:360,height:900})).world.projected_viewport,{width:360,height:900});assert.equal(ticks,0);
 await assert.rejects(core.execute({kind:'viewport',width:0,height:900}),/PROJECTED_VIEWPORT_INVALID/);
 delete module._unone_web_set_viewport_size;await assert.rejects(core.execute({kind:'viewport',width:1,height:1}),/PROJECTED_VIEWPORT_ABI_UNAVAILABLE/);
});
test('forced GPU load failure leaves the core unloaded instead of running CPU ticks',async()=>{
 let len=0,ticks=0;const module={HEAPU8:new Uint8Array(8192),_unone_web_alloc:()=>0,_unone_web_observation_ptr:()=>4096,_unone_web_observation_len:()=>len};
 module._unone_web_load_project=()=>{const b=new TextEncoder().encode(JSON.stringify({world:{frame:0,instances3d:{}}}));module.HEAPU8.set(b,4096);len=b.length;return 0;};
 module._unone_web_spatial_request=()=>0;module._unone_web_tick=()=>{ticks++;return 0;};
 const core=createRuntimeCore(module,{spatialBackend:'gpu',createSpatialExecutor:async()=>{throw Error('GPU unavailable');}});
 await assert.rejects(core.execute({kind:'load',payload:{config:{}}}),/GPU unavailable/);
 await assert.rejects(core.execute({kind:'tick',input:{}}),/RUNTIME_NOT_LOADED/);
 assert.equal(ticks,0);core.close();
});
test('UI-only request publishes a new window without a simulation tick',async()=>{
 let len=0,ticks=0;const m={HEAPU8:new Uint8Array(8192),_unone_web_alloc:()=>0,_unone_web_observation_ptr:()=>4096,_unone_web_observation_len:()=>len};
 const publish=v=>{const b=new TextEncoder().encode(JSON.stringify(v));m.HEAPU8.set(b,4096);len=b.length;return 0;};
 const snapshot={world:{frame:17,ui:{window:1},instances3d:{}}};m._unone_web_load_project=()=>publish(snapshot);m._unone_web_set_instance_transport=()=>publish(snapshot);m._unone_web_tick=()=>{ticks++;return 0;};m._unone_web_ui_request=()=>publish({...snapshot,world:{...snapshot.world,ui:{window:500}}});
 const core=createRuntimeCore(m);await core.execute({kind:'load',payload:{config:{}}});const result=await core.execute({kind:'ui',request:{id:'list',revision:1,first:500,last:520}});
 assert.equal(result.world.frame,17);assert.equal(result.world.ui.window,500);assert.equal(ticks,0);
 delete m._unone_web_ui_request;await assert.rejects(core.execute({kind:'ui',request:{}}),/UI_SCROLL_ABI_UNAVAILABLE/);
});
test('aspect never republishes stale instance pointers after a developer mutation',async()=>{
 let len=0;const module={HEAPU8:new Uint8Array(8192),_unone_web_alloc:()=>0,_unone_web_observation_ptr:()=>4096,_unone_web_observation_len:()=>len};
 const publish=v=>{const b=new TextEncoder().encode(JSON.stringify(v));module.HEAPU8.set(b,4096);len=b.length;return 0;};
 const first={world:{frame:0,instances3d:{}}},changed={world:{frame:0,instances3d:{new_batch:{memory:{offset:256,byte_length:40,revision:'1'}}}}};
 let world=first;
 module._unone_web_load_project=()=>publish(first);module._unone_web_set_instance_transport=()=>publish(world);module._unone_web_set_viewport_aspect=()=>0;
 module._unone_web_developer_request=()=>{world=changed;return publish({ok:true,value:{observation:changed}});};
 const core=createRuntimeCore(module);await core.execute({kind:'load',payload:{config:{}},seed:'42'});
 await core.execute({kind:'developer',request:{method:'invoke'}});
 assert.deepEqual(await core.execute({kind:'aspect',value:1.5}),changed);
 await assert.rejects(core.execute({kind:'tick',typo:1}),/RUNTIME_COMMAND_INVALID/);
});
test('developer inspection restores packed instances without ticking or changing transport',async()=>{
 let len=0,mode=1,ticks=0;
 const module={HEAPU8:new Uint8Array(8192),_unone_web_alloc:()=>0,_unone_web_observation_ptr:()=>4096,_unone_web_observation_len:()=>len};
 const publish=value=>{const bytes=new TextEncoder().encode(JSON.stringify(value));module.HEAPU8.set(bytes,4096);len=bytes.length;return 0;};
 const render=()=>({world:{frame:17,instances3d:{crowd:{count:1,...(mode?{memory:{offset:256,byte_length:40,revision:'1'}}:{data:Buffer.alloc(40).toString('base64')})}}}});
 module._unone_web_load_project=()=>publish(render());module._unone_web_tick=()=>{ticks++;return 0;};
 module._unone_web_set_instance_transport=value=>{mode=value;return publish(render());};
 module._unone_web_developer_request=()=>publish({ok:true,value:{logs:['kept'],observation:{world:{frame:17,instances3d:{crowd:{count:1}}}}}});
 const core=createRuntimeCore(module);await core.execute({kind:'load',payload:{config:{}}});
 for(const transport of ['memory','json']){
  await core.execute({kind:'transport',mode:transport});
  const result=await core.execute({kind:'developer',request:{method:'snapshot'}});
  assert.deepEqual(result.observation,render());assert.deepEqual(result.logs,['kept']);assert.equal(result.observation.world.frame,17);
  assert.equal(mode,transport==='memory'?1:0);
 }
 assert.equal(ticks,0);
});
