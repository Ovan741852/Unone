import test from 'node:test';
import assert from 'node:assert/strict';
import {instanceView,createInstanceRenderer} from './instances3d.js';
test('binary instance view matches JSON bytes and rebinds after memory growth',()=>{
 const bytes=new Uint8Array(40);new DataView(bytes.buffer).setFloat32(0,12.5,true);
 const memory=new WebAssembly.Memory({initial:1});new Uint8Array(memory.buffer).set(bytes,64);
 const batch={count:1,memory:{offset:64,byte_length:40,revision:'1'}};
 const binary=instanceView(batch,()=>memory.buffer),json=instanceView({count:1,data:Buffer.from(bytes).toString('base64')});
 assert.equal(binary.getFloat32(0,true),json.getFloat32(0,true));assert.equal(binary.buffer,memory.buffer);
 memory.grow(1);assert.equal(instanceView(batch,()=>memory.buffer).getFloat32(0,true),12.5);
 assert.throws(()=>instanceView({...batch,memory:{...batch.memory,offset:memory.buffer.byteLength}},()=>memory.buffer),/INSTANCE_MEMORY_INVALID/);
 assert.throws(()=>instanceView(batch),/INSTANCE_MEMORY_INVALID/);
});
test('GPU updates depend on revision, including a reused pointer',()=>{
 let uploads=0;const vector=()=>({set(...v){this.values=v;}});
 class Object3D{constructor(){this.position=vector();this.quaternion=vector();this.scale=vector();}updateMatrix(){this.matrix=this.position.values;}}
 class InstancedMesh{constructor(){this.instanceMatrix={setUsage(){}};}setMatrixAt(){uploads++;}dispose(){}}
 const memory=new WebAssembly.Memory({initial:1}),batch={asset:'mesh://unit',count:1,format:'f32le-p3-q4-s3-v1',memory:{offset:64,byte_length:40,revision:'1'}};
 const renderer=createInstanceRenderer({Object3D,InstancedMesh,DynamicDrawUsage:1},{add(){},remove(){}},()=>({geometry:{},material:{}}),()=>memory.buffer);
 renderer.draw({units:batch},{});renderer.draw({units:batch},{});assert.equal(uploads,1);
 memory.grow(1);renderer.draw({units:{...batch,memory:{...batch.memory,revision:'2'}}},{});assert.equal(uploads,2);
});
