import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTextureCache,createTextureCachePolicy,textureBytes} from './texture-cache-policy.js';
const limits={max_bytes:32,max_entries:2,idle_frames:3};
function fixture(policy=limits){
  const records=new Map(),released=[];
  const cache=createTextureCachePolicy(records,policy,{dispose:t=>{if(t)released.push(t.id)}});
  function add(id,bytes=16,persistent=false){const entry={state:'ready',texture:{id,image:{width:bytes/4,height:1},generateMipmaps:false}};
    records.set(id,entry);cache.touch(id,entry,{persistent});return entry;}
  return {cache,records,released,add};
}
test('strict finite optional policy',()=>{
  assert.equal(parseTextureCache(undefined),null);assert.deepEqual(parseTextureCache(limits),limits);
  for(const value of [null,[],{}, {...limits,max_bytes:0},{...limits,max_entries:1.5},
    {...limits,idle_frames:Infinity},{...limits,game:'wuxia'}])assert.throws(()=>parseTextureCache(value),/TEXTURE_CACHE_INVALID/);
});
test('idle resources evict by LRU under entry/byte pressure',()=>{
  const f=fixture();f.cache.begin();f.add('a');f.add('b');f.cache.begin();f.add('c');f.cache.sweep();
  assert.deepEqual([...f.records.keys()],['b','c']);assert.deepEqual(f.released,['a']);
  assert.equal(f.cache.metrics().decoded_texture_bytes_estimate,32);
});
test('active textures can exceed budget without being disposed',()=>{
  const f=fixture();f.cache.begin();f.add('a');f.add('b');f.add('c');f.cache.sweep();
  assert.equal(f.records.size,3);assert.equal(f.released.length,0);
  assert.equal(f.cache.metrics().pressure_bytes,16);assert.equal(f.cache.metrics().pressure_entries,1);
});
test('persistent mesh/terrain dependencies remain protected',()=>{
  const f=fixture();f.cache.begin();f.add('mesh',64,true);f.cache.begin();f.add('sprite');f.cache.sweep();
  assert(f.records.has('mesh'));assert(f.records.has('sprite'));assert.equal(f.released.length,0);
});
test('idle hysteresis avoids rapid reload churn',()=>{
  const f=fixture();f.cache.begin();f.add('a');
  for(let i=0;i<2;i++){f.cache.begin();f.cache.sweep();assert(f.records.has('a'));}
  f.cache.begin();f.cache.sweep();assert(!f.records.has('a'));assert.deepEqual(f.released,['a']);
});
test('pending load eviction marks stale generation for the renderer guard',()=>{
  const f=fixture();f.cache.begin();const pending={state:'loading',texture:null};f.records.set('pending',pending);f.cache.touch('pending',pending);
  for(let i=0;i<3;i++){f.cache.begin();f.cache.sweep();}
  assert(pending.discarded);assert(!f.records.has('pending'));assert.equal(f.released.length,0);
});
test('clear is idempotent and invalidates pending references',()=>{
  const f=fixture();f.cache.begin();const a=f.add('a');f.cache.clear();f.cache.clear();
  assert(a.discarded);assert.equal(a.texture,null);assert.deepEqual(f.released,['a']);
});
test('omitted policy preserves previous keep-warm behavior',()=>{
  const f=fixture(undefined); // Passing undefined uses JS default; construct explicitly below.
  const records=new Map([['a',{state:'ready',texture:{image:{width:2,height:2}}}]]);
  const cache=createTextureCachePolicy(records,undefined);cache.begin();cache.sweep();assert.equal(records.size,1);
  assert.equal(cache.metrics().enabled,false);assert(f.cache);
});
test('texture accounting includes mip estimate, without claiming driver bytes',()=>{
  assert.equal(textureBytes({image:{width:3,height:3},generateMipmaps:true}),48);
  assert.equal(textureBytes(null),0);
});
