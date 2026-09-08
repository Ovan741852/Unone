import test from 'node:test';
import * as THREE from '../vendor/three/three.player.min.js';
import assert from 'node:assert/strict';
import {instanceView,createInstanceRenderer,partitionInstances} from './instances3d.js';
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
 class Object3D{constructor(){this.position=vector();this.quaternion=vector();this.scale=vector();}updateMatrix(){const e=new Array(16).fill(0);e[0]=e[5]=e[10]=e[15]=1;[e[12],e[13],e[14]]=this.position.values;this.matrix={elements:e};}}
 class InstancedMesh{constructor(){this.instanceMatrix={setUsage(){}};}setMatrixAt(){uploads++;}computeBoundingSphere(){}dispose(){}}
 const memory=new WebAssembly.Memory({initial:1}),batch={asset:'mesh://unit',count:1,format:'f32le-p3-q4-s3-v1',memory:{offset:64,byte_length:40,revision:'1'}};
 const renderer=createInstanceRenderer({Object3D,InstancedMesh,DynamicDrawUsage:1},{add(){},remove(){}},()=>({geometry:new THREE.BoxGeometry(1,1,1),material:{}}),()=>memory.buffer);
 renderer.draw({units:batch},{});renderer.draw({units:batch},{});assert.equal(uploads,1);
 memory.grow(1);renderer.draw({units:{...batch,memory:{...batch.memory,revision:'2'}}},{});assert.equal(uploads,2);
});

test('spatial partition preserves every instance across negative and vertical cell boundaries',()=>{
 const view=new DataView(new ArrayBuffer(5*40));
 for(const [i,p]of [[0,[-.1,0,0]],[1,[0,0,0]],[2,[63,0,0]],[3,[64,0,0]],[4,[0,64,0]]])p.forEach((v,j)=>view.setFloat32(i*40+j*4,v,true));
 const cells=partitionInstances(view,5);
 assert.deepEqual([...cells.values()].flat().sort(),[0,1,2,3,4]);
 assert.deepEqual(cells.get('0,0,0'),[1,2]);assert.deepEqual(cells.get('-1,0,0'),[0]);assert.deepEqual(cells.get('0,1,0'),[4]);
 view.setFloat32(0,130,true);assert.deepEqual(partitionInstances(view,5).get('2,0,0'),[0]);
});
