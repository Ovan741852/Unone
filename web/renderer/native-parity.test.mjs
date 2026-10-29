// CPU contract comparisons, not a claim of identical GPU output.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import * as THREE from '../vendor/three/three.core.js';
import {meshGeometry} from './mesh.js';
import {createInstanceRenderer} from './instances3d.js';
import {createThreeRenderer} from './three.js';

const native=file=>readFileSync(new URL('../../crates/unone-native-player/src/'+file,import.meta.url),'utf8');
const near=(a,b,epsilon=2e-6)=>assert.ok(Math.abs(a-b)<=epsilon,`${a} != ${b}`);
const vectorNear=(a,b)=>a.forEach((v,i)=>near(v,b[i]));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

// Independent transcription of render.wgsl vs(), not Three math.
function nativeTransform(p,t,q,s) {
  const local=p.map((v,i)=>v*s[i]),xyz=q.slice(0,3);
  const c=cross(xyz,local).map((v,i)=>v+q[3]*local[i]);
  return cross(xyz,c).map((v,i)=>local[i]+2*v+t[i]);
}

function batchFor(t,q,s,revision) {
  const bytes=new Uint8Array(40),view=new DataView(bytes.buffer);
  [...t,...q,...s].forEach((value,i)=>view.setFloat32(i*4,value,true));
  return {asset:'mesh://test',format:'f32le-p3-q4-s3-v1',count:1,
    data:Buffer.from(bytes).toString('base64'),presentation_revision:revision};
}

test('native WGSL quaternion and Three packed-instance transforms preserve handedness',()=>{
  assert.ok(native('render.wgsl').includes('local+2.*cross(q.xyz,cross(q.xyz,local)+q.w*local)+translation'));
  const geometry=new THREE.BoxGeometry(2,3,4),material=new THREE.MeshBasicMaterial();
  const scene=new THREE.Scene(),renderer=createInstanceRenderer(THREE,scene,()=>({geometry,material}));
  let revision=0;
  for(const yaw of [0,Math.PI/4,Math.PI/2,Math.PI,3*Math.PI/2]) {
    for(const pitch of [-0.7,0,0.6]) {
      const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch,yaw,0,'YXZ')).toArray().map(Math.fround);
      const t=[4,-2,8],s=[0.35,0.35,0.35];
      const batch=batchFor(t,q,s,++revision);
      renderer.draw({test:batch},new Map());
      const mesh=scene.children[0],matrix=new THREE.Matrix4();mesh.getMatrixAt(0,matrix);
      const packed=Buffer.from(batch.data,'base64');
      const values=Array.from({length:10},(_,i)=>packed.readFloatLE(i*4));
      for(const p of [[1,0,0],[0,1,0],[0,0,1],[-1,2,0]]) {
        vectorNear(new THREE.Vector3(...p).applyMatrix4(matrix).toArray(),
          nativeTransform(p,values.slice(0,3),values.slice(3,7),values.slice(7,10)));
      }
    }
  }
  renderer.clear();geometry.dispose();material.dispose();
});

// Four asymmetric RGBA pixels: top-left red, top-right green,
// bottom-left blue, bottom-right yellow. A real PNG exercises image row order.
function pngPixels() {
  const png=readFileSync(new URL('./fixtures/uv-corners.png',import.meta.url));
  assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  const idat=[];let width=0,height=0;
  for(let p=8;p<png.length;) {
    const size=png.readUInt32BE(p),type=png.toString('ascii',p+4,p+8),body=png.subarray(p+8,p+8+size);
    if(type==='IHDR'){width=body.readUInt32BE(0);height=body.readUInt32BE(4);assert.equal(body[8],8);assert.equal(body[9],6);}
    if(type==='IDAT')idat.push(body);p+=size+12;
  }
  assert.deepEqual([width,height],[2,2]);
  const rows=inflateSync(Buffer.concat(idat));assert.equal(rows[0],0);assert.equal(rows[9],0);
  return [...rows.subarray(1,9),...rows.subarray(10,18)];
}

test('static mesh UV plus TextureLoader flipY matches native 1-v for asymmetric PNG',()=>{
  assert.ok(native('render.rs').includes('uvs[i * 2], 1. - uvs[i * 2 + 1]'));
  const pixels=pngPixels(),texture=new THREE.Texture();
  const mesh={version:1,positions:[-1,-1,0,1,-1,0,-1,1,0,1,1,0],
    uvs:[0.25,0.25,0.75,0.25,0.25,0.75,0.75,0.75],indices:[0,1,2,1,3,2],texture:'texture://test'};
  const geometry=meshGeometry(THREE,mesh),uv=geometry.getAttribute('uv');
  const sample=(u,v)=>pixels.slice((Math.floor(v*2)*2+Math.floor(u*2))*4,(Math.floor(v*2)*2+Math.floor(u*2))*4+4);
  const colors=[];
  for(let i=0;i<uv.count;i++) {
    const web=texture.transformUv(new THREE.Vector2(uv.getX(i),uv.getY(i)));
    const expected=[mesh.uvs[i*2],1-mesh.uvs[i*2+1]];
    vectorNear(web.toArray(),expected);colors.push(sample(web.x,web.y));
    assert.deepEqual(sample(web.x,web.y),sample(...expected));
  }
  assert.deepEqual(colors,[[0,0,255,255],[255,255,0,255],[255,0,0,255],[0,255,0,255]]);
  geometry.dispose();texture.dispose();
});

function installGlobals() {
  const restore=[];
  for(const [key,value] of Object.entries({window:{devicePixelRatio:1,removeEventListener(){}},navigator:{gpu:{}}})) {
    const descriptor=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
    restore.push(()=>descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key]);
  }
  return ()=>restore.forEach(fn=>fn());
}

async function adapter(t) {
  const restore=installGlobals();
  const core=new URL('../vendor/three/three.core.js',import.meta.url).href;
  const module=`export * from ${JSON.stringify(core)};import {Texture} from ${JSON.stringify(core)};
    export class TextureLoader {load(_url,resolve){resolve(new Texture())}}
    export class WebGPURenderer {constructor(){this.info={reset(){},render:{calls:0,triangles:0},memory:{textures:0}}}
      async init(){}setPixelRatio(){}setClearColor(){}setSize(){}render(){}dispose(){}}`;
  let context;
  const renderer=await createThreeRenderer({clientWidth:640,clientHeight:360,addEventListener(){},removeEventListener(){}},{kind:'three-webgpu',
    threeModuleUrl:'data:text/javascript;base64,'+Buffer.from(module).toString('base64'),
    getAssetManifest:()=>({assets:[{id:'texture://test',kind:'texture2d',source:'fixture.png'}]}),
    loadAssetUrl:async()=>'data:image/png;base64,fixture',beforeRender:value=>{context=value;}});
  const world={entities:{image:{id:'image',transform:{x:0,y:0},sprite:{asset:'texture://test'}}},
    camera3d:{position:{x:3,y:7,z:9},target:{x:-1,y:2,z:0},fov_degrees:46}};
  renderer.draw({world});await renderer.ready();renderer.draw({world});
  t.after(()=>{renderer.dispose();restore();});
  return {context,world};
}

test('official host texture sampling matches native nearest clamp and one mip',async t=>{
  const source=native('render.rs');
  assert.ok(source.includes('mag_filter: wgpu::FilterMode::Nearest'));
  assert.ok(source.includes('min_filter: wgpu::FilterMode::Nearest'));
  const {context}=await adapter(t),texture=context.root.children[0].material.map;
  assert.equal(texture.magFilter,THREE.NearestFilter,'native mag is nearest, not linear');
  assert.equal(texture.minFilter,THREE.NearestFilter,'native has one mip, no mip interpolation');
  assert.equal(texture.generateMipmaps,false,'native uploads one mip');
  assert.equal(texture.wrapS,THREE.ClampToEdgeWrapping);assert.equal(texture.wrapT,THREE.ClampToEdgeWrapping);
  assert.equal(texture.colorSpace,THREE.SRGBColorSpace);assert.equal(texture.flipY,true);
});

test('perspective basis, near/far and projected XYZ match native View',async t=>{
  const source=native('lod.rs');assert.ok(source.includes('norm([-f[2], 0., f[0]])'));
  assert.ok(source.includes('0.1,'));assert.ok(source.includes('10000.'));
  const {context,world}=await adapter(t),camera=context.camera3d;
  assert.equal(camera.near,0.1);assert.equal(camera.far,10000);
  const p=world.camera3d.position,target=world.camera3d.target;
  const f=new THREE.Vector3(target.x-p.x,target.y-p.y,target.z-p.z).normalize();
  const r=new THREE.Vector3(-f.z,0,f.x).normalize(),u=new THREE.Vector3().crossVectors(r,f);
  const tan=Math.tan(world.camera3d.fov_degrees*Math.PI/360);
  for(const point of [[0,0,0],[1,2,3],[-5,0,7]]) {
    const d=new THREE.Vector3(...point).sub(new THREE.Vector3(p.x,p.y,p.z)),depth=d.dot(f);
    camera.updateMatrixWorld();
    const projected=new THREE.Vector3(...point).project(camera);
    near(projected.x,d.dot(r)/(tan*camera.aspect*depth));near(projected.y,d.dot(u)/(tan*depth));
    // GL depth -1..1 converts to native WebGPU 0..1; perspective XY is unchanged.
    near((projected.z+1)/2,10000/(10000-0.1)-10000*0.1/((10000-0.1)*depth));
  }
});
