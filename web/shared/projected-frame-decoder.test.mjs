import test from 'node:test';
import assert from 'node:assert/strict';
import * as frameModule from './projected-frame.mjs';
import {frameFixture} from './projected-frame.test.mjs';
const {projectedFrame}=frameModule;
// Count base64 payload decodes, the per-byte work that scales with geometry size.
function countAtob(fn){const original=globalThis.atob;let n=0;globalThis.atob=s=>{n++;return original(s);};try{fn();}finally{globalThis.atob=original;}return n;}
// Distinct content per draw; identical in-frame content would legitimately share one decode.
function frame(count=33){
 const f=frameFixture(),d=f.draws[0];
 f.draws=Array.from({length:count},(_,i)=>({...structuredClone(d),id:'d'+i,vertices:i?changedVertices(d,i/1024):d.vertices}));return f;
}
// Fresh string objects, as produced by every host JSON.parse.
const reparse=f=>JSON.parse(JSON.stringify(f));
function changedVertices(d,delta){const b=Buffer.from(d.vertices,'base64');b.writeFloatLE(b.readFloatLE(0)+delta,0);return b.toString('base64');}
function decoder(){
 assert.equal(typeof frameModule.createProjectedFrameDecoder,'function','retained frame decoder export');
 return frameModule.createProjectedFrameDecoder();
}
test('retained decoder re-decodes only changed geometry across redraws and host reparses',()=>{
 const decode=decoder(),f=frame(33);
 assert.equal(countAtob(()=>decode.decode({projected_frame:f})),66);
 assert.equal(countAtob(()=>decode.decode({projected_frame:f})),0,'unchanged redraw');
 assert.equal(countAtob(()=>decode.decode({projected_frame:reparse(f)})),0,'new revision, same content');
 const next=reparse(f);next.draws[5].vertices=changedVertices(next.draws[5],.01);next.revision++;
 assert.equal(countAtob(()=>decode.decode({projected_frame:next})),2,'one changed draw');
 assert.deepEqual(decode.metrics(),{geometry_decodes:34,geometry_reuses:98,retained_geometries:33});
});
test('retained output is byte-identical to the uncached decoder and isolated from in-place mutation',()=>{
 const decode=decoder(),f=frame(3);f.draws[1].scissor={x:1,y:2,width:3,height:4};
 const a=decode.decode({projected_frame:f});assert.deepEqual(a,projectedFrame({projected_frame:f}));
 a.draws[0].data.vertices[0]=999;a.draws[0].data.indices[0]=2;a.draws[1].scissor.x=50;a.draws[2].material.depth.compare='never';
 const b=decode.decode({projected_frame:f});assert.deepEqual(b,projectedFrame({projected_frame:f}));
 assert.notEqual(b.draws[0].data.vertices,a.draws[0].data.vertices);assert.equal(b.draws[0].data.vertices[0],-.5);
 f.draws[0].vertices=changedVertices(f.draws[0],.25);
 assert.deepEqual(decode.decode({projected_frame:f}),projectedFrame({projected_frame:f}),'in-place input mutation is observed');
});
test('cached content never bypasses validation of changed counts, policy, profile or bytes',()=>{
 const decode=decoder(),good=frame(1);decode.decode({projected_frame:good});
 const cases=[
  f=>{f.draws[0].vertex_count=4;},
  f=>{f.draws[0].index_count=6;},
  f=>{f.draws[0].indices=Buffer.from(new Uint32Array([0,1,3]).buffer).toString('base64');},
  f=>{const b=Buffer.from(f.draws[0].vertices,'base64');b.writeFloatLE(NaN,0);f.draws[0].vertices=b.toString('base64');},
  f=>{const b=Buffer.from(f.draws[0].vertices,'base64');b.writeFloatLE(2,0);f.draws[0].vertices=b.toString('base64');f.draws[0].clip_policy='inside';decode.decode({projected_frame:{...f,draws:[{...f.draws[0],clip_policy:'clip'}]}});},
  f=>{const b=Buffer.from(f.draws[0].vertices,'base64');b.writeFloatLE(.2,24+40);f.draws[0].vertices=b.toString('base64');f.profile='rgb8_encoded_gouraud_v1';decode.decode({projected_frame:f});f.profile='rgb8_encoded_rebuild_v1';},
  f=>{f.draws.push({...structuredClone(f.draws[0])});}
 ];
 for(const change of cases){
  const f=reparse(good);change(f);
  assert.throws(()=>decode.decode({projected_frame:f}),/PROJECTED_(FRAME_)?INVALID/);
  assert.throws(()=>projectedFrame({projected_frame:f}),/PROJECTED_(FRAME_)?INVALID/);
 }
});
test('failed decode is atomic, retention is bounded to the last accepted frame and clear releases it',()=>{
 const decode=decoder(),a=frame(4),b=frame(2);b.draws.forEach((d,i)=>{d.vertices=changedVertices(d,.1*(i+1));});
 decode.decode({projected_frame:a});
 const bad=reparse(a);bad.draws[3].vertex_count=4;assert.throws(()=>decode.decode({projected_frame:bad}),/PROJECTED_FRAME_INVALID: exact bounded base64 lengths/);
 assert.equal(countAtob(()=>decode.decode({projected_frame:a})),0,'previous generation kept after failure');
 decode.decode({projected_frame:b});assert.equal(decode.metrics().retained_geometries,2);
 assert.equal(countAtob(()=>decode.decode({projected_frame:a})),8,'evicted unused content');
 assert.equal(decode.decode({projected_frame:{...a,draws:[]}}).draws.length,0);assert.equal(decode.metrics().retained_geometries,0);
 decode.decode({projected_frame:a});decode.clear();assert.equal(decode.metrics().retained_geometries,0);
 assert.equal(countAtob(()=>decode.decode({projected_frame:a})),8);
 assert.equal(decode.decode({}),null);assert.equal(decode.metrics().retained_geometries,4,'absent frame does not evict');
});

test('renderer-owned decoder borrows stable validated geometry without per-redraw buffer copies',()=>{
 const decode=frameModule.createProjectedFrameDecoder({copyGeometry:false}),f=frame(4);
 const first=decode.decode({projected_frame:f});
 for(let i=0;i<120;i++){
  const next=decode.decode({projected_frame:f});
  next.draws.forEach((d,n)=>assert.equal(d.data,first.draws[n].data));
 }
 const changed=reparse(f);changed.draws[2].vertices=changedVertices(changed.draws[2],.1);
 const next=decode.decode({projected_frame:changed});
 assert.equal(next.draws[0].data,first.draws[0].data);
 assert.notEqual(next.draws[2].data,first.draws[2].data);
 // The default/public decoder still owns separate arrays; borrowed renderer storage never
 // aliases a fresh decoder or the caller's input (which contains only packed strings).
 const detached=decoder().decode({projected_frame:changed});detached.draws[0].data.vertices[0]=999;
 assert.notEqual(next.draws[0].data.vertices[0],999);
 decode.clear();assert.equal(decode.metrics().retained_geometries,0);
});
