import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three/three.player.min.js';
import {Texture} from '../vendor/three/three.core.js';
import {createProjectedRenderer} from './projected.js';
const b64=a=>Buffer.from(a.buffer).toString('base64');
function fixture(revision=1){return {format:'f32le-clip4-uv2-rgba4-u32-v1',texture:'t',order:0,depth_test:false,depth_write:false,revision,vertex_count:3,index_count:3,
 vertices:b64(new Float32Array([-.5,-.5,.5,1,0,0,1,1,1,1,.5,-.5,.5,1,1,0,1,1,1,1,0,.5,.5,1,.5,1,1,1,1,1])),indices:b64(new Uint32Array([0,1,2]))};}
function edit(d,field,value){const bytes=Buffer.from(d.vertices,'base64');bytes.writeFloatLE(value,field*4);return {...d,vertices:bytes.toString('base64')};}
function harness(){
 const texture=new Texture(),adapter=createProjectedRenderer(T,()=>({state:'ready',texture})),specs=new Map([['t',{kind:'texture2d'}]]);let scene;
 const renderer={autoClear:true,getScissor:v=>v.set(0,0,1,1),getScissorTest:()=>false,setScissor(){},setScissorTest(){},getDrawingBufferSize:v=>v.set(64,48),getPixelRatio:()=>1,render:s=>{scene=s;for(const mesh of s.children)if(mesh.visible)mesh.onBeforeRender();}};
 const prepare=geometry=>adapter.prepare(adapter.entries({projected_geometry:geometry}),specs),draw=()=>{adapter.draw(renderer,new T.PerspectiveCamera());return scene.children;};
 return {adapter,prepare,draw,texture,renderer,specs};
}

test('same-size vertex/index changes retain geometry and material while unchanged redraws make no buffer or callback churn',()=>{
 const h=harness(),d=fixture();h.prepare({a:d});const mesh=h.draw()[0],geometry=mesh.geometry,material=mesh.material,
  interleaved=geometry.getAttribute('clipPosition').data,index=geometry.index,callback=mesh.onBeforeRender;
 const next={...edit(d,0,-.25),indices:b64(new Uint32Array([1,0,2])),revision:2};h.prepare({a:next});h.draw();
 assert.equal(mesh.geometry,geometry);assert.equal(mesh.material,material);assert.equal(interleaved.array[0],-.25);assert.deepEqual([...index.array],[1,0,2]);assert.equal(interleaved.version,1);assert.equal(index.version,1);
 const before=h.adapter.metrics(),array=interleaved.array;for(let i=0;i<120;i++){h.prepare({a:{...next}});h.draw();}
 assert.equal(interleaved.array,array);assert.equal(interleaved.version,1);assert.equal(index.version,1);assert.equal(mesh.onBeforeRender,callback);
 const after=h.adapter.metrics();assert.equal(after.projected_geometry_builds,1);assert.equal(after.projected_material_builds,1);assert.equal(after.projected_geometry_updates,1);assert.equal(after.projected_geometry_decodes,2);assert.equal(after.projected_geometry_decode_reuses-before.projected_geometry_decode_reuses,120);
 h.adapter.clear();assert.equal(h.adapter.metrics().projected_live_geometries,0);assert.equal(h.adapter.metrics().projected_live_materials,0);assert.equal(h.adapter.metrics().projected_retained_geometries,0);
});

test('stale revisions with changed valid bytes update; invalid later batches leave every old buffer and material intact',()=>{
 const h=harness(),d=fixture();h.prepare({a:d,b:d});const [a,b]=h.draw(),beforeA=a.geometry.getAttribute('clipPosition').data.array,beforeB=b.geometry.getAttribute('clipPosition').data.array;
 const changed=edit(d,0,-.2);h.prepare({a:changed,b:d});assert.notEqual(a.geometry.getAttribute('clipPosition').data.array,beforeA);
 const accepted=a.geometry.getAttribute('clipPosition').data.array,bad=Buffer.from(d.indices,'base64');bad.writeUInt32LE(99,0);
 assert.throws(()=>h.prepare({a:edit(d,0,-.1),b:{...d,indices:bad.toString('base64')}}),/PROJECTED_INVALID/);
 assert.equal(a.geometry.getAttribute('clipPosition').data.array,accepted);assert.equal(b.geometry.getAttribute('clipPosition').data.array,beforeB);assert.equal(h.adapter.metrics().projected_live_geometries,2);h.adapter.clear();
});

test('commit failure rolls back already assigned buffers and discards staged material resources',()=>{
 const h=harness(),d=fixture();h.prepare({a:d});const mesh=h.draw()[0],geometry=mesh.geometry,material=mesh.material,vertices=geometry.getAttribute('clipPosition').data,before=vertices.array,index=geometry.index;
 let current=index.array,fail=true;Object.defineProperty(index,'array',{configurable:true,get:()=>current,set:value=>{if(fail){fail=false;throw Error('INJECTED_INDEX_ASSIGN');}current=value;}});
 const next={...edit(d,0,-.1),indices:b64(new Uint32Array([1,0,2])),revision:2,blend:'source_over',alpha_cutoff:0};
 assert.throws(()=>h.prepare({a:next}),/INJECTED_INDEX_ASSIGN/);assert.equal(vertices.array,before);assert.equal(mesh.geometry,geometry);assert.equal(mesh.material,material);assert.equal(h.draw()[0],mesh);
 assert.equal(h.adapter.metrics().projected_live_geometries,1);assert.equal(h.adapter.metrics().projected_live_materials,1);assert.equal(h.adapter.metrics().projected_geometry_updates,0);
 h.prepare({a:next});assert.equal(mesh.geometry,geometry);assert.notEqual(mesh.material,material);assert.equal(h.adapter.metrics().projected_geometry_updates,1);assert.equal(h.adapter.metrics().projected_live_materials,1);h.adapter.clear();
});

test('count changes rebuild geometry, policy changes reuse geometry and removed draws retire resources',()=>{
 const h=harness(),d=fixture();h.prepare({a:d});const mesh=h.draw()[0],initial=mesh.geometry;
 const grown={...d,vertex_count:4,index_count:6,revision:2};
 // Build the larger payload directly; Buffer pools may have unrelated backing bytes.
 const old=new Float32Array(30);new Uint8Array(old.buffer).set(Buffer.from(d.vertices,'base64'));const all=new Float32Array(40);all.set(old);all.set([0,0,.5,1,0,0,1,1,1,1],30);
 grown.vertices=b64(all);grown.indices=b64(new Uint32Array([0,1,2,0,2,3]));h.prepare({a:grown});assert.notEqual(mesh.geometry,initial);assert.equal(h.adapter.metrics().projected_live_geometries,1);
 const geometry=mesh.geometry;h.prepare({a:{...grown,revision:3,blend:'source_over',alpha_cutoff:0}});assert.equal(mesh.geometry,geometry);assert.equal(h.adapter.metrics().projected_live_materials,1);
 h.prepare({});assert.equal(h.adapter.metrics().projected_batches,0);assert.equal(h.adapter.metrics().projected_live_geometries,0);assert.equal(h.adapter.metrics().projected_live_materials,0);assert.equal(h.adapter.metrics().projected_retained_geometries,0);h.adapter.clear();
});
