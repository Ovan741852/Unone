import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const source=process.env.UNONE_PROJECTED_GEOMETRY_SOURCE;
const {projectedGeometryData}=await import(source?pathToFileURL(source):new URL('./projected-geometry.js',import.meta.url));
function fixture(count=256){
 const vertices=new Float32Array(count*10),indices=new Uint32Array(count*3);
 for(let i=0;i<count;i++){
  vertices.set([i%2?-0:i/10,-i/100,.5,1,i/256,1-i/256,0,.25,.75,1],i*10);
  indices.set([i,(i+1)%count,(i+2)%count],i*3);
 }
 return {d:{vertex_count:count,index_count:indices.length,vertices:Buffer.from(vertices.buffer).toString('base64'),indices:Buffer.from(indices.buffer).toString('base64')},vertices,indices};
}
test('large geometry decode preserves every float/index bit without per-byte callback iteration',()=>{
 const {d,vertices,indices}=fixture(16384),original=Uint8Array.from;let callbacks=0,value;
 Uint8Array.from=function(input,map,...rest){if(map)callbacks+=input.length;return original.call(this,input,map,...rest);};
 try{value=projectedGeometryData(d);}finally{Uint8Array.from=original;}
 assert.deepEqual(new Uint32Array(value.vertices.buffer),new Uint32Array(vertices.buffer));assert.deepEqual(value.indices,indices);
 assert.equal(callbacks,0,'packed transfer must use bounded byte copy rather than a JS callback per byte');
});
test('base64 shape, exact counts and original finite/W/RGBA/index guards remain active',()=>{
 const {d}=fixture();
 for(const value of ['',d.vertices.slice(0,-1),d.vertices.slice(0,-1)+'!',null,'AAAA===='])assert.throws(()=>projectedGeometryData({...d,vertices:value}));
 assert.throws(()=>projectedGeometryData({...d,vertex_count:d.vertex_count+1}));
 for(const [field,value] of [[0,NaN],[1,Infinity],[2,1e10],[3,0],[3,-1],[6,-.1],[7,1.1]]){
  const bytes=Buffer.from(d.vertices,'base64');bytes.writeFloatLE(value,field*4);assert.throws(()=>projectedGeometryData({...d,vertices:bytes.toString('base64')}));
 }
 const bytes=Buffer.from(d.indices,'base64');bytes.writeUInt32LE(d.vertex_count,0);assert.throws(()=>projectedGeometryData({...d,indices:bytes.toString('base64')}));
});
test('known little-endian wire values retain signed zero, subnormal and exact index ordering',()=>{
 const words=[0x80000000,0x00000001,0x3f000000,0x3f800000,0x3e800000,0xbf000000,0,0x3e800000,0x3f400000,0x3f800000];
 const bytes=Buffer.alloc(words.length*4);words.forEach((word,i)=>bytes.writeUInt32LE(word,i*4));
 const value=projectedGeometryData({vertex_count:1,index_count:3,vertices:bytes.toString('base64'),indices:'AAAAAAAAAAAAAAAA'});
 assert.deepEqual(Array.from(new Uint32Array(value.vertices.buffer)),words);assert.deepEqual(Array.from(value.indices),[0,0,0]);
 for(const n of [1,2,3]){
  assert.throws(()=>projectedGeometryData({vertex_count:1,index_count:3,vertices:bytes.subarray(n).toString('base64'),indices:'AAAAAAAAAAAAAAAA'}));
 }
});
