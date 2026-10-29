import {test} from 'node:test';import assert from 'node:assert/strict';import {projectedFrame} from './projected-frame.mjs';
export function frameFixture(){
 const v=new Float32Array([-.5,-.5,.25,1,0,0,1,1,1,.5,.5,-.5,.25,1,1,0,1,1,1,.5,0,.5,.25,1,.5,1,1,1,1,.5]);
 const material={rgb:'texture_times_vertex',texture_alpha:'sampled',alpha:'texture',alpha_test:{enabled:true,compare:'greater',reference:127/255},
  blend:{enabled:true,operation:'add',source:'source_alpha',destination:'one_minus_source_alpha'},depth:{test:true,write:false,compare:'less_equal'},
  sampler:{min:'nearest',mag:'linear',address_u:'repeat',address_v:'clamp'}};
 const d={id:'z-first',texture:'texture://test',format:'f32le-clip4-uv2-rgba4-u32-v1',clip_policy:'clip',material,
  vertex_count:3,index_count:3,vertices:Buffer.from(v.buffer).toString('base64'),indices:Buffer.from(new Uint32Array([0,1,2]).buffer).toString('base64')};
 return {profile:'rgb8_encoded_rebuild_v1',initial:{rgb8:[17,24,39],depth:1},draws:[d],revision:1};
}
const decode=f=>projectedFrame({projected_frame:f});
test('decoder preserves order, detaches canonical materials and decodes real40B',()=>{
 const f=frameFixture();f.draws.push({...structuredClone(f.draws[0]),id:'a-last'});
 const a=decode(f);assert.deepEqual(a.draws.map(d=>d.id),['z-first','a-last']);
 assert.equal(a.draws[0].data.vertices[2],.25);assert.equal(a.draws[0].material.alpha_test.reference,Math.fround(127/255));
 f.draws[0].material.depth.compare='never';assert.equal(a.draws[0].material.depth.compare,'less_equal');
 assert.equal(projectedFrame({}),null);
});
test('decoder closes every schema, dense sequence, scalar, RGBA, W/Z/inside/flat and budgets',()=>{
 const bad=[];const add=mutate=>{const f=frameFixture();mutate(f);bad.push(f);};
 add(f=>f.typo=1);add(f=>f.initial.typo=1);add(f=>f.draws[0].typo=1);
 add(f=>f.draws[0].material.sampler.typo=1);add(f=>f.draws[0].material.alpha_test.reference=1.1);
 add(f=>f.initial.rgb8=[1,2]);add(f=>f.initial.rgb8[0]=.5);add(f=>f.initial.depth=Infinity);
 add(f=>f.draws[0].scissor={x:0,y:0,width:0,height:1});add(f=>f.draws[0].index_count=4);
 add(f=>f.draws[0].material.depth={test:false,write:true,compare:'always'});
 add(f=>{delete f.draws[0];});add(f=>{f.draws.extra=f.draws[0];});
 add(f=>f.draws.push(structuredClone(f.draws[0])));add(f=>f.revision=0);
 for(const [offset,value] of [[24,1.1],[12,2],[8,-.1],[64,.75],[0,-2]])add(f=>{
  const b=Buffer.from(f.draws[0].vertices,'base64');b.writeFloatLE(value,offset);f.draws[0].vertices=b.toString('base64');
  if(offset===0)f.draws[0].clip_policy='inside';
 });
 bad.forEach((f,i)=>assert.throws(()=>decode(f),undefined,'case'+i));
 assert.throws(()=>decode(null));assert.throws(()=>decode({...frameFixture(),draws:Array(257).fill(frameFixture().draws[0])}));
});
test('empty frame and clipped outside XY are explicit, signed-zero transport is preserved',()=>{
 const f=frameFixture();f.draws=[];assert.deepEqual(decode(f).draws,[]);
 const a=frameFixture(),b=Buffer.from(a.draws[0].vertices,'base64');b.writeFloatLE(-2,0);b.writeFloatLE(-0,4);a.draws[0].vertices=b.toString('base64');
 const out=decode(a);assert.equal(out.draws[0].data.vertices[0],-2);assert(Object.is(out.draws[0].data.vertices[1],-0));
});
test('lossless u64 decimal revision transport rejects rounded unsafe JSON numbers',()=>{
 for(const revision of [1,Number.MAX_SAFE_INTEGER,'9007199254740992','18446744073709551615']){
  const f=frameFixture();f.revision=revision;assert.equal(decode(f).revision,revision);
 }
 for(const revision of [9007199254740992,'18446744073709551616','01','0']){
  const f=frameFixture();f.revision=revision;assert.throws(()=>decode(f));
 }
});
