import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectedFrame} from './projected-frame.mjs';
import {frameFixture} from './projected-frame.test.mjs';

function frame(count){
 const f=frameFixture(),d=f.draws[0];
 f.profile='rgb8_encoded_gouraud_v1';f.draws=Array.from({length:count},(_,n)=>({...d,id:String(n+1)}));
 return f;
}
test('bounded ordered frame accepts256/257/1024 and rejects1025',()=>{
 for(const n of [256,257,1024]){
  const decoded=projectedFrame({projected_frame:frame(n)});
  assert.equal(decoded.draws.length,n);assert.equal(decoded.draws[0].id,'1');assert.equal(decoded.draws[n-1].id,String(n));
 }
 assert.throws(()=>projectedFrame({projected_frame:frame(1025)}));
});
test('global vertex/index budgets still reject within draw capacity',()=>{
 const f=frame(5),d=f.draws[0],vertices=Buffer.alloc(262144*40),one=Buffer.from(d.vertices,'base64');
 for(let at=0;at<vertices.length;at+=one.length)one.copy(vertices,at,0,Math.min(one.length,vertices.length-at));
 const text=vertices.toString('base64');
 for(const draw of f.draws){draw.vertex_count=262144;draw.vertices=text;}
 assert.equal(projectedFrame({projected_frame:{...f,draws:f.draws.slice(0,4)}}).draws.length,4);
 assert.throws(()=>projectedFrame({projected_frame:f}),/world budgets/);
 const g=frame(5),indices=Buffer.alloc(1572864*4),triangle=Buffer.from(g.draws[0].indices,'base64');
 for(let at=0;at<indices.length;at+=triangle.length)triangle.copy(indices,at);
 for(const draw of g.draws){draw.index_count=1572864;draw.indices=indices.toString('base64');}
 assert.throws(()=>projectedFrame({projected_frame:g}),/world budgets/);
});
