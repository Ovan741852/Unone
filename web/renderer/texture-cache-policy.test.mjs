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
test('omitted policy has an explicit bounded default and expires idle owners',()=>{
  const records=new Map([['a',{state:'ready',texture:{image:{width:2,height:2}}}]]);
  const cache=createTextureCachePolicy(records,undefined);assert.equal(cache.metrics().policy_source,'default');assert.deepEqual(cache.metrics().policy,{max_bytes:67108864,max_entries:128,idle_frames:1800});
  for(let i=1;i<1800;i++){cache.begin();cache.sweep();assert.equal(records.size,1);}
  cache.begin();cache.sweep();assert.equal(records.size,0);assert.equal(cache.metrics().enabled,true);
});
test('texture accounting includes mip estimate, without claiming driver bytes',()=>{
  assert.equal(textureBytes({image:{width:3,height:3},generateMipmaps:true}),48);
  assert.equal(textureBytes(null),0);
});
test('decoded lease is released once even when local GPU disposal throws',()=>{
 let released=0;const failure=Error('GPU dispose'),entry={state:'ready',texture:{dispose(){throw failure;}},imageLease:{release(){released++;}}},records=new Map([['shared',entry]]),cache=createTextureCachePolicy(records,undefined);
 assert.throws(()=>cache.clear(),error=>error===failure);assert.equal(released,1);assert.equal(entry.texture,null);assert.equal(entry.imageLease,null);assert.equal(records.size,0);cache.clear();assert.equal(released,1);
});

function owner(cache,id,bytes,retired,{domain='pool',loading=false}={}){
 const key={id,domain};cache.trackOwner(key,{bytes:()=>bytes,loading:()=>loading,retire:()=>retired.push(id)});return key;
}
test('legacy and pool owners compete under one physical cache budget, with live owners protected',()=>{
 const f=fixture({max_bytes:32,max_entries:2,idle_frames:10}),retired=[];f.cache.begin();f.add('legacy');
 const active=owner(f.cache,'active',16,retired),idle=owner(f.cache,'idle',16,retired);f.cache.pinOwner(idle,false);
 f.cache.sweep();assert.deepEqual(retired,['idle']);assert.equal(f.cache.metrics().entries,2);assert.equal(f.cache.metrics().pinned_bytes_estimate,32);
 f.cache.begin();f.cache.touchOwner(active);const incoming=owner(f.cache,'incoming',16,retired);f.cache.sweep();
 assert.deepEqual(f.released,['legacy']);assert.deepEqual(retired,['idle']);assert.equal(f.cache.metrics().entries,2);f.cache.untrackOwner(incoming);f.cache.untrackOwner(active);
});
test('domain reclamation skips unrelated idle owners and untrack never retires physical ownership',()=>{
 const f=fixture(),retired=[];f.cache.begin();f.add('legacy');f.cache.begin();
 const pooled=owner(f.cache,'pooled',16,retired);f.cache.pinOwner(pooled,false);
 assert.equal(f.cache.reclaim(()=>retired.length===1,{eligible:key=>key?.domain==='pool'}),1);
 assert.deepEqual(retired,['pooled']);assert(f.records.has('legacy'));assert.deepEqual(f.released,[]);
 const borrowed=owner(f.cache,'borrowed',16,retired);assert(f.cache.untrackOwner(borrowed));assert(!f.cache.untrackOwner(borrowed));assert.deepEqual(retired,['pooled']);
});
test('clear attempts all physical owner retirements after removing their controller records',()=>{
 const cache=createTextureCachePolicy(new Map()),calls=[];const a={},b={};
 cache.trackOwner(a,{bytes:()=>16,loading:()=>false,retire(){calls.push(['a',cache.metrics().entries]);throw Error('FIRST_RETIRE_FAILED');}});
 cache.trackOwner(b,{bytes:()=>16,loading:()=>false,retire(){calls.push(['b',cache.metrics().entries]);}});
 assert.throws(()=>cache.clear(),/FIRST_RETIRE_FAILED/);assert.deepEqual(calls,[['a',0],['b',0]]);assert.equal(cache.metrics().entries,0);cache.clear();assert.equal(calls.length,2);
});

test('retirement callbacks removing another idle record do not strand the remaining pressure victims',()=>{
 const cache=createTextureCachePolicy(new Map(),{max_bytes:16,max_entries:1,idle_frames:10}),a={},b={},c={},retired=[];
 cache.trackOwner(a,{bytes:()=>16,loading:()=>false,retire(){retired.push('a');cache.untrackOwner(b);}});cache.pinOwner(a,false);
 cache.trackOwner(b,{bytes:()=>16,loading:()=>false,retire(){retired.push('b');}});cache.pinOwner(b,false);
 cache.trackOwner(c,{bytes:()=>16,loading:()=>false,retire(){retired.push('c');}});cache.pinOwner(c,false);
 cache.reclaim(()=>cache.metrics().entries===0);assert.deepEqual(retired,['a','c']);assert.equal(cache.metrics().entries,0);
});

test('a large expiry sweep reads owner byte estimates a linear number of times',()=>{
 const cache=createTextureCachePolicy(new Map(),{max_bytes:65536,max_entries:4096,idle_frames:1});let reads=0,retired=0;const count=1024;
 for(let i=0;i<count;i++){const key={};cache.trackOwner(key,{bytes(){reads++;return 16;},loading:()=>false,retire(){retired++;}});cache.pinOwner(key,false);}
 cache.begin();cache.sweep();assert.equal(retired,count);assert(reads<=count*2,`One aggregate pass plus one estimate per victim, received ${reads}`);assert.equal(cache.metrics().entries,0);
});

test('pressure recounts reentrant registration and removal instead of trusting stale aggregate estimates',()=>{
 for(const register of [false,true]){
  const cache=createTextureCachePolicy(new Map(),{max_bytes:16,max_entries:1,idle_frames:10}),a={},b={},c={},extra={},retired=[];
  cache.trackOwner(a,{bytes:()=>16,loading:()=>false,retire(){retired.push('a');if(register)cache.trackOwner(extra,{bytes:()=>16,loading:()=>false,retire(){retired.push('extra');}});else cache.untrackOwner(b);}});cache.pinOwner(a,false);
  cache.trackOwner(b,{bytes:()=>16,loading:()=>false,retire(){retired.push('b');}});cache.pinOwner(b,false);
  cache.trackOwner(c,{bytes:()=>16,loading:()=>false,retire(){retired.push('c');}});cache.pinOwner(c,false);
  cache.sweep();assert.deepEqual(retired,register?['a','b','c']:['a']);assert.equal(cache.metrics().entries,1);assert.equal(cache.metrics().pressure_bytes,0);
 }
});

test('a callback admitting a new idle owner at the end of a sweep is still checked against the budget',()=>{
 const cache=createTextureCachePolicy(new Map(),{max_bytes:16,max_entries:1,idle_frames:1}),a={},late={},retired=[];
 cache.trackOwner(a,{bytes:()=>16,loading:()=>false,retire(){retired.push('a');cache.trackOwner(late,{bytes:()=>32,loading:()=>false,retire(){retired.push('late');}});cache.pinOwner(late,false);}});cache.pinOwner(a,false);
 cache.begin();cache.sweep();assert.deepEqual(retired,['a','late']);assert.equal(cache.metrics().entries,0);assert.equal(cache.metrics().pressure_bytes,0);
});
