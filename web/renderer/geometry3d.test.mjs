import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.core.js';
import {createGeometry3DRenderer,geometry3dBytes} from './geometry3d.js';
import {createWorldCurvature} from './world-curvature.js';
import {InstanceTransfer,InstanceReceiver} from '../shared/instance-transfer.mjs';

// One triangle: position.xyz, uv, RGBA per vertex; u32 indices.
function triangle(lift=0){
  const v=new Float32Array(27);for(let i=0;i<3;i++){v.set([i,lift,0,i/2,0,1,1,1,1],i*9);}
  return {vertices:new Uint8Array(v.buffer),indices:new Uint8Array(new Uint32Array([0,1,2]).buffer)};
}
const base64=bytes=>Buffer.from(bytes).toString('base64');
const placement={position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}};
function mesh(revision,{lift=0,texture,material={}}={}){
  const t=triangle(lift);
  return {format:'f32le-p3-uv2-rgba4-u32-v1',vertex_count:3,index_count:3,revision,material,
    ...(texture?{texture}:{}),vertices:base64(t.vertices),indices:base64(t.indices)};
}

test('mesh bytes come from base64 or bounded memory views and are copied out of the heap',()=>{
  const t=triangle(2),heap=new ArrayBuffer(4096);new Uint8Array(heap).set(t.vertices,64);new Uint8Array(heap).set(t.indices,512);
  const view={...mesh(1),memory:{vertices:{offset:64,byte_length:108},indices:{offset:512,byte_length:12}}};delete view.vertices;delete view.indices;
  const fromMemory=geometry3dBytes(view,()=>heap);new Uint8Array(heap).fill(0);
  assert.equal(fromMemory.vertices[1],2,'decoded bytes never alias the heap');assert.deepEqual([...fromMemory.indices],[0,1,2]);
  assert.deepEqual(geometry3dBytes(mesh(1,{lift:2})).vertices,fromMemory.vertices);
  assert.throws(()=>geometry3dBytes({...view,memory:{...view.memory,vertices:{offset:4090,byte_length:108}}},()=>heap),/GEOMETRY3D_INVALID/);
  assert.throws(()=>geometry3dBytes({...mesh(1),index_count:4}),/GEOMETRY3D_INVALID/);
  assert.throws(()=>geometry3dBytes({...mesh(1),format:'other'}),/GEOMETRY3D_FORMAT_UNSUPPORTED/);
});

test('meshes rebuild only on a new revision; placement and visibility update in place',()=>{
  const scene=new THREE.Scene(),loaded={state:'pending',texture:new THREE.Texture()};
  const renderer=createGeometry3DRenderer(THREE,scene,{textureFor:()=>loaded,curvature:createWorldCurvature()});
  const specs=new Map([['texture://ground',{kind:'texture2d'}]]);
  assert.equal(renderer.draw({plain:mesh(1),ground:mesh(2,{texture:'texture://ground',material:{filter:'nearest',blend:'cutout'}})},{},specs),true,'a loading texture is pending');
  const plain=scene.children.find(o=>o.material&&!o.material.alphaTest),ground=scene.children.find(o=>o.material.alphaTest===.5);
  assert.equal(plain.visible,true);assert.equal(ground.visible,false,'textured meshes wait for their image');
  assert.equal(plain.geometry.attributes.color.itemSize,4);assert.equal(plain.geometry.index.count,3);
  loaded.state='ready';
  const moved={...placement,position:{x:5,y:0,z:0}};
  assert.equal(renderer.draw({plain:mesh(1),ground:mesh(2,{texture:'texture://ground',material:{filter:'nearest',blend:'cutout'}})},{plain:{transforms:[moved],visible:false}},specs),false);
  assert.equal(renderer.metrics().geometry3d_rebuilds,2,'placement never rebuilds');
  const matrix=new THREE.Matrix4();plain.getMatrixAt(0,matrix);
  assert.equal(matrix.elements[12],5);assert.equal(plain.visible,false);assert.equal(ground.visible,true);
  assert.equal(ground.material.map.magFilter,THREE.NearestFilter);assert.notEqual(ground.material.map,loaded.texture,'sampler state lives on a variant');
  const buffer=plain.geometry.attributes.position.data;
  renderer.draw({plain:mesh(3,{lift:1})},{},specs);
  assert.equal(renderer.metrics().geometry3d_rebuilds,2,'new bytes of the same shape never rebuild');assert.equal(renderer.metrics().geometry3d_updates,1);
  assert.equal(scene.children[0],plain);assert.equal(plain.geometry.attributes.position.data,buffer);assert.equal(plain.geometry.attributes.position.getY(0),1);
  assert.equal(scene.children.length,1,'removed meshes leave the scene');
  renderer.draw({plain:mesh(4,{material:{blend:'cutout'}})},{},specs);
  assert.equal(renderer.metrics().geometry3d_rebuilds,3,'a new material rebuilds');assert.notEqual(scene.children[0],plain);
  renderer.clear();assert.equal(scene.children.length,0);
  assert.throws(()=>renderer.draw({bad:mesh(4,{texture:'texture://missing'})},{},specs),/GEOMETRY3D_TEXTURE_MISSING/);
});

test('placements draw as instances and screen billboards carry pixel offsets',()=>{
  const scene=new THREE.Scene(),curvature=createWorldCurvature(),renderer=createGeometry3DRenderer(THREE,scene,{textureFor:()=>null,curvature});
  const tiles=[-128,0,128].map(x=>({...placement,position:{x,y:0,z:0}}));
  renderer.draw({ground:mesh(1)},{ground:{transforms:tiles,visible:true}},new Map());
  const ground=scene.children[0],matrix=new THREE.Matrix4();assert.equal(ground.count,3);ground.getMatrixAt(2,matrix);assert.equal(matrix.elements[12],128);
  renderer.draw({ground:mesh(1)},{ground:{transforms:[...tiles,...tiles],visible:true}},new Map());
  assert.equal(renderer.metrics().geometry3d_rebuilds,2,'outgrowing the instance capacity rebuilds once');assert.equal(scene.children[0].count,6);
  renderer.draw({ground:mesh(1)},{ground:{transforms:[],visible:true}},new Map());assert.equal(scene.children[0].visible,false);
  const v=new Float32Array(33);for(let i=0;i<3;i++)v.set([i,0,0,i*4,-8,0,0,1,1,1,1],i*11);
  const sprite={format:'f32le-p3-o2-uv2-rgba4-u32-v1',vertex_count:3,index_count:3,revision:2,material:{billboard:'screen',depth_bias:.5,blend:'cutout'},
    vertices:base64(new Uint8Array(v.buffer)),indices:base64(new Uint8Array(new Uint32Array([0,1,2]).buffer))};
  renderer.draw({sprite},{},new Map());
  const billboard=scene.children.find(o=>o.geometry.attributes.unoneOffset);
  assert.equal(billboard.geometry.attributes.unoneOffset.getX(1),4);assert.equal(billboard.geometry.attributes.uv.getY(0),0);assert.equal(billboard.material.side,THREE.DoubleSide);
  const projecting=()=>({uniforms:{},vertexShader:'void main(){\n#include <project_vertex>\n}'});
  const shader=projecting();billboard.material.onBeforeCompile(shader);
  assert.match(shader.vertexShader,/attribute vec2 unoneOffset/);assert.match(shader.vertexShader,/unoneBiased/);assert.equal(shader.uniforms.unoneDepthBias.value,.5);
  curvature.viewport(800,600);assert.deepEqual(shader.uniforms.unoneViewport.value,[800,600]);
  // Curvature preparation never replaces a billboard's own projection stage.
  curvature.prepare(scene,{position:{x:0,y:1,z:1},target:{x:0,y:0,z:0},curvature:.1});
  const again=projecting();billboard.material.onBeforeCompile(again);assert.match(again.vertexShader,/unoneBiased/);
});

test('curvature patches world materials lazily and bends in view space around the target',()=>{
  const scene=new THREE.Scene(),material=new THREE.MeshBasicMaterial(),object=new THREE.Mesh(new THREE.BufferGeometry(),material);scene.add(object);
  const curvature=createWorldCurvature(),flat={position:{x:0,y:3,z:4},target:{x:0,y:0,z:0}};
  curvature.prepare(scene,flat);assert.equal(material.onBeforeCompile.toString(),new THREE.MeshBasicMaterial().onBeforeCompile.toString(),'flat cameras patch nothing');
  curvature.prepare(scene,{...flat,curvature:0.01});assert.equal(object.frustumCulled,false);
  const shader={uniforms:{},vertexShader:'void main(){\n#include <project_vertex>\n}'};material.onBeforeCompile(shader);
  assert.match(shader.vertexShader,/uniform float unoneCurvature/);assert.match(shader.vertexShader,/mvPosition\.y-=unoneCurvature/);
  assert.equal(shader.uniforms.unoneCurvature.value,0.01);assert.equal(shader.uniforms.unoneCurveDistance.value,5);
  assert.match(material.customProgramCacheKey(),/unone-curvature/);
  const custom={uniforms:{},vertexShader:'void main(){gl_Position=vec4(0.);}'};material.onBeforeCompile(custom);
  assert.equal(custom.vertexShader,'void main(){gl_Position=vec4(0.);}','shaders without the projection chunk are untouched');
});

test('the worker sends mesh bytes once per revision and the receiver resolves them',()=>{
  const sender=new InstanceTransfer(),receiver=new InstanceReceiver(),t=triangle(1),heap=new ArrayBuffer(1024);
  new Uint8Array(heap).set(t.vertices,0);new Uint8Array(heap).set(t.indices,200);
  const world=revision=>({world:{frame:revision,geometry3d:{tri:{...mesh(revision),vertices:undefined,indices:undefined,memory:{vertices:{offset:0,byte_length:108},indices:{offset:200,byte_length:12}}}}}});
  const first=sender.encode(world(1),heap);assert.equal(first.updates.length,2);
  const value=receiver.accept(structuredClone(first,{transfer:first.updates.map(u=>u.buffer)}));
  const decoded=geometry3dBytes(value.world.geometry3d.tri,batch=>receiver.memory(batch));assert.equal(decoded.vertices[1],1);
  const again=sender.encode(world(1),heap);assert.equal(again.updates.length,0,'an unchanged revision transfers nothing');
  receiver.accept(structuredClone(again));
  assert.equal(sender.encode(world(2),heap).updates.length,2);
  assert.deepEqual(sender.encode({world:{frame:3}},heap).removed.sort(),['geometry3d:indices:tri','geometry3d:vertices:tri']);
});

test('same-shape revisions upload heap bytes into the existing buffers without aliasing the heap',()=>{
  const scene=new THREE.Scene(),renderer=createGeometry3DRenderer(THREE,scene,{textureFor:()=>null,curvature:createWorldCurvature(),memory:batch=>batch.memory.heap});
  const heap=new ArrayBuffer(4096),bytes=new Uint8Array(heap);
  const viewed=(revision,lift,order,offset)=>{const t=triangle(lift);bytes.set(t.vertices,offset);bytes.set(new Uint8Array(new Uint32Array(order).buffer),offset+200);
    const m={...mesh(revision),memory:{vertices:{offset,byte_length:108,heap},indices:{offset:offset+200,byte_length:12,heap}}};delete m.vertices;delete m.indices;return m;};
  renderer.draw({tri:viewed(1,0,[0,1,2],64)},{},new Map());
  const tri=scene.children[0],index=tri.geometry.index,version=index.version;
  renderer.draw({tri:viewed(2,3,[0,1,2],1001)},{},new Map());
  assert.equal(scene.children[0],tri);assert.equal(tri.geometry.attributes.position.getY(2),3,'unaligned heap bytes are copied');
  assert.equal(index.version,version,'unchanged indices are not uploaded again');
  renderer.draw({tri:viewed(3,3,[2,1,0],1500)},{},new Map());
  assert.deepEqual([...index.array],[2,1,0]);assert.ok(index.version>version);
  bytes.fill(0);assert.equal(tri.geometry.attributes.position.getY(2),3,'the geometry never aliases the heap');
  assert.deepEqual(renderer.metrics(),{geometry3d_meshes:1,geometry3d_rebuilds:1,geometry3d_updates:2});
});

test('shader meshes read the layout and stages their scene material declares',()=>{
  const scene=new THREE.Scene(),loaded={state:'ready',texture:new THREE.Texture()};
  const renderer=createGeometry3DRenderer(THREE,scene,{textureFor:()=>loaded,curvature:createWorldCurvature()});
  // Three vertices of position, uv, RGBA, then cell (3 floats) and corner (1).
  const v=new Float32Array(39);for(let i=0;i<3;i++)v.set([i,0,0,0,0,1,1,1,1,10+i,20,30,40+i],i*13);
  const bytes={vertices:base64(new Uint8Array(v.buffer)),indices:base64(new Uint8Array(new Uint32Array([0,1,2]).buffer))};
  const exact={fragment:'vec4 unoneShade(vec2 uv, vec4 color){return color+shade;}',
    vertex:'vec4 unoneVertex(vec3 position, mat4 model){shade=vec4(corner);return vec4(cell.xy*zoom,0.0,1.0);}',
    uniforms:{zoom:2,tint:[1,0,0]},attributes:[{name:'cell',size:3},{name:'corner',size:1}],varyings:[{name:'shade',size:4,interpolation:'flat'}]};
  const land=(revision,material={shader:'exact'})=>({format:'f32le-p3-uv2-rgba4-attr-u32-v1',vertex_count:3,index_count:3,revision,material,texture:'texture://ground',...bytes});
  const specs=new Map([['texture://ground',{kind:'texture2d'}]]),world={shader_materials:{exact},time_seconds:2,frame:120};
  renderer.draw({land:land(1)},{},specs,world);renderer.viewport(10,0,640,480);
  const drawn=scene.children[0],geometry=drawn.geometry,material=drawn.material;
  assert.equal(geometry.attributes.position.data.stride,13);
  assert.deepEqual(['cell','corner'].map(n=>[geometry.attributes[n].itemSize,geometry.attributes[n].offset]),[[3,9],[1,12]]);
  assert.equal(geometry.attributes.corner.getX(2),42);
  assert.ok(material.isShaderMaterial&&material.vertexColors);
  for(const line of ['attribute vec3 cell;','attribute float corner;','flat varying vec4 shade;','uniform float zoom;','uniform vec4 unone_viewport;'])
    assert.ok(material.vertexShader.includes(line),line);
  assert.ok(material.fragmentShader.includes('flat varying vec4 shade;')&&!material.fragmentShader.includes('attribute'));
  assert.equal(material.uniforms.unone_texture.value.isTexture,true);assert.notEqual(material.uniforms.unone_texture.value,loaded.texture,'sampler state lives on a variant');
  assert.deepEqual([material.uniforms.unone_time.value,material.uniforms.unone_frame.value,material.uniforms.unone_viewport.value],[2,120,[10,0,640,480]]);
  assert.equal(material.uniforms.unone_alpha_cutoff.value,-1,'only cutout materials discard');
  // A left-handed camera mirrors the host's world root; game matrices undo it.
  assert.ok(material.vertexShader.includes('#define unone_view (viewMatrix*unone_handedness)')&&material.vertexShader.includes('unone_model=unone_handedness*modelMatrix'));
  assert.equal(material.uniforms.unone_handedness.value.elements[10],1);
  renderer.draw({land:land(1)},{},specs,{...world,camera3d:{handedness:'left'}});
  assert.equal(material.uniforms.unone_handedness.value.elements[10],-1);
  // Uniform values follow the world each frame; an unchanged program never rebuilds.
  renderer.draw({land:land(1)},{},specs,{...world,shader_materials:{exact:{...exact,uniforms:{zoom:3,tint:[0,1,0]}}}});
  assert.equal(scene.children[0],drawn);assert.deepEqual([material.uniforms.zoom.value,material.uniforms.tint.value],[3,[0,1,0]]);
  renderer.draw({land:land(2)},{},specs,world);
  assert.equal(renderer.metrics().geometry3d_updates,1,'new bytes of the same shape upload in place');
  renderer.draw({land:land(2)},{},specs,{shader_materials:{exact:{...exact,fragment:'vec4 unoneShade(vec2 uv, vec4 color){return color;}'}}});
  assert.notEqual(scene.children[0],drawn,'a new program rebuilds the mesh');
  assert.throws(()=>renderer.draw({land:land(3,{shader:'missing'})},{},specs,world),/SHADER_MATERIAL_UNKNOWN/);
  const plain={...exact,attributes:[]};
  assert.throws(()=>renderer.draw({land:land(3)},{},specs,{shader_materials:{exact:plain}}),/GEOMETRY3D_INVALID: byte counts/);
});
