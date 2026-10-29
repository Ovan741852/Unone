import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayerRenderer} from '../shared/renderer-selection.mjs';
const root=new URL('file:///test/content/');
const policy={max_bytes:64,max_entries:2,idle_frames:3};
test('presentation routes reusable cache policy to official renderer',async()=>{
  const result=await createPlayerRenderer({}, {},{texture_cache:policy},
    {contentRoot:root,createOfficial:async(_canvas,options)=>options});
  assert.deepEqual(result.textureCache,policy);
});
test('invalid cache fails before GPU constructor',async()=>{
  let constructed=0;
  await assert.rejects(()=>createPlayerRenderer({}, {},{texture_cache:{...policy,max_bytes:0}},
    {contentRoot:root,createOfficial:async()=>{constructed++;}}),/TEXTURE_CACHE_INVALID/);
  assert.equal(constructed,0);
});
test('custom renderer cannot silently ignore official cache policy',async()=>{
  let loaded=0;
  await assert.rejects(()=>createPlayerRenderer({}, {},{renderer_mode:'custom',renderer_module:'custom.mjs',renderer_files:['custom.mjs'],texture_cache:policy},
    {contentRoot:root,loadModule:async()=>{loaded++;}}),/TEXTURE_CACHE_OFFICIAL_ONLY/);
  assert.equal(loaded,0);
});
