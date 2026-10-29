// C01 r5: same-format projected geometry updates on the actual createFrameDraws module.
// A GPU mirror applies Three r179 WebGLAttributes rules (new buffer on first sight, bufferSubData when
// version increases, error on size change), so a missed needsUpdate shows up as stale "GPU" bytes.
// Node CPU only: this proves upload scheduling and CPU state, not real GPU timing or pixels.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import * as THREE from '../vendor/three/three.player.min.js';
import {frameProfileCases} from './projected-frame-profile.js';
import {projectedFrame} from '../shared/projected-frame.mjs';
const {createFrameDraws}=await import(process.env.UNONE_FRAME_DRAWS_SOURCE?pathToFileURL(process.env.UNONE_FRAME_DRAWS_SOURCE).href:new URL('./projected-frame-draws.js',import.meta.url).href);
const packetsFile=process.env.UNONE_PROJECTED_PACKETS;
const real=packetsFile&&fs.existsSync(packetsFile)?JSON.parse(fs.readFileSync(packetsFile,'utf8')).packets:null;

function fixture({faults={}}={}){
 const built={geometry:0,material:0},disposed=new Map(),noop=()=>{};
 const track=o=>{disposed.set(o,0);o.addEventListener('dispose',()=>disposed.set(o,disposed.get(o)+1));};
 class Geometry extends THREE.BufferGeometry{constructor(){if(faults.geometry)throw Error('fixture-geometry-fault');super();built.geometry++;track(this);}}
 class Material extends THREE.ShaderMaterial{constructor(p){if(faults.material)throw Error('fixture-material-fault');super(p);built.material++;track(this);}}
 // needsUpdate fault injection for a chosen buffer (commit-time failure).
 class Interleaved extends THREE.InterleavedBuffer{set needsUpdate(v){if(faults.commit===this)throw Error('fixture-commit-fault');super.needsUpdate=v;}}
 const texture=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);
 // Every declared texture id (including real packet ids) is ready unless a test overrides it.
 const sources={pending:{state:'loading'}};
 const api=createFrameDraws({...THREE,BufferGeometry:Geometry,ShaderMaterial:Material,InterleavedBuffer:Interleaved},s=>sources[s.id]??{state:'ready',texture});
 const specs={get:id=>({id,kind:'texture2d'})};sources.white={state:'ready',texture};
 const gpu=new Map(),calls={bufferData:0,bufferSubData:0,bytesData:0,bytesSub:0};
 function upload(buffer){
  const at=gpu.get(buffer);
  if(!at){gpu.set(buffer,{version:buffer.version,size:buffer.array.byteLength,bytes:new Uint8Array(buffer.array.buffer.slice(buffer.array.byteOffset,buffer.array.byteOffset+buffer.array.byteLength))});calls.bufferData++;calls.bytesData+=buffer.array.byteLength;return;}
  if(at.version<buffer.version){if(at.size!==buffer.array.byteLength)throw Error('THREE.WebGLAttributes: Resizing buffer attributes is not supported.');
   at.bytes=new Uint8Array(buffer.array.buffer.slice(buffer.array.byteOffset,buffer.array.byteOffset+buffer.array.byteLength));at.version=buffer.version;calls.bufferSubData++;calls.bytesSub+=buffer.array.byteLength;}
 }
 let order=[],scissors=[];
 const renderer={getPixelRatio:()=>1,setScissor(...s){scissors.push(s);},setScissorTest:noop,render(scene){
  const mesh=scene.children[0],g=mesh.geometry,v=g.getAttribute('clipPosition').data;upload(v);upload(g.index);
  order.push({mesh,geometry:g,material:mesh.material,gpuVertices:gpu.get(v).bytes,gpuIndices:gpu.get(g.index).bytes,texture:mesh.material.uniforms.frameTexture.value});}};
 const prepare=f=>api.prepare(f.draws?.[0]?.data?f:projectedFrame({projected_frame:f}),specs);
 // Returns drawn meshes in order; the scissor calls of the same pass are attached as .scissors.
 const draw=()=>{order=[];scissors=[];api.draw(renderer,{},1280,720);return Object.assign(order,{scissors});};
 return {api,prepare,draw,built,disposed,calls,sources,faults,clear:()=>api.clear()};
}
const bytes=a=>new Uint8Array(a.buffer.slice(a.byteOffset,a.byteOffset+a.byteLength));
// The complete observable drawn frame: ids order, scissors, exact GPU-visible bytes, material state.
function frameView(events,decoded){
 const meshes=events,scissors=events.scissors;
 return {scissors,draws:meshes.map((e,i)=>({vertices:Buffer.from(e.gpuVertices).toString('base64'),indices:Buffer.from(e.gpuIndices).toString('base64'),
  expectedVertices:decoded?Buffer.from(bytes(decoded.draws[i].data.vertices)).toString('base64'):undefined,
  material:{vs:e.material.vertexShader,fs:e.material.fragmentShader,depthTest:e.material.depthTest,depthWrite:e.material.depthWrite,depthFunc:e.material.depthFunc,
   blending:e.material.blending,transparent:e.material.transparent,uniforms:Object.fromEntries(Object.entries(e.material.uniforms).filter(([k])=>k!=='frameTexture').map(([k,u])=>[k,u.value]))},
  texture:{min:e.texture.minFilter,mag:e.texture.magFilter,wrapS:e.texture.wrapS,wrapT:e.texture.wrapT,image:Array.from(e.texture.image.data),flipY:e.texture.flipY,colorSpace:e.texture.colorSpace}}))};
}
function synthetic(count=3){
 const f=structuredClone(frameProfileCases(1280,720).find(c=>c.id==='alpha-always').frame);f.revision=1;
 const d=f.draws[0];f.draws=Array.from({length:count},(_,i)=>{const x=structuredClone(d);x.id='d'+i;const v=Buffer.from(x.vertices,'base64');v.writeFloatLE(v.readFloatLE(0)+i/64,0);x.vertices=v.toString('base64');return x;});
 return f;
}
function editVertex(d,value,offset=0){const v=Buffer.from(d.vertices,'base64');v.writeFloatLE(value,offset);d.vertices=v.toString('base64');}
function swapIndices(d){const ix=Buffer.from(d.indices,'base64'),a=ix.readUInt32LE(0);ix.writeUInt32LE(ix.readUInt32LE(4),0);ix.writeUInt32LE(a,4);d.indices=ix.toString('base64');}
const sumVertexBytes=(f,ids)=>f.draws.filter(d=>ids.includes(d.id)).reduce((n,d)=>n+d.vertex_count*40,0);

test('real adjacent normal-World packets: same-length vertex changes update in place, length changes rebuild, output equals a fresh renderer',{skip:!real&&'packets missing'},()=>{
 const [a,b]=[real.find(p=>p.tick===71),real.find(p=>p.tick===72)],A=projectedFrame({projected_frame:a.projected_frame}),B=projectedFrame({projected_frame:b.projected_frame});
 const t=fixture();assert(t.prepare(A));const before=t.draw();const m0=t.api.metrics();
 assert(t.prepare(B));const after=t.draw(),m1=t.api.metrics();
 const prev=new Map(A.draws.map(d=>[d.id,d]));let updated=[],rebuilt=[];
 B.draws.forEach((d,i)=>{const o=prev.get(d.id),idx=A.draws.indexOf(o);
  if(o.vertex_count===d.vertex_count&&o.index_count===d.index_count){updated.push(d.id);
   assert.ok(after[i].geometry===before[idx].geometry,'same geometry object kept: '+d.id);assert.ok(after[i].material===before[idx].material,'same material object kept');
  }else{rebuilt.push(d.id);assert.notEqual(after[i].geometry,before[idx].geometry);assert.equal(t.disposed.get(before[idx].geometry),1,'replaced geometry disposed once');}});
 assert.equal(updated.length,31);assert.equal(rebuilt.length,1);
 assert.equal(m1.frame_geometry_updates-m0.frame_geometry_updates,31);assert.equal(m1.frame_geometry_builds-m0.frame_geometry_builds,1);
 assert.equal(m1.frame_geometry_disposes-m0.frame_geometry_disposes,1);assert.equal(m1.frame_geometry_update_fallbacks-m0.frame_geometry_update_fallbacks,1);
 assert.equal(m1.frame_geometry_vertex_update_bytes-m0.frame_geometry_vertex_update_bytes,sumVertexBytes(B,updated));
 assert.equal(m1.frame_geometry_index_update_bytes-m0.frame_geometry_index_update_bytes,0,'unchanged indices are not uploaded');
 const fresh=fixture();fresh.prepare(B);const view=frameView(after,B),freshView=frameView(fresh.draw(),B);
 assert.deepEqual(view,freshView,'incremental frame == fresh renderer: bytes/material/uniforms/texture/scissor/order');
 for(const d of view.draws)assert.equal(d.vertices,d.expectedVertices,'GPU-visible bytes equal the new packet');
 t.clear();fresh.clear();for(const [o,n] of t.disposed)assert.equal(n,1,'every resource disposed exactly once');
});
test('same-format updates mark only the changed buffer; same bytes reuse; length changes fall back to build',()=>{
 const t=fixture(),f=synthetic(3);t.prepare(f);const a=t.draw(),base=t.api.metrics(),calls0={...t.calls};
 const versions=a.map(e=>[e.geometry.getAttribute('clipPosition').data.version,e.geometry.index.version]);
 const g=structuredClone(f);g.revision++;editVertex(g.draws[0],.5);swapIndices(g.draws[1]);editVertex(g.draws[2],.25);swapIndices(g.draws[2]);
 t.prepare(g);const b=t.draw(),m=t.api.metrics();
 b.forEach((e,i)=>assert.equal(e.geometry,a[i].geometry));
 assert.deepEqual(b.map(e=>[e.geometry.getAttribute('clipPosition').data.version,e.geometry.index.version]),[[versions[0][0]+1,versions[0][1]],[versions[1][0],versions[1][1]+1],[versions[2][0]+1,versions[2][1]+1]]);
 assert.equal(m.frame_geometry_updates-base.frame_geometry_updates,3);assert.equal(m.frame_geometry_builds,base.frame_geometry_builds);
 assert.equal(m.frame_geometry_vertex_update_bytes-base.frame_geometry_vertex_update_bytes,2*f.draws[0].vertex_count*40);
 assert.equal(m.frame_geometry_index_update_bytes-base.frame_geometry_index_update_bytes,2*f.draws[0].index_count*4);
 assert.deepEqual([t.calls.bufferSubData-calls0.bufferSubData,t.calls.bufferData-calls0.bufferData],[4,0],'4 changed buffers re-uploaded, no new GPU buffers');
 const view=frameView(b,projectedFrame({projected_frame:g})),fresh=fixture();fresh.prepare(g);assert.deepEqual(view,frameView(fresh.draw(),projectedFrame({projected_frame:g})));
 // same bytes at a new revision: zero updates, zero uploads
 const same=structuredClone(g);same.revision++;const c1={...t.calls};t.prepare(same);t.draw();
 assert.equal(t.api.metrics().frame_geometry_updates,m.frame_geometry_updates);assert.deepEqual([t.calls.bufferSubData,t.calls.bufferData],[c1.bufferSubData,c1.bufferData]);
 // vertex count change -> fallback build, old geometry disposed once, GPU buffer new (no resize)
 const grow=synthetic(3);grow.revision=same.revision+1;const d=grow.draws[0];const v=Buffer.from(d.vertices,'base64'),ix=Buffer.from(d.indices,'base64');
 d.vertices=Buffer.concat([v,v]).toString('base64');d.vertex_count*=2;const ix2=Buffer.from(ix);for(let k=0;k<ix2.length;k+=4)ix2.writeUInt32LE(ix.readUInt32LE(k)+d.vertex_count/2,k);
 d.indices=Buffer.concat([ix,ix2]).toString('base64');d.index_count*=2;
 const before=t.draw()[0].geometry;assert.doesNotThrow(()=>{t.prepare(grow);t.draw();});const mg=t.api.metrics();
 assert.notEqual(t.draw()[0].geometry,before);assert.equal(t.disposed.get(before),1);assert.equal(mg.frame_geometry_fallback_vertex_length-m.frame_geometry_fallback_vertex_length,1);
 t.clear();fresh.clear();for(const n of t.disposed.values())assert.equal(n,1);
});
test('owned copies: caller in-place edits and reused decoded arrays never alias renderer arrays; signed zero bits update',()=>{
 const t=fixture(),f=projectedFrame({projected_frame:synthetic(1)});t.prepare(f);
 const a=t.draw()[0],gpu0=Buffer.from(a.gpuVertices).toString('base64');
 f.draws[0].data.vertices[0]+=.125;assert.equal(Buffer.from(t.draw()[0].gpuVertices).toString('base64'),gpu0,'host mutation invisible before prepare');
 t.prepare(f);const b=t.draw()[0];
 assert.equal(b.geometry,a.geometry);assert.notEqual(b.geometry.getAttribute('clipPosition').data.array,f.draws[0].data.vertices,'renderer owns a copy');
 assert.equal(Buffer.from(b.gpuVertices).toString('base64'),Buffer.from(bytes(f.draws[0].data.vertices)).toString('base64'));
 f.draws[0].data.vertices[0]=-0;t.prepare(f);const z=t.draw()[0];
 assert.equal(new DataView(z.gpuVertices.buffer).getUint32(0,true),0x80000000,'-0 sign bit preserved');
 f.draws[0].data.vertices[0]=0;t.prepare(f);
 assert.equal(new DataView(t.draw()[0].gpuVertices.buffer).getUint32(0,true),0,'+0 differs from -0 and is updated');
 const g=synthetic(1);const raw=Buffer.from(g.draws[0].vertices,'base64');raw.writeFloatLE(NaN,0);g.draws[0].vertices=raw.toString('base64');
 assert.throws(()=>projectedFrame({projected_frame:g}),/PROJECTED_INVALID/,'NaN rejected by the parser before the renderer');
 t.clear();
});
test('failure atomicity: a later material, geometry or texture failure leaves the old frame and its GPU bytes intact',()=>{
 for(const fault of ['material','geometry','texture']){
  const t=fixture(),f=synthetic(3);t.prepare(f);const old=t.draw(),oldView=frameView(old),m0=t.api.metrics();
  const arrays=old.map(e=>e.geometry.getAttribute('clipPosition').data.array),versions=old.map(e=>e.geometry.getAttribute('clipPosition').data.version);
  const next=structuredClone(f);next.revision++;editVertex(next.draws[0],.75);
  if(fault==='material'){next.draws[2].material.depth.write=!next.draws[2].material.depth.write;t.faults.material=true;}
  if(fault==='geometry'){const d=next.draws[2],v=Buffer.from(d.vertices,'base64');d.vertices=Buffer.concat([v,v]).toString('base64');d.vertex_count*=2;t.faults.geometry=true;}
  if(fault==='texture'){next.draws[2].texture='pending';t.sources.pending.error=Error('fixture-texture-fault');}
  assert.throws(()=>t.prepare(next),new RegExp(`fixture-${fault}-fault`));
  const after=t.draw();assert.deepEqual(frameView(after),oldView,fault+': old frame renders identically');
  after.forEach((e,i)=>{assert.equal(e.geometry.getAttribute('clipPosition').data.array,arrays[i]);assert.equal(e.geometry.getAttribute('clipPosition').data.version,versions[i],'no early needsUpdate');});
  const m1=t.api.metrics();for(const k of ['frame_geometry_updates','frame_live_geometries','frame_live_materials','frame_geometry_vertex_update_bytes'])assert.equal(m1[k],m0[k],fault+' '+k);
  assert.equal(m1.frame_geometry_builds-m1.frame_geometry_disposes,m0.frame_geometry_builds-m0.frame_geometry_disposes,'staged resources disposed');
  t.faults.material=t.faults.geometry=false;t.sources.pending={state:'ready',texture:t.sources.white.texture};
  assert(t.prepare(next),fault+': retry succeeds');const fresh=fixture();fresh.sources.pending={state:'ready',texture:t.sources.white.texture};fresh.prepare(next);assert.deepEqual(frameView(t.draw()),frameView(fresh.draw()));
  t.clear();fresh.clear();for(const n of t.disposed.values())assert.equal(n,1);
 }
});
test('a commit-time fault rolls back every assigned array reference; retry converges to the exact new frame',()=>{
 const t=fixture(),f=synthetic(3);t.prepare(f);const old=t.draw(),oldView=frameView(old);
 const arrays=old.map(e=>e.geometry.getAttribute('clipPosition').data.array);
 const next=structuredClone(f);next.revision++;for(const d of next.draws)editVertex(d,.375);
 t.faults.commit=old[2].geometry.getAttribute('clipPosition').data;
 assert.throws(()=>t.prepare(next),/fixture-commit-fault/);
 const after=t.draw();after.forEach((e,i)=>assert.equal(e.geometry.getAttribute('clipPosition').data.array,arrays[i],'array ref restored '+i));
 assert.deepEqual(frameView(after),oldView,'GPU-visible bytes equal the old frame (a re-upload of old bytes is allowed)');
 assert.equal(t.api.metrics().frame_geometry_updates,0);
 t.faults.commit=null;assert(t.prepare(next));const fresh=fixture();fresh.prepare(next);assert.deepEqual(frameView(t.draw()),frameView(fresh.draw()));
 t.clear();fresh.clear();
});
test('remove, reinsert, clear, new Core revision 1 and context restore dispose each resource exactly once',()=>{
 const t=fixture(),f=synthetic(3);t.prepare(f);const a=t.draw();
 const g=structuredClone(f);g.revision++;editVertex(g.draws[0],.5);t.prepare(g);
 const h=structuredClone(g);h.revision++;h.draws.splice(1,1);t.prepare(h);assert.equal(t.disposed.get(a[1].geometry),1,'removed id disposed');
 const r=structuredClone(g);r.revision++;t.prepare(r);const re=t.draw();assert.notEqual(re[1].geometry,a[1].geometry,'reinserted id rebuilt');
 const core=structuredClone(r);core.revision=1;const u0=t.api.metrics().frame_geometry_updates;t.prepare(core);assert.equal(t.api.metrics().frame_geometry_updates,u0,'new Core same content: no update');
 t.clear();const live=t.api.metrics();assert.equal(live.frame_live_geometries,0);assert.equal(live.frame_live_materials,0);
 t.prepare(core);const restored=t.draw();restored.forEach((e,i)=>assert.notEqual(e.geometry,re[i].geometry,'context restore rebuilds'));
 t.clear();for(const [o,n] of t.disposed)assert.equal(n,1,'disposed exactly once');
});
test('duplicate ids and malformed packets are rejected before any resource change',()=>{
 const t=fixture(),f=synthetic(2);t.prepare(f);const old=frameView(t.draw()),m0=t.api.metrics();
 const dup=projectedFrame({projected_frame:f});dup.draws[1].id=dup.draws[0].id;editVertex(f.draws[0],.9);
 assert.throws(()=>t.prepare(dup),/DUPLICATE_ID/);
 const bad=structuredClone(f);bad.draws[0].vertex_count=4;assert.throws(()=>projectedFrame({projected_frame:bad}),/PROJECTED_FRAME_INVALID/);
 assert.deepEqual(frameView(t.draw()),old);assert.deepEqual(t.api.metrics(),m0);t.clear();
});

test('Root: replacing the first geometry and material cannot dispose old resources before a later commit succeeds',()=>{
 const t=fixture(),f=synthetic(3);t.prepare(f);const old=t.draw(),oldView=frameView(old),m0=t.api.metrics();
 const next=structuredClone(f);next.revision++;
 const d=next.draws[0],v=Buffer.from(d.vertices,'base64');d.vertices=Buffer.concat([v,v]).toString('base64');d.vertex_count*=2;
 d.material.depth.write=!d.material.depth.write;
 editVertex(next.draws[2],.375);t.faults.commit=old[2].geometry.getAttribute('clipPosition').data;
 assert.throws(()=>t.prepare(next),/fixture-commit-fault/);
 const rollback=t.draw();assert.deepEqual(frameView(rollback),oldView);
 assert.equal(rollback[0].geometry,old[0].geometry);assert.equal(rollback[0].material,old[0].material);
 assert.equal(t.disposed.get(old[0].geometry),0,'old GPU geometry remains live through rollback');
 assert.equal(t.disposed.get(old[0].material),0,'old material remains live through rollback');
 const m1=t.api.metrics();assert.equal(m1.frame_live_geometries,m0.frame_live_geometries);assert.equal(m1.frame_live_materials,m0.frame_live_materials);
 t.faults.commit=null;assert(t.prepare(next));
 assert.equal(t.disposed.get(old[0].geometry),1);assert.equal(t.disposed.get(old[0].material),1);
 const fresh=fixture();fresh.prepare(next);assert.deepEqual(frameView(t.draw()),frameView(fresh.draw()));
 t.clear();fresh.clear();for(const n of t.disposed.values())assert.equal(n,1);
});

test('Root: a new sampler staged before commit failure is discarded without replacing the old frame',()=>{
 const t=fixture(),f=synthetic(2);t.prepare(f);const old=t.draw(),oldView=frameView(old),m0=t.api.metrics();
 const next=structuredClone(f);next.revision++;next.draws[0].material.sampler.min='linear';
 editVertex(next.draws[1],.625);t.faults.commit=old[1].geometry.getAttribute('clipPosition').data;
 assert.throws(()=>t.prepare(next),/fixture-commit-fault/);
 const rollback=t.draw();assert.deepEqual(frameView(rollback),oldView);assert.equal(rollback[0].texture,old[0].texture);
 const m1=t.api.metrics();assert.equal(m1.frame_texture_builds,m0.frame_texture_builds+1,'one new sampler variant staged');
 assert.equal(m1.frame_texture_disposes,m0.frame_texture_disposes+1,'staged variant disposed after failed commit');
 assert.equal(m1.frame_live_textures,m0.frame_live_textures,'no leaked sampler variant');
 t.faults.commit=null;assert(t.prepare(next));
 const fresh=fixture();fresh.prepare(next);assert.deepEqual(frameView(t.draw()),frameView(fresh.draw()));
 t.clear();fresh.clear();assert.equal(t.api.metrics().frame_live_textures,0);
});
