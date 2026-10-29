import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTextureCachePolicy} from './texture-cache-policy.js';
import {createThreeRenderer} from './three.js';
import {createProjectedFrameDecoder} from '../shared/projected-frame.mjs';

// Exercise the production closures, not a copied lifetime implementation.
const source=await readFile(new URL('./three.js',import.meta.url),'utf8');
function section(start,end){
  const at=source.indexOf(start),until=source.indexOf(end,at+start.length);
  assert(at>=0&&until>at,`production function markers: ${start}`);
  return source.slice(at,until);
}
const functions=[section('  function textureFor(', '  function recordFor('),
  section('  function meshAssetFor(', '  function draw('),
  section('  function clearTextures(', '  function dispose(')].join('\n');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(policy={max_bytes:16,max_entries:1,idle_frames:2}){
  const textureRecords=new Map(),meshAssets=new Map(),records=new Map(),meshes3d=new Map();
  const textureCache=createTextureCachePolicy(textureRecords,policy),loads=[],fetches=[],allocated=[];
  const disposable=kind=>{const result={kind,disposed:0,dispose(){this.disposed++;}};allocated.push(result);return result;};
  const THREE={TextureLoader:class {load(url,resolve,_progress,reject){loads.push({url,resolve,reject});}},
    MeshBasicMaterial:class {constructor(value){Object.assign(this,value);Object.assign(this,disposable('material'));}},DoubleSide:2};
  const environment={textureRecords,textureCache,meshAssets,records,meshes3d,THREE,
    options:{loadAssetUrl:async asset=>asset.id},configureTexture:(_three,texture)=>texture,
    fetch:async url=>{const data=deferred();fetches.push({url,...data});return {ok:true,json:()=>data.promise};},
    validateMesh:raw=>raw,meshGeometry:()=>disposable('geometry'),frameProfile:null,
    startupPresentation:null,frameDecoder:createProjectedFrameDecoder(),frameDraws:null,shaderMaterials:{clear(){}},instances:{clear(){}},
    projected:{clear(){}},heightfields:{clear(){}},scene:{remove(){}}};
  const api=new Function(...Object.keys(environment),`${functions}\nreturn {textureFor,meshAssetFor,clearTextures};`)(...Object.values(environment));
  const texture=id=>({id,image:{width:2,height:2},generateMipmaps:false,disposed:0,dispose(){this.disposed++;}});
  return {...api,textureRecords,textureCache,meshAssets,records,meshes3d,loads,fetches,allocated,texture};
}
const asset={id:'atlas',kind:'texture2d',source:'atlas.png'};
const specs=new Map([['mesh',{id:'mesh',kind:'mesh3d',source:'actor.mesh.json'}],['atlas',asset]]);

test('direct production constructor rejects malformed cache policy before any browser/GPU dependency',async()=>{
  for(const textureCache of [null,{}, {max_bytes:0,max_entries:1,idle_frames:1}])
    await assert.rejects(()=>createThreeRenderer(null,{textureCache}),/TEXTURE_CACHE_INVALID/);
});

test('real textureFor deduplicates sprite owners and protects current-frame pressure',async()=>{
  const f=fixture();f.textureCache.begin();
  const a=f.textureFor(asset,'sprite'),b=f.textureFor(asset,'sprite');assert.equal(a,b);
  await flush();assert.equal(f.loads.length,1);const texture=f.texture('atlas');f.loads[0].resolve(texture);await a.promise;
  f.textureFor({id:'other'},'sprite');f.textureCache.sweep();
  assert.equal(texture.disposed,0);assert.equal(f.textureCache.metrics().pressure_entries,1);
});

test('real textureFor promotes shared sprite texture to persistent non-sprite dependency',async()=>{
  const f=fixture();f.textureCache.begin();const a=f.textureFor(asset,'sprite');await flush();
  const texture=f.texture('atlas');f.loads[0].resolve(texture);await a.promise;
  assert.equal(f.textureFor(asset),a);assert.equal(a.persistent,true);
  for(let i=0;i<4;i++){f.textureCache.begin();f.textureCache.sweep();}
  assert.equal(texture.disposed,0);assert.equal(f.textureCache.metrics().pinned_bytes_estimate,16);
});

test('real textureFor discards late pending completion after eviction without replacing newer generation',async()=>{
  const f=fixture();f.textureCache.begin();const old=f.textureFor(asset,'sprite');await flush();
  for(let i=0;i<2;i++){f.textureCache.begin();f.textureCache.sweep();}
  const newer=f.textureFor(asset,'sprite');await flush();assert.notEqual(old,newer);
  const oldTexture=f.texture('old'),newTexture=f.texture('new');
  f.loads[1].resolve(newTexture);await newer.promise;f.loads[0].resolve(oldTexture);await old.promise;
  assert.equal(oldTexture.disposed,1);assert.equal(newTexture.disposed,0);
  assert.equal(f.textureRecords.get('atlas'),newer);assert.equal(newer.texture,newTexture);
});

test('real clearTextures detaches materials, clears ready entries and rejects late pending texture completion',async()=>{
  const f=fixture();f.textureCache.begin();const ready=f.textureFor(asset,'sprite');await flush();
  const texture=f.texture('ready');f.loads[0].resolve(texture);await ready.promise;
  const material={map:texture},record={material,mesh:{material:{shader:true}}};f.records.set('hero',record);
  const pending=f.textureFor({id:'pending'},'sprite');await flush();f.clearTextures();f.clearTextures();
  assert.equal(texture.disposed,1);assert.equal(material.map,null);assert.equal(record.mesh.material,material);
  const late=f.texture('late');f.loads[1].resolve(late);await pending.promise;
  assert.equal(late.disposed,1);assert.equal(f.textureRecords.size,0);
});

test('real clearTextures must not let an earlier pending mesh resurrect persistent textures or geometry',async()=>{
  const f=fixture();const mesh=f.meshAssetFor('mesh',specs);await flush();assert.equal(f.fetches.length,1);
  f.clearTextures();f.fetches[0].resolve({texture:'atlas'});await flush();
  for(const load of f.loads)load.resolve(f.texture('late-mesh'));
  await mesh.promise;
  assert.equal(f.textureRecords.size,0,'a cleared mesh fetch must not create a fresh persistent texture');
  assert.equal(f.allocated.length,0,'a cleared mesh must not allocate unreachable geometry/material');
});

test('real clearTextures must cancel a mesh already waiting for its shared texture',async()=>{
  const f=fixture();const mesh=f.meshAssetFor('mesh',specs);await flush();
  f.fetches[0].resolve({texture:'atlas'});await flush();assert.equal(f.loads.length,1);
  f.clearTextures();const late=f.texture('late');f.loads[0].resolve(late);await mesh.promise;
  assert.equal(late.disposed,1);assert.equal(f.textureRecords.size,0);
  assert.equal(f.allocated.length,0,'stale mesh must not allocate after its texture was discarded');
});

test('real mesh owner reuses a sprite texture and normal clear releases every resource once',async()=>{
  const f=fixture();f.textureCache.begin();const sprite=f.textureFor(asset,'sprite');await flush();
  const texture=f.texture('shared');f.loads[0].resolve(texture);await sprite.promise;
  const mesh=f.meshAssetFor('mesh',specs);await flush();f.fetches[0].resolve({texture:'atlas'});await mesh.promise;
  assert.equal(f.loads.length,1);assert.equal(sprite.persistent,true);assert.equal(mesh.material.map,texture);
  assert.equal(f.meshAssetFor('mesh',specs),mesh);f.textureCache.begin();f.textureCache.sweep();
  assert.equal(texture.disposed,0);const {geometry,material}=mesh;f.clearTextures();f.clearTextures();
  assert.equal(texture.disposed,1);assert.equal(geometry.disposed,1);assert.equal(material.disposed,1);
});

test('production hidden sprite path detaches maps before sweep',()=>{
  const hidden=section('    for (const [id, record] of records) {','    shaderMaterials.retain(');
  const visible={mesh:{visible:true},material:{map:{id:'shared'}}};
  const hiddenRecord={mesh:{visible:true},material:{map:{id:'idle'}}};
  new Function('records','alive','world',hidden)(new Map([['visible',visible],['hidden',hiddenRecord]]),new Set(['visible']),{entities:{hidden:{sprite:{}}}});
  assert.equal(visible.mesh.visible,true);assert.equal(visible.material.map.id,'shared');
  assert.equal(hiddenRecord.mesh.visible,false);assert.equal(hiddenRecord.material.map,null);
  assert(source.indexOf(hidden)<source.indexOf('    textureCache.sweep();'));
});
