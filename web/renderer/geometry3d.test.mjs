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
  const renderer=createGeometry3DRenderer(THREE,scene,{textureFor:()=>loaded});
  const specs=new Map([['texture://ground',{kind:'texture2d'}]]);
  assert.equal(renderer.draw({plain:mesh(1),ground:mesh(2,{texture:'texture://ground',material:{filter:'nearest',blend:'cutout'}})},{},specs),true,'a loading texture is pending');
  const plain=scene.children.find(o=>o.material&&!o.material.alphaTest),ground=scene.children.find(o=>o.material.alphaTest===.5);
  assert.equal(plain.visible,true);assert.equal(ground.visible,false,'textured meshes wait for their image');
  assert.equal(plain.geometry.attributes.color.itemSize,4);assert.equal(plain.geometry.index.count,3);
  loaded.state='ready';
  const moved={...placement,position:{x:5,y:0,z:0}};
  assert.equal(renderer.draw({plain:mesh(1),ground:mesh(2,{texture:'texture://ground',material:{filter:'nearest',blend:'cutout'}})},{plain:{transform:moved,visible:false}},specs),false);
  assert.equal(renderer.metrics().geometry3d_rebuilds,2,'placement never rebuilds');
  assert.equal(plain.position.x,5);assert.equal(plain.visible,false);assert.equal(ground.visible,true);
  assert.equal(ground.material.map.magFilter,THREE.NearestFilter);assert.notEqual(ground.material.map,loaded.texture,'sampler state lives on a variant');
  renderer.draw({plain:mesh(3,{lift:1})},{},specs);
  assert.equal(renderer.metrics().geometry3d_rebuilds,3);assert.equal(scene.children.length,1,'removed meshes leave the scene');
  renderer.clear();assert.equal(scene.children.length,0);
  assert.throws(()=>renderer.draw({bad:mesh(4,{texture:'texture://missing'})},{},specs),/GEOMETRY3D_TEXTURE_MISSING/);
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
