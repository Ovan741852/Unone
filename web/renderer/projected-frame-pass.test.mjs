import {test} from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.player.min.js';
import {createFramePass} from './projected-frame-pass.js';import {createFrameDraws} from './projected-frame-draws.js';
import {frameProfileCases,FRAME_CONFORMANCE} from './projected-frame-profile.js';import {projectedFrame} from '../shared/projected-frame.mjs';
import {validateFrameTarget} from './projected-frame-validator.js';
function fixture(){
 let target=null,viewport=new THREE.Vector4(1,2,640,360),scissor=new THREE.Vector4(3,4,50,60),test=true;
 let color=new THREE.Color(0x28405a),alpha=.37,dither=true,wrongDepth=false,wrongSize=false,lost=false,fail=false,cleanupError=false,pendingError=null;
 const events=[],names=['FRAMEBUFFER','FRAMEBUFFER_COMPLETE','COLOR_ATTACHMENT0','DEPTH_ATTACHMENT','FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE','FRAMEBUFFER_ATTACHMENT_OBJECT_NAME',
  'FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE','FRAMEBUFFER_ATTACHMENT_RED_SIZE','FRAMEBUFFER_ATTACHMENT_GREEN_SIZE','FRAMEBUFFER_ATTACHMENT_BLUE_SIZE','FRAMEBUFFER_ATTACHMENT_ALPHA_SIZE',
  'FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE','FRAMEBUFFER_ATTACHMENT_STENCIL_SIZE','FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING','TEXTURE','UNSIGNED_NORMALIZED','LINEAR','FLOAT','SAMPLES','MAX_TEXTURE_SIZE','DITHER','DEPTH_CLEAR_VALUE','NO_ERROR','RGBA','UNSIGNED_BYTE'];
 const gl=Object.fromEntries(names.map((n,i)=>[n,i+100]));
 Object.assign(gl,{isContextLost:()=>lost,isEnabled:()=>dither,enable(){dither=true;},disable(){dither=false;},getError(){const e=pendingError??gl.NO_ERROR;pendingError=null;return e;},
  checkFramebufferStatus:()=>gl.FRAMEBUFFER_COMPLETE,getParameter:p=>p===gl.SAMPLES?0:p===gl.MAX_TEXTURE_SIZE?8192:1,
  getFramebufferAttachmentParameter(f,slot,p){
   if(p===gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE)return gl.TEXTURE;if(p===gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)return {};
   if(p===gl.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE)return slot===gl.DEPTH_ATTACHMENT?gl.FLOAT:gl.UNSIGNED_NORMALIZED;
   if(p===gl.FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING)return gl.LINEAR;
   if(p===gl.FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE)return slot===gl.DEPTH_ATTACHMENT?(wrongDepth?24:32):0;
   if(p===gl.FRAMEBUFFER_ATTACHMENT_STENCIL_SIZE)return 0;return slot===gl.COLOR_ATTACHMENT0?8:0;},
  readPixels(x,y,w,h,format,type,pixels){pixels.fill(0);events.push(['defaultRead',x,y,w,h]);}});
 const renderer={autoClear:true,getContext:()=>gl,getPixelRatio:()=>2,getDrawingBufferSize:v=>v.set(1280,720),
  getRenderTarget:()=>target,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,setRenderTarget:t=>target=t,
  getViewport:v=>v.copy(viewport),setViewport(...v){viewport=v[0]?.isVector4?v[0].clone():new THREE.Vector4(...v);},
  getScissor:v=>v.copy(scissor),setScissor(...v){scissor=v[0]?.isVector4?v[0].clone():new THREE.Vector4(...v);},
  getScissorTest:()=>test,setScissorTest:v=>test=v,getClearColor:v=>v.copy(color),getClearAlpha:()=>alpha,
  setClearColor(c,a){color=new THREE.Color(c);alpha=a;},clear(){events.push(['clear']);if(cleanupError)pendingError=0x0500;},
  readRenderTargetPixels(t,x,y,w,h,pixels){assert.equal(t.width,2);assert.equal(t.height,1);const width=wrongSize?1279:1280;
   pixels.set([width&255,width>>8,720&255,720>>8,width&255,width>>8,720&255,720>>8]);events.push(['sizeRead']);},
  render(scene){for(const mesh of scene.children){mesh.geometry.computeBoundingSphere();assert(Number.isFinite(mesh.geometry.boundingSphere.radius));
   events.push(['mesh',mesh.material,target,dither]);}if(fail)throw Error('draw-fault');}};
 const state=()=>({target,viewport:viewport.toArray(),scissor:scissor.toArray(),test,color:color.toArray(),alpha,dither,autoClear:renderer.autoClear});
 const initial=state(),pass=createFramePass(THREE,renderer);
 return {renderer,gl,events,state,initial,pass,wrongDepth:()=>wrongDepth=true,wrongSize:()=>wrongSize=true,lose:()=>lost=true,restore:()=>lost=false,fail:()=>fail=true,failCleanup:()=>cleanupError=true};
}
test('actual production pass queries attachments and textureSize, initializes nonzero RGB/depth, blends and full-copies alpha0',()=>{
 const f=fixture(),source=new THREE.DataTexture(new Uint8Array([200,100,50,0]),1,1);source.flipY=false;source.colorSpace=THREE.SRGBColorSpace;
 const draws=createFrameDraws(THREE,()=>({state:'ready',texture:source}));
 const input=frameProfileCases(1280,720).find(c=>c.id==='blend-one_minus_source_alpha');
 const frame=projectedFrame({projected_frame:input.frame});assert(draws.prepare(frame,new Map([['tint',{kind:'texture2d'}]])));
 assert(f.pass.draw(draws,new THREE.PerspectiveCamera(),frame));assert.deepEqual(f.state(),f.initial);
 const meshes=f.events.filter(e=>e[0]==='mesh'),init=meshes.find(e=>e[1].uniforms.initialRgb),material=meshes.find(e=>e[1].uniforms.alphaSource)?.[1],copy=meshes.at(-1)[1];
 assert.deepEqual(init[1].uniforms.initialRgb.value.toArray(),[20,40,60].map(n=>Math.fround(n/255)));assert.equal(init[1].uniforms.initialDepth.value,1);
 assert.equal(material.blending,THREE.CustomBlending);assert.equal(material.blendSrc,THREE.SrcAlphaFactor);assert.equal(material.blendDst,THREE.OneMinusSrcAlphaFactor);
 assert.equal(material.depthFunc,THREE.LessEqualDepth);assert.equal(material.depthWrite,false);assert.equal(material.uniforms.frameTexture.value.flipY,false);
 assert.equal(material.uniforms.frameTexture.value.colorSpace,THREE.NoColorSpace);assert.equal(source.colorSpace,THREE.SRGBColorSpace);
 assert.doesNotMatch(copy.fragmentShader,/discard|value\.a|colorspace_fragment/);assert.match(copy.fragmentShader,/physicalHeight-1-p\.y/);
 assert(meshes.every(e=>e[3]===false));assert.equal(f.events.filter(e=>e[0]==='sizeRead').length,1);
 assert.deepEqual(f.pass.metrics().attachment.physical_size,[1280,720]);draws.clear();f.pass.dispose();f.pass.dispose();source.dispose();
});
test('wrong actual depth format or GPU textureSize fails closed and restores state',()=>{
 for(const kind of ['wrongDepth','wrongSize']){const f=fixture();f[kind]();
  assert.throws(()=>f.pass.draw({draw(){}},new THREE.PerspectiveCamera(),{initial:{rgb8:[17,24,39],depth:.5}}),/ATTACHMENT_UNSUPPORTED/);
  assert.deepEqual(f.state(),f.initial);f.pass.dispose();}
 const f=fixture();f.fail();assert.throws(()=>f.pass.draw({draw(){}},new THREE.PerspectiveCamera(),{initial:{rgb8:[17,24,39],depth:.5}}),/draw-fault/);
 assert.deepEqual(f.state(),f.initial);f.pass.dispose();
});
test('neutral reference registry uses real new pass, fails zero readback and bounds cases/actual size',()=>{
 const f=fixture(),cases=frameProfileCases(1280,720);assert.equal(cases.length,47);assert.equal(cases.reduce((n,c)=>n+c.expected.length,0),1028);
 for(const c of cases)projectedFrame({projected_frame:c.frame});assert.equal(FRAME_CONFORMANCE.hash.length,64);
 const result=validateFrameTarget(THREE,f.renderer,f.pass,{physical_size:[1280,720],dpr:2});assert.equal(result.samples,1028);assert(result.passed<1028);
 assert.equal(result.failures.length,8);assert.deepEqual(f.state(),f.initial);f.lose();assert.deepEqual(validateFrameTarget(THREE,f.renderer,f.pass,{physical_size:[1280,720],dpr:2}),{lost:true});f.pass.dispose();
});
test('same renderer accepts fresh-Core revision1 with different bytes without stale geometry',()=>{
 const f=fixture(),texture=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);
 const draws=createFrameDraws(THREE,()=>({state:'ready',texture})),camera=new THREE.PerspectiveCamera();
 const a=frameProfileCases(1280,720).find(c=>c.id==='alpha-always').frame;a.revision=1;
 const first=projectedFrame({projected_frame:a});draws.prepare(first,new Map([['white',{kind:'texture2d'}]]));f.pass.draw(draws,camera,first);
 const b=structuredClone(a),bytes=Buffer.from(b.draws[0].vertices,'base64');bytes.writeFloatLE(-.75,0);b.draws[0].vertices=bytes.toString('base64');
 const next=projectedFrame({projected_frame:b});draws.prepare(next,new Map([['white',{kind:'texture2d'}]]));f.pass.draw(draws,camera,next);
 const game=f.events.filter(e=>e[0]==='mesh'&&e[1].uniforms.alphaSource).at(-1);
 // The recorded material owns the new prepared mesh; inspect the actual draw record through a renderer capture.
 let x;const original=f.renderer.render;f.renderer.render=scene=>{for(const m of scene.children)if(m.material.uniforms.alphaSource)x=m.geometry.attributes.clipPosition.data.array[0];original(scene);};
 f.pass.draw(draws,camera,next);assert.equal(x,-.75);assert(game);draws.clear();f.pass.dispose();texture.dispose();
});

test('actual conformance cleanup cannot return validation while its final clear leaves a GPU error',()=>{
 const f=fixture();f.failCleanup();
 assert.throws(()=>validateFrameTarget(THREE,f.renderer,f.pass,{physical_size:[1280,720],dpr:2}),/stage=frame-validation\.clear gl_error=0x0500/);
 assert.deepEqual(f.state(),f.initial);f.pass.dispose();
});

test('context loss retires fullscreen and size-query owners before restoration and recreates fresh helpers',()=>{
 const f=fixture(),camera=new THREE.PerspectiveCamera(),frame={initial:{rgb8:[17,24,39],depth:1}};
 f.pass.draw({draw(){}},camera,frame);
 const materials=new Set(f.events.filter(e=>e[0]==='mesh').map(e=>e[1]));let disposed=0;
 for(const m of materials)m.addEventListener('dispose',()=>disposed++);
 assert.equal(materials.size,3,'initial, copy and GPU textureSize query helpers');
 const generation=f.pass.metrics().generation;f.lose();f.pass.contextLost();f.pass.contextLost();
 assert.equal(disposed,3);assert.equal(f.pass.metrics().attachment,null);assert.equal(f.pass.metrics().generation,generation);
 assert.equal(f.pass.draw({draw(){}},camera,frame),false);
 f.restore();f.events.length=0;assert(f.pass.draw({draw(){}},camera,frame));
 for(const e of f.events.filter(e=>e[0]==='mesh'))assert(!materials.has(e[1]),'old Three ownership listeners never cross context epochs');
 assert.equal(f.pass.metrics().generation,generation+1);f.pass.dispose();assert.equal(disposed,3);
});
