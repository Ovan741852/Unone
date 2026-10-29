import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.player.min.js';
import {inspectFrameAttachments,createFrameSizeQuery} from './projected-frame-target-query.js';
import {createFrameTarget} from './projected-frame-target.js';

function context(){
 const names=['FRAMEBUFFER','FRAMEBUFFER_COMPLETE','COLOR_ATTACHMENT0','DEPTH_ATTACHMENT',
  'FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE','FRAMEBUFFER_ATTACHMENT_OBJECT_NAME','FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE',
  'FRAMEBUFFER_ATTACHMENT_RED_SIZE','FRAMEBUFFER_ATTACHMENT_GREEN_SIZE','FRAMEBUFFER_ATTACHMENT_BLUE_SIZE',
  'FRAMEBUFFER_ATTACHMENT_ALPHA_SIZE','FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE','FRAMEBUFFER_ATTACHMENT_STENCIL_SIZE',
  'FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING','TEXTURE','UNSIGNED_NORMALIZED','LINEAR','FLOAT','SAMPLES','MAX_TEXTURE_SIZE'];
 const gl=Object.fromEntries(names.map((name,index)=>[name,index+100]));
 let error=0,failParameter=null;const events=[];
 Object.assign(gl,{NO_ERROR:0,isContextLost:()=>false,getError(){const value=error;error=0;events.push(['getError',value]);return value;},
  checkFramebufferStatus(){events.push(['status']);return gl.FRAMEBUFFER_COMPLETE;},
  getParameter(p){events.push(['parameter',p]);return p===gl.MAX_TEXTURE_SIZE?8192:0;},
  getFramebufferAttachmentParameter(f,slot,p){
   events.push(['attachment',slot,p]);if(p===failParameter)error=0x0502;
   if(p===gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE)return gl.TEXTURE;
   if(p===gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)return {};
   if(p===gl.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE)return slot===gl.DEPTH_ATTACHMENT?gl.FLOAT:gl.UNSIGNED_NORMALIZED;
   if(p===gl.FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING)return gl.LINEAR;
   if(p===gl.FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE)return slot===gl.DEPTH_ATTACHMENT?32:0;
   if(p===gl.FRAMEBUFFER_ATTACHMENT_STENCIL_SIZE)return 0;return slot===gl.COLOR_ATTACHMENT0?8:0;
  }});
 return {gl,events,failParameter:p=>failParameter=p,raise:()=>error=0x0502};
}

function rendererFixture(){
 const f=context();let fail='';const events=[];
 const renderer={getContext:()=>f.gl,getPixelRatio:()=>1,autoClear:true,
  setRenderTarget(t){events.push(['target',t]);if(fail==='bind')f.raise();},
  setViewport(){},setScissorTest(){},render(){events.push(['render']);if(fail==='render')f.raise();},
  readRenderTargetPixels(t,x,y,w,h,pixels){events.push(['read']);pixels.set([0,5,208,2,0,5,208,2]);if(fail==='read')f.raise();}};
 return {...f,renderer,events,fail:stage=>fail=stage};
}

test('preexisting GPU error is terminal at attachment entry, not attributed to a later query',()=>{
 const f=context();f.raise();
 assert.throws(()=>inspectFrameAttachments(f.gl),/stage=attachment\.enter gl_error=0x0502/);
 assert.deepEqual(f.events,[['getError',0x0502]]);
});

test('attachment query error names exact attachment and parameter without continuing',()=>{
 const f=context();f.failParameter(f.gl.FRAMEBUFFER_ATTACHMENT_GREEN_SIZE);
 assert.throws(()=>inspectFrameAttachments(f.gl),/stage=attachment\.color\.GREEN_SIZE gl_error=0x0502/);
 assert.equal(f.events.filter(e=>e[0]==='attachment').at(-1)[2],f.gl.FRAMEBUFFER_ATTACHMENT_GREEN_SIZE);
 assert(!f.events.some(e=>e[0]==='attachment'&&e[1]===f.gl.DEPTH_ATTACHMENT));
});

test('actual production size-query separates allocation, render and readback errors',()=>{
 for(const [stage,expected] of [['bind','bind'],['render','render'],['read','readback']]){
  const f=rendererFixture(),query=createFrameSizeQuery(THREE),source=new THREE.WebGLRenderTarget(1280,720);
  source.depthTexture=new THREE.DepthTexture(1280,720,THREE.FloatType);f.fail(stage);
  assert.throws(()=>query.measure(f.renderer,new THREE.PerspectiveCamera(),source,1280,720),new RegExp(`stage=size-query\\.${expected} gl_error=0x0502`));
  if(stage==='bind')assert(!f.events.some(e=>e[0]==='render'));
  if(stage==='render')assert(!f.events.some(e=>e[0]==='read'));
  query.dispose();source.dispose();
 }
});

test('actual production target distinguishes allocation/bind from inspection',()=>{
 const f=rendererFixture(),target=createFrameTarget(THREE);f.fail('bind');
 assert.throws(()=>target.ensure(f.renderer,new THREE.PerspectiveCamera(),1280,720),/stage=target\.bind gl_error=0x0502/);
 assert.equal(f.events.filter(e=>e[0]==='target').length,1);assert.equal(target.metrics().attachment,null);target.dispose();
});

test('successful inspector and size query preserve exact strict format/dimension proof',()=>{
 const f=rendererFixture(),target=createFrameTarget(THREE);
 assert(target.ensure(f.renderer,new THREE.PerspectiveCamera(),1280,720));
 assert.deepEqual(target.metrics().attachment,{color:'rgba8_unorm',depth:'depth_component32f',samples:0,
  physical_size:[1280,720],depth_size:[1280,720],size_method:'GPU_textureSize_rgba8_readback'});
 target.dispose();
});
