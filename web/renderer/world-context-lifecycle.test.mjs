import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from '../vendor/three/three.player.min.js';
import {createRasterCapability} from './projected-raster-capability.js';
import {createTextureCachePolicy} from './texture-cache-policy.js';
const source=await readFile(new URL('./three.js',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(`  function ${start}(`),source.indexOf(end,source.indexOf(`  function ${start}(`)));
test('actual disabled-particle export stub implements the ordinary world owner lifecycle without GPU work',async()=>{
 const exporter=await readFile(new URL('../../crates/unone-cli/src/export.rs',import.meta.url),'utf8'),line=exporter.split('\n').find(line=>line.includes('"const createParticleRenderer = () =>'));
 assert.ok(line,'official exporter particle stub');const declaration=JSON.parse(line.trim().replace(/,$/,'')),disabled=new Function(`${declaration}\nreturn createParticleRenderer();`)();
 assert.equal(typeof disabled.contextLost,'function');assert.doesNotThrow(()=>disabled.contextLost(()=>{throw Error('disabled owner cannot own GPU resources');}));
 const context={particles:disabled};vm.createContext(context);vm.runInContext('particles.contextLost(()=>{throw Error("unreachable")});',context);
});
test('ordinary world loss retires unique engine GPU bindings once per epoch while retaining CPU ownership',()=>{
 const geometry=new THREE.PlaneGeometry(),base=new THREE.MeshBasicMaterial(),assetGeometry=new THREE.BoxGeometry(),assetMaterial=new THREE.MeshBasicMaterial(),texture=new THREE.DataTexture(new Uint8Array([255,0,0,255]),1,1);
 const primitive=new THREE.Mesh(new THREE.SphereGeometry(),new THREE.MeshNormalMaterial());primitive.userData.asset='mesh://primitive/sphere';
 const shader=new THREE.ShaderMaterial(),instance=new THREE.InstancedMesh(assetGeometry,assetMaterial,1),particleGeometry=new THREE.PlaneGeometry(),particleMaterial=new THREE.MeshBasicMaterial(),particleTexture=new THREE.DataTexture(),particleMesh=new THREE.InstancedMesh(particleGeometry,particleMaterial,1),terrainGeometry=new THREE.PlaneGeometry(),terrainMaterial=new THREE.MeshBasicMaterial(),bloomGeometry=new THREE.PlaneGeometry(),bloomMaterial=new THREE.ShaderMaterial(),bloomTarget=new THREE.WebGLRenderTarget();
 const geometries=[geometry,assetGeometry,primitive.geometry,particleGeometry,terrainGeometry,bloomGeometry],arrays=geometries.map(g=>g.attributes.position.array),matrices=[instance.instanceMatrix.array,particleMesh.instanceMatrix.array];
 const owned=[...geometries,base,assetMaterial,primitive.material,texture,shader,instance,particleMaterial,particleTexture,particleMesh,terrainMaterial,bloomMaterial,bloomTarget],disposes=new Map(owned.map(o=>[o,0]));
 let lost=false;const bind=()=>{for(const object of owned){function onDispose(){assert.equal(lost,true,'GPU bindings retire before restore');object.removeEventListener('dispose',onDispose);disposes.set(object,disposes.get(object)+1);}object.addEventListener('dispose',onDispose);}};
 let leaseReleases=0;const capability=createRasterCapability({policy:{requested:'host'}}),records=new Map([['sprite',{material:base}]]),meshAssets=new Map([['asset',{geometry:assetGeometry,material:assetMaterial}]]),textureRecords=new Map([['texture',{texture,state:'ready',imageLease:{release(){leaseReleases++;}}}]]);
 const hook=objects=>({contextLost(retire){for(const value of objects)retire(value);}}),noop=()=>{};
 const context={ui:null,worldSubmitted:false,geometry,records,meshAssets,textureRecords,meshEntities:hook([primitive.geometry,primitive.material]),
  shaderMaterials:hook([shader,texture]),instances:hook([instance]),particles:hook([particleGeometry,particleMaterial,particleTexture,particleMesh]),heightfields:hook([terrainGeometry,terrainMaterial]),bloom:hook([bloomGeometry,bloomMaterial,bloomTarget]),
  rasterCapability:capability,projected:{clear:noop},uiImageBatchPrefix:{clear:noop},frameDraws:null,framePass:null,rasterPass:null,profile:null};
 vm.createContext(context);vm.runInContext(section('retireWorldGpuBindings','  // Opt-in profiling:')+section('rasterLost','  function rasterAvailable('),context);
 for(let epoch=1;epoch<=3;epoch++){
  bind();for(const object of owned)assert.equal(object._listeners.dispose.length,1);
  lost=true;context.rasterLost();context.rasterLost();for(const object of owned){assert.equal(object._listeners.dispose.length,0);assert.equal(disposes.get(object),epoch);}
  assert.equal(records.size,1);assert.equal(meshAssets.size,1);assert.equal(textureRecords.get('texture').texture,texture);assert.equal(textureRecords.get('texture').state,'ready');geometries.forEach((g,i)=>assert.equal(g.attributes.position.array,arrays[i]));assert.equal(instance.instanceMatrix.array,matrices[0]);assert.equal(particleMesh.instanceMatrix.array,matrices[1]);
  lost=false;context.rasterRestored();context.rasterRestored();
 }
 assert.equal(leaseReleases,0,'context restore retains the decoded CPU image lease');createTextureCachePolicy(textureRecords,undefined).clear();assert.equal(leaseReleases,1,'final GPU owner retirement releases its image lease');
});
