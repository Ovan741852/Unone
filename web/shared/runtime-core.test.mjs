import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeCore} from './runtime-core.mjs';
test('aspect never republishes stale instance pointers after a developer mutation',async()=>{
 let len=0;const module={HEAPU8:new Uint8Array(8192),_unone_web_alloc:()=>0,_unone_web_observation_ptr:()=>4096,_unone_web_observation_len:()=>len};
 const publish=v=>{const b=new TextEncoder().encode(JSON.stringify(v));module.HEAPU8.set(b,4096);len=b.length;return 0;};
 const first={world:{frame:0,instances3d:{}}},changed={world:{frame:0,instances3d:{new_batch:{memory:{offset:256,byte_length:40,revision:'1'}}}}};
 module._unone_web_load_project=()=>publish(first);module._unone_web_set_instance_transport=()=>publish(first);module._unone_web_set_viewport_aspect=()=>0;
 module._unone_web_developer_request=()=>publish({ok:true,value:{observation:changed}});
 const core=createRuntimeCore(module);await core.execute({kind:'load',payload:{config:{}},seed:'42'});
 await core.execute({kind:'developer',request:{method:'invoke'}});
 assert.deepEqual(await core.execute({kind:'aspect',value:1.5}),changed);
 await assert.rejects(core.execute({kind:'tick',typo:1}),/RUNTIME_COMMAND_INVALID/);
});
