import test from 'node:test';
import assert from 'node:assert/strict';
import {projectedEntries,projectedGeometryData,assertProjectedBackend,projectedScissor,PROJECTED_VERTEX_SHADER} from './projected.js';
import {createProjectedRenderer} from './projected.js';
import * as projectedTransport from '../shared/projected-geometry.js';
import * as THREE from '../vendor/three/three.player.min.js';
import {Texture as FixtureTexture} from '../vendor/three/three.core.js';
const b64=a=>Buffer.from(a.buffer).toString('base64');

test('source-over is opt-in, depth-free and shares the authored rank queue with opaque batches',()=>{
 const source={...fixture(),blend:'source_over',depth_test:false,depth_write:false,alpha_cutoff:0};
 assert.doesNotThrow(()=>projectedEntries({projected_geometry:{s:source}}));
 for(const blend of [null,1,false,'normal','SOURCE_OVER'])assert.throws(()=>projectedEntries({projected_geometry:{s:{...source,blend}}}),/PROJECTED_INVALID: blend/);
 for(const flags of [{depth_test:true},{depth_write:true}])assert.throws(()=>projectedEntries({projected_geometry:{s:{...source,...flags}}}),/source_over requires depth_test=false and depth_write=false/);
 const texture=new FixtureTexture(),adapter=createProjectedRenderer(THREE,()=>({state:'ready',texture}));
 const specs=new Map([['t',{kind:'texture2d'}]]);let meshes;
 const renderer={autoClear:true,getScissor:v=>v.set(0,0,1,1),getScissorTest:()=>false,setScissor(){},setScissorTest(){},getDrawingBufferSize:v=>v.set(64,48),getPixelRatio:()=>1,render:s=>meshes=s.children.slice()};
 adapter.prepare(projectedEntries({projected_geometry:{translucent:{...source,order:0},laterOpaque:{...fixture(),order:1}}}),specs);adapter.draw(renderer,new THREE.PerspectiveCamera());
 const blended=meshes.find(m=>m.renderOrder===0).material,opaque=meshes.find(m=>m.renderOrder===1).material;
 assert.equal(blended.transparent,false);assert.equal(opaque.transparent,false);assert.equal(blended.blending,THREE.CustomBlending);assert.equal(opaque.blending,THREE.NoBlending);
 assert.equal(blended.blendSrc,THREE.SrcAlphaFactor);assert.equal(blended.blendDst,THREE.OneMinusSrcAlphaFactor);assert.equal(blended.blendSrcAlpha,THREE.OneFactor);assert.equal(blended.blendDstAlpha,THREE.OneMinusSrcAlphaFactor);
 assert.equal(blended.uniforms.projectedSourceOver.value,1);assert.equal(opaque.uniforms.projectedSourceOver.value,0);assert.equal(blended.depthFunc,THREE.AlwaysDepth);assert.equal(blended.depthWrite,false);
 adapter.clear();
 let textureCalls=0;const checked=createProjectedRenderer(THREE,()=>{textureCalls++;return {state:'ready',texture};},{raster:'upper_left_checked'});
 assert.throws(()=>checked.prepare(projectedEntries({projected_geometry:{s:source}}),specs),/PROJECTED_BLEND_UNSUPPORTED/);
 assert.equal(textureCalls,0);assert.equal(checked.metrics().projected_batches,0);checked.clear();
});

test('source-over bilinear samples premultiplied image colors before restoring straight RGB',()=>{
 const image=new Uint8Array([255,0,0,255,0,0,255,0]),sample=(u,blend,sampling_space='encoded')=>projectedTransport.projectedSampleRgba8(image,2,1,u,.5,{filter:'linear',sampling_space,blend});
 assert.deepEqual(sample(.5,'opaque'),[.5,0,.5,.5]);assert.deepEqual(sample(.5,'source_over'),[1,0,0,.5]);
 const linear=sample(.5,'source_over','linear');assert(Math.abs(linear[0]-1)<1e-12);assert.deepEqual(linear.slice(1),[0,0,.5]);assert.deepEqual(sample(1,'source_over'),[0,0,0,0]);
 const a=projectedTransport.projectedSampleRgba8(image,2,1,0,.5,{filter:'linear',sampling_space:'encoded',address_mode:'repeat',blend:'source_over'});
 assert.deepEqual(a,[1,0,0,.5]);
});
test('alpha comparison validation and actual Three uniforms follow revision without changing depth policy',()=>{
 const texture=new FixtureTexture(),adapter=createProjectedRenderer(THREE,()=>({state:'ready',texture}));
 const specs=new Map([['t',{kind:'texture2d'}]]);
 let mesh;const renderer={autoClear:true,getScissor:v=>v.set(0,0,1,1),getScissorTest:()=>false,setScissor(){},setScissorTest(){},getDrawingBufferSize:v=>v.set(640,480),getPixelRatio:()=>1,render:s=>mesh=s.children[0]};
 for(const [revision,mode,expected] of [[1,undefined,0],[2,'greater',1],[3,'greater_equal',0]]) {
  const f={...fixture(),revision,alpha_cutoff:.5};if(mode!==undefined)f.alpha_compare=mode;
  adapter.prepare(projectedEntries({projected_geometry:{tri:f}}),specs);adapter.draw(renderer,new THREE.PerspectiveCamera());
  assert.equal(mesh.material.uniforms.projectedAlphaStrict.value,expected);assert.equal(mesh.material.uniforms.projectedAlphaCutoff.value,.5);
  assert.equal(mesh.material.depthFunc,THREE.LessDepth);assert.equal(mesh.material.blending,THREE.NoBlending);
 }
 for(const value of [null,1,false,'less','Greater','']) {
  assert.throws(()=>projectedEntries({projected_geometry:{tri:{...fixture(),alpha_compare:value}}}),/PROJECTED_INVALID/);
 }
 assert.equal(adapter.metrics().projected_rebuilds,3);adapter.clear();
});
function fixture(){return {format:'f32le-clip4-uv2-rgba4-u32-v1',texture:'t',order:0,depth_test:true,depth_write:true,
 vertex_count:3,index_count:3,revision:1,vertices:b64(new Float32Array([-0.5,-0.5,0.25,1,0,0,1,1,1,1, 0.5,-0.5,0.25,1,1,0,1,1,1,1, 0,0.5,0.25,1,0.5,1,1,1,1,1])),indices:b64(new Uint32Array([0,1,2]))};}
test('packed clip bytes survive transport and retain exact vertex/index layout',()=>{
 const f=fixture(),entries=projectedEntries({projected_geometry:{tri:f}}),d=projectedGeometryData(entries[0][1]);
 assert.deepEqual([...d.vertices].slice(0,10),[-0.5,-0.5,0.25,1,0,0,1,1,1,1]);assert.deepEqual([...d.indices],[0,1,2]);
 assert.match(PROJECTED_VERTEX_SHADER,/2\.0\s*\*\s*clipPosition\.z\s*-\s*clipPosition\.w/);
});
test('invalid values and unknown snapshot fields are rejected before upload',()=>{
 for(const change of [f=>f.typo=1,f=>f.vertex_count=4,f=>f.depth_test='yes',f=>f.order=0.5,f=>f.vertices='!']){
  const f=fixture();change(f);assert.throws(()=>projectedEntries({projected_geometry:{tri:f}}),/PROJECTED_INVALID/);
 }
 for(const n of [NaN,Infinity]){const f=fixture();
  const bytes=Buffer.from(f.vertices,'base64');bytes.writeFloatLE(n,0);f.vertices=bytes.toString('base64');assert.throws(()=>projectedEntries({projected_geometry:{tri:f}}),/PROJECTED_INVALID/);}
 const f=fixture(),bytes=Buffer.from(f.indices,'base64');bytes.writeUInt32LE(3,0);f.indices=bytes.toString('base64');assert.throws(()=>projectedEntries({projected_geometry:{tri:f}}),/PROJECTED_INVALID/);
});
test('batch draw order is signed order then UTF8 id, unsupported backends fail closed',()=>{
 const a=fixture(),b={...fixture(),order:-1};assert.deepEqual(projectedEntries({projected_geometry:{z:a,a:b}}).map(x=>x[0]),['a','z']);
 assert.doesNotThrow(()=>assertProjectedBackend({projected_geometry:{}},'webgpu'));
 assert.throws(()=>assertProjectedBackend({projected_geometry:{tri:a}},'webgpu'),/PROJECTED_BACKEND_UNSUPPORTED/);
 assert.doesNotThrow(()=>assertProjectedBackend({projected_geometry:{tri:a}},'webgl'));
});
test('actual Three geometry, material, draw lifecycle and disposal retain the transport',()=>{
 const texture=new FixtureTexture(),adapter=createProjectedRenderer(THREE,()=>({state:'ready',texture}));
 const f=fixture(),specs=new Map([['t',{kind:'texture2d'}]]),entries=projectedEntries({projected_geometry:{tri:f}});
 adapter.prepare(entries,specs);const calls=[];let clearDepth=0;
 let rect=new THREE.Vector4(1,2,3,4),scissorTest=false;
 const renderer={autoClear:true,clearDepth(){clearDepth++;},getScissor(v){return v.copy(rect);},getScissorTest(){return scissorTest;},setScissorTest(v){scissorTest=v;},getDrawingBufferSize(v){return v.set(1280,720);},getPixelRatio(){return 1;},setScissor(...v){rect=v[0]?.isVector4?v[0].clone():new THREE.Vector4(...v);},render(scene){for(const m of scene.children)if(m.visible)m.onBeforeRender();calls.push(scene.children.slice());}};
 adapter.draw(renderer,new THREE.PerspectiveCamera(),true);
 const mesh=calls[0][0];assert.equal(mesh.frustumCulled,false);assert.equal(mesh.material.toneMapped,false);assert.equal(mesh.material.depthWrite,true);
 assert.equal(mesh.geometry.attributes.clipPosition.itemSize,4);assert.deepEqual([...mesh.geometry.index.array],[0,1,2]);
 assert.equal(mesh.geometry.attributes.clipPosition.getW(0),1);assert.equal(mesh.geometry.attributes.linearRgba.getX(0),1);
 assert.notEqual(mesh.material.uniforms.projectedTexture.value,texture);assert.equal(mesh.material.uniforms.projectedTexture.value.source,texture.source);
 assert.equal(mesh.material.uniforms.projectedTexture.value.minFilter,THREE.NearestFilter);assert.equal(renderer.autoClear,true);assert.equal(clearDepth,1);
 assert.deepEqual(rect.toArray(),[1,2,3,4]);assert.equal(scissorTest,false);
 adapter.prepare(entries,specs);assert.equal(adapter.metrics().projected_rebuilds,1);
 let disposed=0;mesh.geometry.addEventListener('dispose',()=>disposed++);adapter.prepare([],specs);assert.equal(disposed,1);assert.equal(adapter.metrics().projected_batches,0);
});
test('physical top-left scissor intersects viewport and rejects malformed bounds',()=>{
 const f={...fixture(),scissor:{x:128,y:0,width:512,height:480}};
 assert.doesNotThrow(()=>projectedEntries({projected_geometry:{tri:f}}));
 assert.deepEqual(projectedScissor(f.scissor,360,900),{x:128,y:0,width:232,height:480});
 assert.equal(projectedScissor(f.scissor,100,100),null);
 for(const s of [{x:0,y:0,width:0,height:1},{x:0.5,y:0,width:1,height:1},{x:32768,y:0,width:1,height:1},{x:0,y:0,width:1,height:1,typo:1}])assert.throws(()=>projectedEntries({projected_geometry:{tri:{...f,scissor:s}}}),/PROJECTED_INVALID/);
});

test('explicit material policy validates atomically and models encoded byte modulation',()=>{
 const f={...fixture(),color_mode:'encoded',filter:'linear',alpha_cutoff:127/255};
 assert.doesNotThrow(()=>projectedEntries({projected_geometry:{tri:f}}));
 for(const p of [{color_mode:'legacy'},{filter:'cubic'},{alpha_cutoff:-.1},{alpha_cutoff:1.1},{alpha_cutoff:NaN}])assert.throws(()=>projectedEntries({projected_geometry:{tri:{...f,...p}}}),/PROJECTED_INVALID/);
 assert.equal(typeof projectedTransport.projectedModulate,'function');
 const value=128/255;
 assert.equal(Math.round(projectedTransport.projectedModulate(value,value,'encoded')*255),64);
 assert.equal(Math.round(projectedTransport.projectedModulate(value,value,'linear')*255),93);
});

test('different material samplers share image data without mutating the source texture',()=>{
 const texture=new FixtureTexture(),originalMin=texture.minFilter,adapter=createProjectedRenderer(THREE,()=>({state:'ready',texture}));
 const a={...fixture(),color_mode:'encoded',filter:'linear',alpha_cutoff:127/255},b=fixture();
 adapter.prepare(projectedEntries({projected_geometry:{a,b}}),new Map([['t',{kind:'texture2d'}]]));
 let meshes;const renderer={autoClear:true,getScissor:v=>v.set(0,0,1,1),getScissorTest:()=>false,setScissor(){},setScissorTest(){},getDrawingBufferSize:v=>v.set(640,480),getPixelRatio:()=>1,render:s=>meshes=s.children};
 adapter.draw(renderer,new THREE.PerspectiveCamera());const [linear,nearest]=meshes.map(m=>m.material);
 assert.equal(linear.uniforms.projectedTexture.value.minFilter,THREE.LinearFilter);assert.equal(nearest.uniforms.projectedTexture.value.magFilter,THREE.NearestFilter);
 assert.equal(linear.uniforms.projectedTexture.value.source,texture.source);assert.notEqual(linear.uniforms.projectedTexture.value,nearest.uniforms.projectedTexture.value);
 assert.equal(texture.minFilter,originalMin);assert.equal(linear.uniforms.projectedEncodedMode.value,1);assert.equal(nearest.uniforms.projectedEncodedMode.value,0);
 assert.equal(linear.uniforms.projectedAlphaCutoff.value,127/255);assert.equal(nearest.uniforms.projectedAlphaCutoff.value,.05);
 adapter.clear();
});

test('2x2 encoded-space bilinear oracle preserves nearest UV orientation and clamp seams',()=>{
 const f={...fixture(),sampling_space:'encoded',filter:'linear'};
 assert.doesNotThrow(()=>projectedEntries({projected_geometry:{tri:f}}));
 assert.throws(()=>projectedEntries({projected_geometry:{tri:{...f,sampling_space:'legacy'}}}),/PROJECTED_INVALID/);
 const image=new Uint8Array([255,0,0,255,0,255,0,128,0,0,255,64,255,255,255,0]);
 const sample=(u,v,filter='linear',sampling_space='encoded')=>projectedTransport.projectedSampleRgba8(image,2,2,u,v,{filter,sampling_space});
 const e=sample(.5,.5),l=sample(.5,.5,'linear','linear');
 for(let i=0;i<3;i++){assert.ok(Math.abs(e[i]-.5)<1e-12);assert.equal(Math.round(l[i]*255),188);}
 assert.ok(Math.abs(e[3]-447/1020)<1e-12);assert.equal(l[3],e[3]);
 assert.deepEqual(sample(0,0,'nearest'),[0,0,1,64/255]);assert.deepEqual(sample(1,1,'nearest'),[0,1,0,128/255]);
 assert.deepEqual(sample(-10,-10),sample(0,0));assert.deepEqual(sample(10,10),sample(1,1));
 for(const uv of [[.25,.25],[.75,.25],[.25,.75],[.75,.75]])assert.deepEqual(sample(...uv,'nearest','encoded'),sample(...uv,'nearest','linear'));
});

test('repeat wraps individual bilinear neighbors across both UV seams including negative values',()=>{
 const f={...fixture(),sampling_space:'encoded',filter:'linear',address_mode:'repeat'};
 assert.doesNotThrow(()=>projectedEntries({projected_geometry:{tri:f}}));
 assert.throws(()=>projectedEntries({projected_geometry:{tri:{...f,address_mode:'mirror'}}}),/PROJECTED_INVALID/);
 const image=new Uint8Array([255,0,0,255,0,255,0,128,0,0,255,64,255,255,255,0]);
 const sample=(u,v,filter='linear')=>projectedTransport.projectedSampleRgba8(image,2,2,u,v,{filter,sampling_space:'encoded',address_mode:'repeat'});
 for(const uv of [[0,.25],[1,.25],[-1,.25],[2,.25]])assert.deepEqual(sample(...uv),[.5,.5,1,32/255]);
 assert.deepEqual(sample(-.25,.25,'nearest'),[1,1,1,0]);assert.deepEqual(sample(1.25,1.25,'nearest'),[0,0,1,64/255]);
 for(const uv of [[-.1,.3],[.9,.3],[1.9,.3]]){const a=sample(...uv),b=sample(.9,.3);for(let i=0;i<4;i++)assert.ok(Math.abs(a[i]-b[i])<1e-12);}
});
