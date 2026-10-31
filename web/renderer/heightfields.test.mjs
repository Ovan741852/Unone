import test from 'node:test';
import assert from 'node:assert/strict';
import {rejectUnsupportedHeightfields,heightfieldEntries,heightfieldMeshData,createHeightfieldRenderer} from '../shared/heightfields.js';
import * as THREE from '../vendor/three/three.core.js';
import {createThreeRenderer} from './three.js';
import {createWebGpuRenderer} from '../shared/webgpu-snapshot.js';
import {createWorldFieldPublication} from '../shared/world-field-publication.mjs';

test('snapshots without heightfields preserve compatibility without mutation', () => {
  for (const snapshot of [{entities:{}}, {heightfields:{}}, {world:{heightfields:{}}}]) {
    const before=JSON.stringify(snapshot);
    assert.equal(rejectUnsupportedHeightfields(snapshot),undefined);
    assert.equal(JSON.stringify(snapshot),before);
  }
});

test('unsupported backend guard keeps stable code and ids for raw and wrapped snapshots', () => {
  for (const world of [{heightfields:{ground:{width:129}}}, {heightfields:{z:null,a:{}}}]) {
    for (const snapshot of [world,{world}]) {
      const before=JSON.stringify(snapshot);
      assert.throws(()=>rejectUnsupportedHeightfields(snapshot,'three-webgl'), error => {
        assert.equal(error.code,'HEIGHTFIELD_BACKEND_UNSUPPORTED');
        assert.equal(error.facts.backend,'three-webgl');
        assert.deepEqual(error.facts.heightfield_ids,Object.keys(world.heightfields).sort());
        return true;
      });
      assert.equal(JSON.stringify(snapshot),before);
    }
  }
});

test('malformed declared heightfield collections cannot silently bypass the guard', () => {
  for (const heightfields of [[],[{}],'ground',0,false]) {
    assert.throws(()=>rejectUnsupportedHeightfields({heightfields}),/HEIGHTFIELD_BACKEND_UNSUPPORTED/);
  }
});

function globals(t, values) {
  for(const [key,value] of Object.entries(values)) {
    const previous=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
    t.after(()=>previous?Object.defineProperty(globalThis,key,previous):delete globalThis[key]);
  }
}

test('actual Three draw rejects before presentation hooks or renderer resets', async t => {
  const effects=[];
  globals(t,{window:{devicePixelRatio:1,removeEventListener(){}},navigator:{gpu:{}},__heightfieldDrawEffects:effects});
  const core=new URL('../vendor/three/three.core.js',import.meta.url).href;
  const module=`export * from ${JSON.stringify(core)};
  export class WebGPURenderer {
    constructor(){this.info={reset(){globalThis.__heightfieldDrawEffects.push('reset')},render:{},memory:{}}}
    async init(){} setPixelRatio(){} setClearColor(){} dispose(){}
  }`;
  const renderer=await createThreeRenderer({addEventListener(){},removeEventListener(){}}, {kind:'three-webgpu',threeModuleUrl:'data:text/javascript;base64,'+Buffer.from(module).toString('base64'),beforeRender(){effects.push('hook')}});
  try {
    assert.throws(()=>renderer.draw({world:{heightfields:{ground:{}}}}),/HEIGHTFIELD_INVALID/);
    assert.deepEqual(effects,[]);
  } finally { renderer.dispose(); }
});

const field=()=>({width:3,depth:2,heights:[0,1,2,3,4,5],cell_size:2,origin:{x:-4,y:7,z:12},texture:'texture://terrain',revision:1});

test('a leased heightfield map is validated once while it stays published', () => {
  const leased=createWorldFieldPublication(JSON.stringify({ground:field()})).value;
  const entries=heightfieldEntries({world:{heightfields:leased}});
  assert.equal(heightfieldEntries({heightfields:leased}),entries);assert.ok(Object.isFrozen(entries));
  // Caller-owned maps can change in place and are revalidated on every call.
  const plain={ground:field()};assert.notEqual(heightfieldEntries({heightfields:plain}),heightfieldEntries({heightfields:plain}));
  plain.ground.width=1;assert.throws(()=>heightfieldEntries({heightfields:plain}),/HEIGHTFIELD_INVALID/);
});

test('heightfield geometry matches Core X-fast positions, native texture rows and upward fixed diagonal', () => {
  const d=field(),before=JSON.stringify(d),data=heightfieldMeshData(d);
  assert.deepEqual(data.positions,[0,0,0,2,1,0,4,2,0,0,3,2,2,4,2,4,5,2]);
  assert.deepEqual(data.indices,[0,3,1,1,3,4,1,4,2,2,4,5]);
  assert.deepEqual(data.uvs,[0,1,0.5,1,1,1,0,0,0.5,0,1,0]);
  assert.equal(data.texture,d.texture);
  assert.equal(JSON.stringify(d),before);
  for(let i=0;i<data.indices.length;i+=3) {
    const [a,b,c]=data.indices.slice(i,i+3).map(n=>data.positions.slice(n*3,n*3+3));
    const y=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
    assert.ok(y>0,'all triangles face upward');
  }
});

test('snapshot validation accepts flattened revisioned fields and rejects malformed declarations', () => {
  const d=field(),world={heightfields:{ground:d}},before=JSON.stringify(world);
  assert.deepEqual(heightfieldEntries({world}),[['ground',d]]);
  assert.equal(JSON.stringify(world),before);
  for(const change of [{width:1},{depth:513},{heights:[0]},{heights:[0,1,2,3,4,NaN]},
    {cell_size:0},{origin:{x:99999,y:0,z:0}},{texture:''},{revision:0},{revision:9007199254740992}]) {
    assert.throws(()=>heightfieldEntries({heightfields:{ground:{...d,...change}}}),/HEIGHTFIELD_INVALID/);
  }
  assert.throws(()=>heightfieldEntries({heightfields:[]}),/HEIGHTFIELD_INVALID/);
  assert.throws(()=>heightfieldEntries({heightfields:{['中'.repeat(43)]:d}}),/HEIGHTFIELD_INVALID/);
  assert.equal(heightfieldEntries({heightfields:{ground:{...d,revision:'18446744073709551615'}}}).length,1);
});

test('generic Three cache supports set, exact-revision reuse, update, remove and disposal', () => {
  const scene=new THREE.Scene(),texture=new THREE.Texture();
  const state={state:'ready',texture,error:null};
  const cache=createHeightfieldRenderer(THREE,scene,()=>state);
  const specs=new Map([['texture://terrain',{kind:'texture2d'}]]);
  const d=field();
  cache.draw(heightfieldEntries({heightfields:{ground:d}}),specs);
  const mesh=scene.children[0],geometry=mesh.geometry;
  assert.deepEqual(mesh.position.toArray(),[-4,7,12]);
  assert.equal(mesh.material.map,texture);
  cache.draw(heightfieldEntries({heightfields:{ground:d}}),specs);
  assert.equal(scene.children[0].geometry,geometry);
  let disposed=0;geometry.addEventListener('dispose',()=>disposed++);
  cache.draw(heightfieldEntries({heightfields:{ground:{...d,heights:[9,1,2,3,4,5],revision:2}}}),specs);
  assert.equal(disposed,1);
  assert.equal(scene.children[0].geometry.attributes.position.array[1],9);
  assert.deepEqual(cache.metrics(),{heightfields:1,heightfield_triangles:4,heightfield_rebuilds:2});
  state.state='loading';
  cache.draw(heightfieldEntries({heightfields:{ground:{...d,revision:3}}}),specs);
  assert.equal(scene.children[0].visible,false,'never render an untextured misleading surface');
  cache.draw([],specs);
  assert.equal(scene.children.length,0);
  assert.equal(cache.metrics().heightfields,0);
  assert.throws(()=>cache.draw(heightfieldEntries({heightfields:{ground:d}}),new Map()),/HEIGHTFIELD_TEXTURE_MISSING/);
  cache.clear();texture.dispose();
});

test('actual Three adapter requires perspective camera before hooks for valid terrain', async t => {
  const effects=[];
  globals(t,{window:{devicePixelRatio:1,removeEventListener(){}},navigator:{gpu:{}},__heightfieldDrawEffects:effects});
  const core=new URL('../vendor/three/three.core.js',import.meta.url).href;
  const module=`export * from ${JSON.stringify(core)};
    export class WebGPURenderer {constructor(){this.info={reset(){globalThis.__heightfieldDrawEffects.push('reset')},render:{},memory:{}}}async init(){}setPixelRatio(){}setClearColor(){}dispose(){}}`;
  const renderer=await createThreeRenderer({addEventListener(){},removeEventListener(){}}, {kind:'three-webgpu',threeModuleUrl:'data:text/javascript;base64,'+Buffer.from(module).toString('base64'),beforeRender(){effects.push('hook')}});
  try {
    assert.throws(()=>renderer.draw({world:{heightfields:{ground:field()}}}),/HEIGHTFIELD_CAMERA3D_REQUIRED/);
    assert.deepEqual(effects,[]);
  }finally{renderer.dispose();}
});

test('actual Three draw joins asynchronous host texture loading with heightfield lifecycle', async t => {
  globals(t,{window:{devicePixelRatio:1,removeEventListener(){}},navigator:{gpu:{}}});
  const core=new URL('../vendor/three/three.core.js',import.meta.url).href;
  const module=`export * from ${JSON.stringify(core)};import {Texture} from ${JSON.stringify(core)};
    export class TextureLoader {load(_url,resolve){resolve(new Texture())}}
    export class WebGPURenderer {constructor(){this.info={reset(){},render:{calls:0,triangles:0},memory:{textures:0}}}
      async init(){}setPixelRatio(){}setClearColor(){}setSize(){}render(){this.info.render.calls++}dispose(){}}`;
  let context;
  const renderer=await createThreeRenderer({clientWidth:640,clientHeight:360,addEventListener(){},removeEventListener(){}},{kind:'three-webgpu',
    threeModuleUrl:'data:text/javascript;base64,'+Buffer.from(module).toString('base64'),
    getAssetManifest:()=>({assets:[{id:'texture://terrain',kind:'texture2d',source:'terrain.png'}]}),
    loadAssetUrl:async()=>'data:image/png;base64,fixture',beforeRender(value){context=value}});
  const world={entities:{},camera3d:{position:{x:0,y:9,z:12},target:{x:0,y:0,z:0},fov_degrees:46},heightfields:{ground:field()},particles:[]};
  try {
    renderer.draw({world});await renderer.ready();renderer.draw({world});
    assert.equal(renderer.metrics().heightfields,1);
    assert.equal(renderer.metrics().heightfield_triangles,4);
    let terrain=context.scene.getObjectByProperty('isMesh',true);
    assert.ok(terrain.visible&&terrain.material.map);
    world.heightfields.ground={...field(),revision:2,heights:[8,1,2,3,4,5]};
    renderer.draw({world});
    terrain=context.scene.getObjectByProperty('isMesh',true);
    assert.equal(terrain.geometry.attributes.position.array[1],8);
    world.heightfields={};renderer.draw({world});
    assert.equal(renderer.metrics().heightfields,0);
  }finally{renderer.dispose();}
});

test('actual raw WebGPU draw rejects before resize or GPU submission', async t => {
  const effects=[];
  const device={createShaderModule(){return {}},createRenderPipeline(){return {}},createSampler(){return {}}};
  const context={configure(){effects.push('configure')}};
  globals(t,{window:{devicePixelRatio:1,addEventListener(){}},navigator:{gpu:{async requestAdapter(){return {async requestDevice(){return device}}},getPreferredCanvasFormat(){return 'bgra8unorm'}}}});
  const canvas={clientWidth:64,clientHeight:64,getContext(){return context}};
  const renderer=await createWebGpuRenderer(canvas);
  effects.length=0;
  assert.throws(()=>renderer.draw({heightfields:{ground:{}}}), error=>error.code==='HEIGHTFIELD_BACKEND_UNSUPPORTED'&&error.facts.backend==='webgpu-raw');
  assert.deepEqual(effects,[]);
});
