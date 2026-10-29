import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import * as THREE from '../vendor/three/three.player.min.js';
import {frameProfileCases} from './projected-frame-profile.js';
import {projectedFrame} from '../shared/projected-frame.mjs';
const source=process.env.UNONE_FRAME_DRAWS_SOURCE;
const {createFrameDraws}=await import(source?pathToFileURL(source):new URL('./projected-frame-draws.js',import.meta.url));

function fixture(){
 const events=[],disposed={geometry:0,material:0},built={geometry:0,material:0};let failMaterial=false;
 class Geometry extends THREE.BufferGeometry{
  constructor(){super();built.geometry++;this.addEventListener('dispose',()=>disposed.geometry++);}
 }
 class Material extends THREE.ShaderMaterial{
  constructor(p){if(failMaterial)throw Error('fixture-material-fault');super(p);built.material++;this.addEventListener('dispose',()=>disposed.material++);}
 }
 const texture=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);
 const sources={white:{state:'ready',texture},pending:{state:'loading'}};
 const api=createFrameDraws({...THREE,BufferGeometry:Geometry,ShaderMaterial:Material},s=>sources[s.id]);
 const specs=new Map(Object.keys(sources).map(id=>[id,{id,kind:'texture2d'}]));
 const renderer={getPixelRatio:()=>1,setScissor(...v){events.push(['scissor',...v]);},setScissorTest(){},
  render(scene){const m=scene.children[0];events.push({geometry:m.geometry,material:m.material,mesh:m});}};
 function prepare(frame){return api.prepare(projectedFrame({projected_frame:frame}),specs);}
 function draw(){events.length=0;api.draw(renderer,{},1280,720);return events.filter(e=>!Array.isArray(e));}
 function clear(){api.clear();texture.dispose();}
 return {api,prepare,draw,clear,specs,sources,built,disposed,events,failMaterial:()=>{failMaterial=true;},recover:()=>{failMaterial=false;}};
}
function frame(count=3){
 const f=structuredClone(frameProfileCases(1280,720).find(c=>c.id==='alpha-always').frame);f.revision=1;
 const d=f.draws[0];f.draws=Array.from({length:count},(_,i)=>({...structuredClone(d),id:'d'+i}));return f;
}
test('overlay-only publication retains every unchanged world geometry and material',()=>{
 const t=fixture(),f=frame(620);assert(t.prepare(f));const initial=t.draw();
 const overlay=structuredClone(f.draws[0]);overlay.id='overlay';f.draws.push(overlay);f.revision++;
 assert(t.prepare(f));const next=t.draw();assert.equal(next.length,621);
 for(let i=0;i<620;i++){assert.equal(next[i].geometry,initial[i].geometry);assert.equal(next[i].material,initial[i].material);}
 assert.deepEqual(t.built,{geometry:621,material:621});assert.deepEqual(t.disposed,{geometry:0,material:0});
 f.draws.pop();f.revision++;t.prepare(f);assert.deepEqual(t.disposed,{geometry:1,material:1});t.clear();
 assert.deepEqual(t.disposed,{geometry:621,material:621});
});
test('changed geometry keeps its material; changed material keeps geometry; scissor and order stay exact',()=>{
 const t=fixture(),f=frame();t.prepare(f);const a=t.draw();
 const raw=Buffer.from(f.draws[1].vertices,'base64');raw.writeFloatLE(raw.readFloatLE(0)+.01,0);
 f.draws[1].vertices=raw.toString('base64');f.revision++;t.prepare(f);const b=t.draw();
 // C01 r5 contract: a same-length vertex change updates the existing geometry with the exact new bytes
 // (was: build a new geometry). Same object, new owned array, one update, no extra build.
 assert.equal(b[1].geometry,a[1].geometry);assert.equal(b[1].geometry.getAttribute('clipPosition').data.array[0],raw.readFloatLE(0));
 assert.equal(t.api.metrics().frame_geometry_updates,1);assert.equal(b[1].material,a[1].material);
 assert.equal(b[0].geometry,a[0].geometry);assert.deepEqual(t.built,{geometry:3,material:3});
 f.draws[1].material.depth.write=!f.draws[1].material.depth.write;f.draws.reverse();f.draws[0].scissor={x:10,y:20,width:100,height:200};f.revision++;
 t.prepare(f);const c=t.draw();assert.equal(c[1].geometry,b[1].geometry);assert.notEqual(c[1].material,b[1].material);
 assert.equal(c[0].mesh,b[2].mesh);assert.deepEqual(t.events[0],['scissor',10,20,100,200]);
 assert.deepEqual(t.built,{geometry:3,material:4});t.clear();assert.deepEqual(t.disposed,t.built);
});
test('new Core revision1 uses content identity, even at the same frame revision',()=>{
 const t=fixture(),f=frame(1);t.prepare(f);const a=t.draw()[0];
 const next=structuredClone(f);next.draws[0].texture='pending';assert.equal(t.prepare(next),false);
 t.sources.pending={state:'ready',texture:t.sources.white.texture};assert(t.prepare(next));const b=t.draw()[0];
 assert.equal(a.geometry,b.geometry);assert.equal(a.material,b.material);assert.deepEqual(t.built,{geometry:1,material:1});
 next.draws[0].material.depth.write=!next.draws[0].material.depth.write;t.prepare(next);assert.notEqual(t.draw()[0].material,b.material);t.clear();
});
test('unchanged content at a new revision allocates zero resources and empty frame releases exactly once',()=>{
 const t=fixture(),f=frame(5);t.prepare(f);f.revision++;t.prepare(f);assert.deepEqual(t.built,{geometry:5,material:5});
 f.draws=[];f.revision++;t.prepare(f);assert.equal(t.draw().length,0);assert.deepEqual(t.disposed,t.built);
 t.clear();t.clear();assert.deepEqual(t.disposed,t.built);
});
test('same decoded object with in-place same-length vertex/index mutations cannot bypass content checks',()=>{
 const t=fixture(),f=projectedFrame({projected_frame:frame(1)});t.api.prepare(f,t.specs);const a=t.draw()[0];
 const before=a.geometry.getAttribute('clipPosition').data.array[0];f.draws[0].data.vertices[0]+=.125;
 assert.equal(a.geometry.getAttribute('clipPosition').data.array[0],before,'host arrays must be detached');
 // C01 r5 contract: the in-place edit is detected and uploaded into the same geometry (was: new geometry).
 t.api.prepare(f,t.specs);const b=t.draw()[0];assert.equal(b.geometry,a.geometry);assert.equal(b.material,a.material);
 assert.equal(b.geometry.getAttribute('clipPosition').data.array[0],f.draws[0].data.vertices[0]);assert.notEqual(b.geometry.getAttribute('clipPosition').data.array,f.draws[0].data.vertices,'still detached');
 [f.draws[0].data.indices[0],f.draws[0].data.indices[1]]=[f.draws[0].data.indices[1],f.draws[0].data.indices[0]];
 t.api.prepare(f,t.specs);const c=t.draw()[0];assert.equal(c.geometry,b.geometry);assert.equal(c.material,b.material);
 assert.deepEqual(Array.from(c.geometry.index.array),Array.from(f.draws[0].data.indices));assert.equal(t.api.metrics().frame_geometry_updates,2);t.clear();
});
test('failed staged update preserves the previous usable frame and disposes newly staged resources',()=>{
 const t=fixture(),f=frame(3);t.prepare(f);const old=t.draw();const next=structuredClone(f);next.revision++;
 const raw=Buffer.from(next.draws[0].vertices,'base64');raw.writeFloatLE(.75,0);next.draws[0].vertices=raw.toString('base64');
 next.draws[1].material.depth.write=!next.draws[1].material.depth.write;t.failMaterial();
 const oldArray=old[0].geometry.getAttribute('clipPosition').data.array;
 assert.throws(()=>t.prepare(next),/fixture-material-fault/);const after=t.draw();
 for(let i=0;i<3;i++){assert.equal(after[i].geometry,old[i].geometry);assert.equal(after[i].material,old[i].material);}
 // C01 r5 contract: the vertex change was staged as an owned update (no geometry build), so the failure
 // leaves the old array in place and nothing is built or disposed (was: one staged geometry built+disposed).
 assert.equal(after[0].geometry.getAttribute('clipPosition').data.array,oldArray);
 assert.deepEqual(t.built,{geometry:3,material:3});assert.deepEqual(t.disposed,{geometry:0,material:0});
 t.recover();assert(t.prepare(next));t.clear();assert.deepEqual(t.disposed,t.built);
 const metrics=t.api.metrics();assert.equal(metrics.frame_live_geometries,0);assert.equal(metrics.frame_live_materials,0);assert.equal(metrics.frame_live_textures,0);
});
test('duplicates and texture errors reject before mutation; pending textures preserve old resources until ready',()=>{
 const t=fixture(),f=frame(2);t.prepare(f);const old=t.draw();const bad=structuredClone(f);bad.draws[1].id=bad.draws[0].id;
 const decoded=projectedFrame({projected_frame:f});decoded.draws[1].id=decoded.draws[0].id;
 assert.throws(()=>t.api.prepare(decoded,t.specs),/DUPLICATE_ID/);
 const pending=structuredClone(f);pending.draws[0].texture='pending';pending.revision++;
 assert.equal(t.prepare(pending),false);assert.equal(t.draw()[0].geometry,old[0].geometry);assert.deepEqual(t.built,{geometry:2,material:2});
 t.sources.pending.error=Error('fixture-texture-fault');assert.throws(()=>t.prepare(pending),/fixture-texture-fault/);
 assert.equal(t.draw()[0].material,old[0].material);assert.deepEqual(t.disposed,{geometry:0,material:0});
 t.sources.pending={state:'ready',texture:t.sources.white.texture};assert(t.prepare(pending));assert.equal(t.draw()[0].geometry,old[0].geometry);
 t.clear();assert.deepEqual(t.disposed,t.built);
});
test('alpha/depth rebuild just the material, while sampler/texture/scissor changes retain both GPU resources',()=>{
 const t=fixture(),f=frame(1);t.prepare(f);let old=t.draw()[0];
 f.draws[0].material.alpha='vertex';f.revision++;t.prepare(f);let next=t.draw()[0];
 assert.equal(next.geometry,old.geometry);assert.notEqual(next.material,old.material);assert.equal(next.material.uniforms.alphaSource.value,1);old=next;
 f.draws[0].material.depth.compare='always';f.revision++;t.prepare(f);next=t.draw()[0];
 assert.equal(next.geometry,old.geometry);assert.notEqual(next.material,old.material);old=next;
 f.draws[0].scissor={x:10,y:10,width:100,height:100};f.draws[0].material.sampler.min='nearest';f.revision++;t.prepare(f);next=t.draw()[0];
 assert.equal(next.geometry,old.geometry);assert.equal(next.material,old.material);t.clear();assert.deepEqual(t.disposed,t.built);
});
test('clear on context lifecycle then restore rebuilds a new usable frame without retaining disposed resources',()=>{
 const t=fixture(),f=frame(2);t.prepare(f);const before=t.draw();t.api.clear();t.prepare(f);const after=t.draw();
 for(let i=0;i<2;i++){assert.notEqual(before[i].geometry,after[i].geometry);assert.notEqual(before[i].material,after[i].material);}
 assert.equal(t.api.metrics().frame_live_geometries,2);assert.equal(t.api.metrics().frame_live_materials,2);
 t.clear();assert.deepEqual(t.disposed,t.built);assert.equal(t.api.metrics().frame_live_textures,0);
});
test('same Texture object with changed image or source version refreshes only the texture variant',()=>{
 const t=fixture(),f=frame(1);t.prepare(f);const before=t.draw()[0],first=before.material.uniforms.frameTexture.value;
 t.sources.white.texture.image.data[0]=17;t.sources.white.texture.needsUpdate=true;t.prepare(f);
 let after=t.draw()[0];assert.equal(after.geometry,before.geometry);assert.equal(after.material,before.material);
 const second=after.material.uniforms.frameTexture.value;assert.notEqual(second,first);assert.equal(second.image.data[0],17);
 t.sources.white.texture.image={data:new Uint8Array([31,255,255,255]),width:1,height:1};t.prepare(f);
 after=t.draw()[0];assert.notEqual(after.material.uniforms.frameTexture.value,second);assert.equal(after.material.uniforms.frameTexture.value.image.data[0],31);
 assert.deepEqual(t.built,{geometry:1,material:1});assert.equal(t.api.metrics().frame_live_textures,1);t.clear();assert.equal(t.api.metrics().frame_live_textures,0);
});
test('multiple sampler variants sharing one THREE Source never invalidate one another by their own upload versions',()=>{
 const t=fixture(),f=frame(2);f.draws[0].material.sampler.min='nearest';f.draws[1].material.sampler.min='linear';
 t.prepare(f);const first=t.draw().map(r=>r.material.uniforms.frameTexture.value),built=t.api.metrics().frame_texture_builds;
 for(let i=0;i<6;i++){t.prepare(f);const next=t.draw();next.forEach((r,n)=>assert.equal(r.material.uniforms.frameTexture.value,first[n]));}
 assert.equal(t.api.metrics().frame_texture_builds,built);assert.equal(t.api.metrics().frame_live_textures,2);
 t.sources.white.texture.needsUpdate=true;t.prepare(f);const changed=t.draw();changed.forEach((r,n)=>assert.notEqual(r.material.uniforms.frameTexture.value,first[n]));
 assert.equal(t.api.metrics().frame_texture_builds,built+2);t.clear();assert.equal(t.api.metrics().frame_live_textures,0);
});
