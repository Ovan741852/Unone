import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.player.min.js';
import {Texture} from '../vendor/three/three.core.js';
import {createRasterProbe} from './projected-raster-probe.mjs';
import {copySourceY} from './projected-raster-probe-shaders.mjs';
import {authoredCases,packCase} from './fixtures/raster-origin/registry.mjs';
import {projectedEntries,projectedGeometryData} from './projected.js';
const b64=a=>Buffer.from(a.buffer).toString('base64');
const batch=()=>({format:'f32le-clip4-uv2-rgba4-u32-v1',texture:'white',order:0,depth_test:true,depth_write:true,
 vertex_count:3,index_count:3,revision:1,scissor:{x:3,y:7,width:11,height:13},
 vertices:b64(new Float32Array([-.5,-.5,.25,1,0,0,1,1,1,0, .5,-.5,.25,1,1,0,1,1,1,0, 0,.5,.25,1,.5,1,1,1,1,0])),indices:b64(new Uint32Array([0,1,2]))});
function fixture(strategy='C'){
 let target=null,viewport=new THREE.Vector4(2,4,80,60),scissor=new THREE.Vector4(1,3,40,50),test=false;
 let color=new THREE.Color(0x112233),alpha=.7,ratio=2,width=1280,height=720;
 const events=[],texture=new Texture();let failure=false;
 const renderer={autoClear:true,getRenderTarget:()=>target,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,
  getViewport:v=>v.copy(viewport),setViewport(...v){viewport=v[0]?.isVector4?v[0].clone():new THREE.Vector4(...v);},
  getScissor:v=>v.copy(scissor),getScissorTest:()=>test,setScissorTest:v=>test=v,
  setScissor(...v){scissor=v[0]?.isVector4?v[0].clone():new THREE.Vector4(...v);events.push(['scissor',...scissor]);},
  getClearColor:v=>v.copy(color),getClearAlpha:()=>alpha,setClearColor(c,a){color=new THREE.Color(c);alpha=a;},
  getDrawingBufferSize:v=>v.set(width,height),getPixelRatio:()=>ratio,
  setRenderTarget(t){target=t;events.push(['target',t]);},clear(...a){events.push(['clear',...a]);},clearDepth(){events.push(['depth']);},
  render(scene){const mesh=scene.children[0];for(const m of scene.children)if(m.visible)m.onBeforeRender?.();
   events.push(['draw',target,mesh]);if(failure)throw Error('injected GPU dispatch failure');}};
 const before=()=>({target,viewport:viewport.toArray(),scissor:scissor.toArray(),test,color:color.toArray(),alpha,autoClear:renderer.autoClear});
 const initial=before();const probe=createRasterProbe({THREE,renderer,camera:new THREE.PerspectiveCamera(),textureFor:()=>({state:'ready',texture}),strategy,antialias:false,backend:'webgl'});
 return {probe,renderer,events,before,initial,fail:()=>failure=true,resize:(w,h,r)=>{width=w;height=h;ratio=r;},
  snapshot:{projected_world_visible:false,projected_geometry:{tri:batch()}},specs:new Map([['white',{kind:'texture2d'}]])};
}
test('C uses actual official packed geometry, reflected clip Y and encoded-byte staging, without mutating bytes',()=>{
 const f=fixture(),original=structuredClone(f.snapshot);f.probe.draw(f.snapshot,f.specs);
 const draws=f.events.filter(e=>e[0]==='draw');assert.equal(draws.length,2);
 const [target,mesh]=draws[0].slice(1);assert.equal(target.width,1280);assert.equal(target.height,720);assert.equal(target.samples,0);
 assert.match(mesh.material.vertexShader,/-clipPosition\.y/);assert.match(mesh.material.fragmentShader,/gl_FragColor\.rgb=projectedToEncoded/);
 assert.doesNotMatch(mesh.material.fragmentShader,/#include <colorspace_fragment>/);assert.match(draws[1][2].material.fragmentShader,/texelFetch/);
 assert.match(draws[1][2].material.fragmentShader,/\.a<0\.5/);assert.equal(draws[1][2].material.blending,THREE.NoBlending);
 // Three sorts meshes through a 3D bounding sphere even when frustumCulled=false.
 const copyGeometry=draws[1][2].geometry;copyGeometry.computeBoundingSphere();
 assert.ok(Number.isFinite(copyGeometry.boundingSphere.radius));assert.equal(copyGeometry.attributes.position.itemSize,3);
 assert.deepEqual([...mesh.geometry.attributes.clipPosition.data.array].slice(0,10),[-.5,-.5,.25,1,0,0,1,1,1,0]);
 assert.deepEqual(f.snapshot,original);assert.deepEqual(f.before(),f.initial);f.probe.dispose();
});
test('A preserves shader and direct target, B isolates FBO without reflecting, C reflects physical scissor once at DPR2',()=>{
 for(const strategy of ['A','B','C']){const f=fixture(strategy);f.probe.draw(f.snapshot,f.specs);
  const draws=f.events.filter(e=>e[0]==='draw');assert.equal(draws.length,strategy==='A'?1:2);
  assert.equal(draws[0][1]===null,strategy==='A');assert.equal(draws[0][2].material.vertexShader.includes('-clipPosition.y'),strategy==='C');
  const expected=strategy==='C'?[1.5,3.5,5.5,6.5]:[1.5,350,5.5,6.5];
  assert.ok(f.events.some(e=>e[0]==='scissor'&&JSON.stringify(e.slice(1))===JSON.stringify(expected)));
  assert.deepEqual(f.before(),f.initial);f.probe.dispose();}
});
test('target resize/dispose, empty/remove/readd and exception restore do not compose stale coverage',()=>{
 const f=fixture('B');f.probe.draw(f.snapshot,f.specs);const first=f.events.find(e=>e[0]==='target'&&e[1])?.[1];assert.ok(first);
 let disposed=0;first.addEventListener('dispose',()=>disposed++);f.resize(800,600,1);f.probe.draw(f.snapshot,f.specs);
 assert.equal(disposed,1);assert.equal(f.probe.metrics().generation,2);f.events.length=0;
 f.probe.draw({projected_world_visible:false,projected_geometry:{}},f.specs);assert.equal(f.events.filter(e=>e[0]==='draw').length,0);
 f.probe.draw(f.snapshot,f.specs);assert.equal(f.events.filter(e=>e[0]==='draw').length,2);
 f.fail();assert.throws(()=>f.probe.draw(f.snapshot,f.specs),/injected/);assert.deepEqual(f.before(),f.initial);f.probe.dispose();f.probe.dispose();
});
test('unsupported world/depth profile, strategy and live AA never silently fallback; context invalidation is observable',()=>{
 const f=fixture();assert.throws(()=>f.probe.draw({...f.snapshot,projected_world_visible:true},f.specs),/WORLD_DEPTH_UNSUPPORTED/);
 assert.throws(()=>fixture('bogus'),/STRATEGY/);f.probe.invalidate();assert.equal(f.probe.metrics().context,'lost');
 assert.throws(()=>f.probe.draw(f.snapshot,f.specs),/CONTEXT_LOST/);f.probe.restore();f.probe.draw(f.snapshot,f.specs);
 assert.equal(f.probe.metrics().context,'restored_needs_gpu_revalidation');assert.equal(f.probe.metrics().generation,1);f.probe.dispose();
});
test('C row reflection is a one-to-one involution at every physical row/DPR; X and perspective depth stay unchanged',()=>{
 for(const height of [1,2,599,600,720,1440])for(let y=0;y<height;y++){
  assert.equal(copySourceY(y,height,'A'),y);assert.equal(copySourceY(y,height,'B'),y);
  assert.equal(copySourceY(copySourceY(y,height,'C'),height,'C'),y);
  assert.equal(height-1-copySourceY(y,height,'C'),y);
 }
 const gradient=authoredCases().find(c=>c.id==='gradients');
 for(const [width,height] of [[1280,720],[800,600]]){
  const geometry=projectedGeometryData(projectedEntries(packCase(gradient,width,height))[0][1]);
  for(let i=0;i<4;i++){const v=geometry.vertices.slice(i*10,i*10+10),w=gradient.batches[0].w[i];
   assert.equal(v[3],w);assert.equal(v[2],.25*w);assert.equal(v[4],gradient.batches[0].uv[i][0]);
   const physicalY=(1-v[1]/v[3])*height/2;
   assert.ok(Math.abs(physicalY-(gradient.batches[0].positions[i][1]+.5))<.0001);
  }
 }
});
test('every authored case traverses real packed official renderer without touching original payload and disposes all strategies',()=>{
 for(const strategy of ['A','B','C']){const f=fixture(strategy);
  for(const c of authoredCases()){
   const input=packCase(c,1280,720),original=JSON.stringify(input),specs=new Map(['white','gray','corners','alpha127'].map(id=>[id,{kind:'texture2d'}]));
   f.probe.draw(input,specs);assert.equal(JSON.stringify(input),original);assert.deepEqual(f.before(),f.initial);
  }
  f.probe.dispose();
 }
});
