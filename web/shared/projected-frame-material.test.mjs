import {test} from 'node:test';import assert from 'node:assert/strict';
import {frameFragment,frameCompare,frameMaterial,FRAME_COMPARES} from './projected-frame-material.mjs';
const base={rgb:'texture_times_vertex',texture_alpha:'sampled',alpha:'texture',alpha_test:{enabled:false,compare:'greater',reference:.5},
 blend:{enabled:true,operation:'add',source:'source_alpha',destination:'one_minus_source_alpha'},depth:{test:true,write:false,compare:'less_equal'},
 sampler:{min:'nearest',mag:'linear',address_u:'repeat',address_v:'clamp'}};
const m=patch=>({...structuredClone(base),...patch});
test('sample,vertex,product and absent-format alpha remain independent from RGB',()=>{
 for(const [alpha,expected] of [['texture',.25],['vertex',.5],['texture_times_vertex',.125]]){
  const out=frameFragment([.5,.25,1,.25],[1,1,1,.5],[0,0,0],m({alpha}));assert.equal(out.alpha,expected);
 }
 const out=frameFragment([1,.5,.25,0],[1,1,1,.5],[.25,.5,.75],m({texture_alpha:'one'}));
 assert.equal(out.alpha,1);assert.deepEqual(out.rgb,[1,.5,.25]);assert.equal(out.discarded,false);
});
test('exact binary equality strictness and disabled alpha-test are not inferred from cutoff',()=>{
 for(const [compare,discarded] of [['greater',true],['greater_equal',false]]){
  const out=frameFragment([1,0,0,1],[1,1,1,.5],[.25,.5,.75],m({alpha:'texture_times_vertex',alpha_test:{enabled:true,compare,reference:.5}}));
  assert.equal(out.discarded,discarded,compare);
 }
 const out=frameFragment([1,0,0,0],[1,1,1,.5],[1,1,1],m());assert.equal(out.discarded,false);
});
test('nonblack destination, ADD clamp, overlap order, and stable rebuild are numeric reference',()=>{
 const a=frameFragment([1,.5,0,.5],[1,1,1,1],[.25,.5,.75],m());assert.deepEqual(a.rgb,[.625,.5,.375]);
 const add=m({blend:{enabled:true,operation:'add',source:'source_alpha',destination:'one'}});
 const b=frameFragment([1,.5,0,.5],[1,1,1,1],[.75,.5,.25],add);assert.deepEqual(b.rgb,[1,.75,.25]);
 const off=frameFragment([1,.5,0,0],[.5,1,1,1],[.25,.5,.75],m({blend:{...base.blend,enabled:false}}));assert.deepEqual(off.rgb,[.5,.5,0]);
 const dark=frameFragment([0,0,0,.5],[1,1,1,1],b.rgb,m());assert.deepEqual(dark.rgb,[.5,.375,.125]);
 for(let i=0;i<100;i++)assert.deepEqual(frameFragment([1,.5,0,.5],[1,1,1,1],[.25,.5,.75],m()),a);
});
test('all compare and material closed-schema guards',()=>{
 const expected=[false,false,true,true,false,false,true,true];
 FRAME_COMPARES.forEach((c,i)=>assert.equal(frameCompare(.5,.5,c),expected[i],c));
 assert.deepEqual(frameMaterial(base).sampler,base.sampler);
 assert.throws(()=>frameMaterial(m({alpha_test:{...base.alpha_test,reference:1.01}})));
 assert.throws(()=>frameMaterial(m({depth:{test:false,write:true,compare:'always'}})));
 assert.throws(()=>frameMaterial(m({typo:1})));
});
