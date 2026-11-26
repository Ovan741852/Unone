import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTextureCachePolicy} from './texture-cache-policy.js';
import {createThreeRenderer} from './three.js';
import {createProjectedFrameDecoder} from '../shared/projected-frame.mjs';
import {configureTexture as configureSharedTexture} from './presentation3d.js';
import * as ThreeCore from '../vendor/three/three.core.js';
import {createGeometry3DRenderer} from './geometry3d.js';
import {createWorldCurvature} from './world-curvature.js';
import {createDataTextures} from './data-textures.js';

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
function fixture(policy={max_bytes:16,max_entries:1,idle_frames:2},imageAssets=null){
  const textureRecords=new Map(),meshAssets=new Map(),records=new Map(),meshes3d=new Map();
  const textureCache=createTextureCachePolicy(textureRecords,policy),loads=[],fetches=[],allocated=[];
  const disposable=kind=>{const result={kind,disposed:0,dispose(){this.disposed++;}};allocated.push(result);return result;};
  const THREE={TextureLoader:class {load(url,resolve,_progress,reject){loads.push({url,resolve,reject});}},
    Texture:class extends ThreeCore.Texture {constructor(image){super(image);this.disposed=0;allocated.push(this);}dispose(){this.disposed++;super.dispose();}},SRGBColorSpace:'srgb',NearestFilter:'nearest',ClampToEdgeWrapping:'clamp',
    MeshBasicMaterial:class {constructor(value){Object.assign(this,value);Object.assign(this,disposable('material'));}},DoubleSide:2};
  const environment={spriteResources:null,ui:null,worldSubmitted:false,uiImageBatchPrefix:{clear(){}},assetRequestPending:false,textureRecords,textureCache,meshAssets,records,dataTextures:{sync(){},clear(){},contextLost(){},metrics:()=>({})},geometry3d:{draw:()=>false,clear(){},contextLost(){},metrics:()=>({})},curvature:{prepare(){},viewport(){},curvature:0},world3d:{scale:{z:1}},bufferSize:{x:1,y:1},drawInRect:(_,draw)=>draw(),lighting:{apply(){},dress(){},metrics:()=>({})},environment:null,meshEntities:{clear(){}},THREE,
    options:{loadAssetUrl:async asset=>asset.id,...(imageAssets?{getImageAssets:()=>imageAssets}:{})},configureTexture:imageAssets?configureSharedTexture:(_three,texture)=>texture,
    fetch:async url=>{const data=deferred();fetches.push({url,...data});return {ok:true,json:()=>data.promise};},
    validateMesh:raw=>raw,meshGeometry:()=>disposable('geometry'),frameProfile:null,
    startupPresentation:null,frameDecoder:createProjectedFrameDecoder(),frameDraws:null,shaderMaterials:{clear(){}},instances:{clear(){}},
    projected:{clear(){}},heightfields:{clear(){}},scene:{remove(){}}};
  const api=new Function(...Object.keys(environment),`${functions}\nreturn {textureFor,meshAssetFor,clearTextures,pending:()=>assetRequestPending};`)(...Object.values(environment));
  const texture=id=>({id,image:{width:2,height:2},generateMipmaps:false,disposed:0,dispose(){this.disposed++;}});
  return {...api,textureRecords,textureCache,meshAssets,records,meshes3d,loads,fetches,allocated,texture};
}
const asset={id:'atlas',kind:'texture2d',source:'atlas.png'};
const specs=new Map([['mesh',{id:'mesh',kind:'mesh3d',source:'actor.mesh.json'}],['atlas',asset]]);

for(const mode of ['broker','loader']){
  test(`world geometry releases rotating base and shader textures under pressure and idle expiry (${mode})`,async()=>{
    const ids=['held',...Array.from({length:32},(_,i)=>'tile'+i)];
    const catalog=new Map(ids.map(id=>[id,{id,kind:'texture2d',source:id+'.png'}]));
    const leases=[],disposed=[],opened=new Set();
    const image=id=>({width:2,height:2,id});
    const broker={acquire(id){
      const lease={state:'ready',image:image(id),id,releases:0,release(){this.releases++;}};
      leases.push(lease);return lease;
    }};
    const f=fixture({max_bytes:48,max_entries:3,idle_frames:3},mode==='broker'?broker:null);
    const scene=new ThreeCore.Scene(),dataTextures=createDataTextures(ThreeCore);
    const geometry=new Function('createGeometry3DRenderer','THREE','world3d','textureFor','options','curvature','dataTextures',
      section('  const geometry3d = createGeometry3DRenderer(', '  // A camera rect')+'\nreturn geometry3d;'
    )(createGeometry3DRenderer,ThreeCore,scene,f.textureFor,{},createWorldCurvature(),dataTextures);
    const mesh={format:'f32le-p3-uv2-rgba4-u32-v1',vertex_count:3,index_count:3,revision:1,
      vertices:Buffer.alloc(108).toString('base64'),indices:Buffer.from([0,0,0,0,1,0,0,0,2,0,0,0]).toString('base64')};
    const held={...mesh,texture:'held'};
    let consumed=0;
    async function frame(meshes,bound='held'){
      const world={shader_materials:{surface:{
        fragment:'vec4 unoneShade(vec2 uv, vec4 color){return color*texture2D(tile,uv);}',
        samplers:{tile:{type:'float',source:{asset:bound}}}
      }}};
      f.textureCache.begin();
      geometry.draw(meshes,{},catalog,world);
      if(mode==='loader'){
        await flush();
        for(const load of f.loads.slice(consumed)){
          const texture=new ThreeCore.Texture(image(load.url));texture.generateMipmaps=false;load.resolve(texture);
        }
        consumed=f.loads.length;
        await flush();
        geometry.draw(meshes,{},catalog,world);
      }
      for(const [id,record] of f.textureRecords){
        if(!opened.has(id)){
          opened.add(id);record.texture.addEventListener('dispose',()=>disposed.push(id));
        }
      }
      f.textureCache.sweep();
    }
    for(let i=0;i<32;i++){
      const tile='tile'+i;
      // Even frames use the mesh's base image, odd frames a shader sampler.
      const rotating=i%2?{...mesh,material:{shader:'surface'}}:{...mesh,texture:tile};
      await frame({held,rotating},tile);
      assert.ok(scene.children.every(child=>child.visible));
      assert.ok(f.textureRecords.has(tile)&&f.textureRecords.has('held'));
      assert.ok(!disposed.includes('held')&&!disposed.includes(tile));
    }
    const snapshot=()=>({resident:f.textureRecords.size,disposed:disposed.length,
      released:leases.reduce((n,lease)=>n+lease.releases,0)});
    const afterRotation=snapshot();
    for(let i=0;i<3;i++)await frame({held});
    const afterIdle=snapshot();
    assert.deepEqual({afterRotation,afterIdle},{
      afterRotation:{resident:3,disposed:30,released:mode==='broker'?30:0},
      afterIdle:{resident:1,disposed:32,released:mode==='broker'?32:0}
    });
    assert.deepEqual([...f.textureRecords.keys()],['held']);
    assert.equal(mode==='broker'?leases.length:f.loads.length,33);
    for(let i=0;i<3;i++)await frame({});
    geometry.clear();dataTextures.clear();f.clearTextures();f.clearTextures();
    assert.deepEqual(disposed.sort(),ids.sort());
    assert.ok(leases.every(lease=>lease.releases===1));
  });
}

test('direct production constructor rejects malformed cache policy before any browser/GPU dependency',async()=>{
  for(const textureCache of [null,{}, {max_bytes:0,max_entries:1,idle_frames:1}])
    await assert.rejects(()=>createThreeRenderer(null,{textureCache}),/TEXTURE_CACHE_INVALID/);
  for(const getImageAssets of [null,{},true])await assert.rejects(()=>createThreeRenderer(null,{getImageAssets}),/IMAGE_ASSET_PROVIDER_INVALID/);
});

test('real textureFor deduplicates sprite owners and protects current-frame pressure',async()=>{
  const f=fixture();f.textureCache.begin();
  const a=f.textureFor(asset,'frame'),b=f.textureFor(asset,'frame');assert.equal(a,b);
  await flush();assert.equal(f.loads.length,1);const texture=f.texture('atlas');f.loads[0].resolve(texture);await a.promise;
  f.textureFor({id:'other'},'frame');f.textureCache.sweep();
  assert.equal(texture.disposed,0);assert.equal(f.textureCache.metrics().pressure_entries,1);
});

test('real textureFor promotes shared sprite texture to persistent non-sprite dependency',async()=>{
  const f=fixture();f.textureCache.begin();const a=f.textureFor(asset,'frame');await flush();
  const texture=f.texture('atlas');f.loads[0].resolve(texture);await a.promise;
  assert.equal(f.textureFor(asset),a);assert.equal(a.persistent,true);
  for(let i=0;i<4;i++){f.textureCache.begin();f.textureCache.sweep();}
  assert.equal(texture.disposed,0);assert.equal(f.textureCache.metrics().pinned_bytes_estimate,16);
});

test('real textureFor discards late pending completion after eviction without replacing newer generation',async()=>{
  const f=fixture();f.textureCache.begin();const old=f.textureFor(asset,'frame');await flush();
  for(let i=0;i<2;i++){f.textureCache.begin();f.textureCache.sweep();}
  const newer=f.textureFor(asset,'frame');await flush();assert.notEqual(old,newer);
  const oldTexture=f.texture('old'),newTexture=f.texture('new');
  f.loads[1].resolve(newTexture);await newer.promise;f.loads[0].resolve(oldTexture);await old.promise;
  assert.equal(oldTexture.disposed,1);assert.equal(newTexture.disposed,0);
  assert.equal(f.textureRecords.get('atlas'),newer);assert.equal(newer.texture,newTexture);
});

test('real clearTextures detaches materials, clears ready entries and rejects late pending texture completion',async()=>{
  const f=fixture();f.textureCache.begin();const ready=f.textureFor(asset,'frame');await flush();
  const texture=f.texture('ready');f.loads[0].resolve(texture);await ready.promise;
  const material={map:texture},record={material,mesh:{material:{shader:true}}};f.records.set('hero',record);
  const pending=f.textureFor({id:'pending'},'frame');await flush();f.clearTextures();f.clearTextures();
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
  const f=fixture();f.textureCache.begin();const sprite=f.textureFor(asset,'frame');await flush();
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
test('shared decoded ready image creates the local sampler synchronously without a pending frame or second loader',()=>{
 let acquired=0,released=0,closed=0;const image={width:2,height:2,close(){closed++;}},lease={state:'ready',image,error:null,promise:Promise.resolve(image),release(){released++;}};
 const f=fixture(undefined,{acquire(id){assert.equal(id,'atlas');acquired++;return lease;}});f.textureCache.begin();const r=f.textureFor(asset,'frame');
 assert.equal(r.state,'ready');assert.equal(f.pending(),false);assert.equal(r.texture.image,image);assert.equal(f.loads.length,0);assert.equal(acquired,1);
 assert.equal(r.texture.colorSpace,'srgb');assert.equal(r.texture.magFilter,'nearest');assert.equal(r.texture.flipY,true);assert.equal(r.texture.generateMipmaps,false);
 assert.equal(f.textureFor(asset),r);assert.equal(acquired,1);const texture=r.texture;f.clearTextures();f.clearTextures();assert.equal(texture.disposed,1);assert.equal(released,1);assert.equal(closed,0);
});
test('shared pending generation releases on eviction and never adopts a late image into its replacement',async()=>{
 const leases=[];let closed=0;const broker={acquire(){const wait=deferred(),state={state:'loading',image:null,released:0};const lease={get state(){return state.released?'error':state.state;},get image(){return state.released?null:state.image;},error:null,promise:wait.promise,release(){state.released++;}};leases.push({state,wait,lease});return lease;}};
 const f=fixture(undefined,broker);f.textureCache.begin();const old=f.textureFor(asset,'frame');assert.equal(f.pending(),true);
 for(let i=0;i<2;i++){f.textureCache.begin();f.textureCache.sweep();}assert.equal(leases[0].state.released,1);const newer=f.textureFor(asset,'frame');
 const image={width:2,height:2,close(){closed++;}};leases[1].state.image=image;leases[1].state.state='ready';leases[1].wait.resolve(image);await newer.promise;
 leases[0].state.image=image;leases[0].state.state='ready';leases[0].wait.resolve(image);await old.promise;
 assert.equal(f.textureRecords.get('atlas'),newer);assert.equal(newer.state,'ready');assert.equal(f.allocated.length,1,'late retired lease cannot allocate a GPU texture');assert.equal(closed,0);f.clearTextures();assert.equal(leases[1].state.released,1);
});
test('shared acquisition and decoded-image failures remain explicit and release only the failed owner',async()=>{
 const error=Error('missing decoded asset'),f=fixture(undefined,{acquire(){throw error;}});const r=f.textureFor(asset,'frame');assert.equal(r.state,'error');assert.equal(r.error,error);assert.equal(f.allocated.length,0);f.clearTextures();
 let released=0;const bad=fixture(undefined,{acquire(){return{state:'error',image:null,error,promise:Promise.reject(error),release(){released++;}};}}),failed=bad.textureFor(asset,'frame');assert.equal(failed.state,'error');await failed.promise;bad.clearTextures();assert.equal(released,1);
});
