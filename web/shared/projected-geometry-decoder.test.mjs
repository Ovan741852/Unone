import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectedGeometryDecoder,projectedGeometryData} from './projected-geometry.js';
const b64=a=>Buffer.from(a.buffer).toString('base64');
const fixture=()=>({format:'f32le-clip4-uv2-rgba4-u32-v1',texture:'t',order:0,depth_test:false,depth_write:false,revision:1,vertex_count:3,index_count:3,
 vertices:b64(new Float32Array([-.5,-.5,.5,1,0,0,1,1,1,1,.5,-.5,.5,1,1,0,1,1,1,1,0,.5,.5,1,.5,1,1,1,1,1])),indices:b64(new Uint32Array([0,1,2]))});
const snapshot=d=>({projected_geometry:{triangle:d}});

test('unchanged full packed contents reuse validation and returned public geometry stays detached',()=>{
 const d=fixture(),decoder=createProjectedGeometryDecoder();decoder.entries(snapshot(d));
 for(let i=0;i<120;i++)decoder.entries(snapshot({...d}));
 assert.equal(decoder.metrics().projected_geometry_decodes,1);assert.equal(decoder.metrics().projected_geometry_decode_reuses,120);
 const first=decoder.geometry(d);first.vertices.fill(NaN);first.indices.fill(999);
 assert.deepEqual(decoder.geometry(d),projectedGeometryData(d));assert.equal(decoder.metrics().projected_retained_geometries,1);
 decoder.entries({});assert.equal(decoder.metrics().projected_retained_geometries,0);
});

test('same revision cannot bypass changed byte/count/index or material validation and rejected generations retain only the prior cache',()=>{
 const d=fixture(),decoder=createProjectedGeometryDecoder();decoder.entries(snapshot(d));const baseline=decoder.metrics();
 const badVertices=Buffer.from(d.vertices,'base64');badVertices.writeFloatLE(NaN,0);
 const badIndices=Buffer.from(d.indices,'base64');badIndices.writeUInt32LE(3,0);
 for(const change of [{vertices:badVertices.toString('base64')},{indices:badIndices.toString('base64')},{vertex_count:4},{blend:'source_over',depth_write:true},{blend:'typo'}])
  assert.throws(()=>decoder.entries(snapshot({...d,...change})),/PROJECTED_INVALID/);
 assert.deepEqual(decoder.metrics(),baseline);decoder.entries(snapshot(d));assert.equal(decoder.metrics().projected_geometry_decodes,1);
 const changed=Buffer.from(d.vertices,'base64');changed.writeFloatLE(-.25,0);const next={...d,vertices:changed.toString('base64')};
 decoder.entries(snapshot(next));assert.equal(decoder.metrics().projected_geometry_decodes,2);assert.equal(decoder.geometry(next).vertices[0],-.25);
 decoder.entries(snapshot({...next,revision:2}));assert.equal(decoder.metrics().projected_geometry_decodes,3);decoder.clear();assert.equal(decoder.metrics().projected_retained_geometries,0);
});

test('oversized packed transport is rejected before any base64 allocation',()=>{
 const d=fixture(),atob=globalThis.atob;let called=false;globalThis.atob=()=>{called=true;throw Error('Unexpected decode');};
 try{assert.throws(()=>projectedGeometryData({...d,vertices:d.vertices+d.vertices}),/exact bounded base64 lengths/);assert.equal(called,false);}
 finally{globalThis.atob=atob;}
});
