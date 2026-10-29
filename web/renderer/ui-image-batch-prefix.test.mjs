import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three/three.player.min.js';
import {createUiImageBatchPrefix} from './ui-image-batch-prefix.js';
import {createImageBatchResolver} from '../shared/ui-image-batch.mjs';
import {retainImageResource} from '../shared/retained-image-generation.mjs';
const bounds={x:0,y:0,width:100,height:100},transform={a:1,b:0,c:0,d:1,tx:0,ty:0};
function harness(){
 const image={width:8,height:8},images=new Map([['asset://a',{state:'ready',image}]]),resolver=createImageBatchResolver();
 const gl={UNPACK_FLIP_Y_WEBGL:1,UNPACK_PREMULTIPLY_ALPHA_WEBGL:2,isContextLost:()=>false,getParameter:()=>false,pixelStorei(){}};
 const renderer={autoClear:true,sortObjects:false,capabilities:{maxTextureSize:4096},outputColorSpace:T.SRGBColorSpace,getContext:()=>gl,getDrawingBufferSize:v=>v.set(100,100),getRenderTarget:()=>null,
  getViewport:v=>v.set(0,0,100,100),getScissor:v=>v.set(0,0,100,100),getScissorTest:()=>false,getPixelRatio:()=>1,setViewport(){},setScissor(){},setScissorTest(){},render(scene){this.scene=scene;}};
 const presenter=createUiImageBatchPrefix(T,renderer),instance=(id,t=transform)=>resolver.resolve({kind:'image_batch',id,rect:bounds,content:id,transform:t},
  {[id]:retainImageResource({revision:1,bounds,quads:[{asset:'asset://a',rect:{x:10,y:10,width:20,height:20}}]})});
 return {presenter,renderer,instance,context:{width:100,height:100,images}};
}
const retired=presenter=>{const m=presenter.metrics();assert.equal(m.live_geometries,0);assert.equal(m.live_materials,0);assert.equal(m.live_textures,0);};
test('same-image replacement that falls back retires every old GPU owner instead of only hiding it',()=>{
 const h=harness();assert.equal(h.presenter.drawPrefix([h.instance('a')],h.context),1);assert.equal(h.renderer.scene.children.length,1);
 assert.equal(h.presenter.drawPrefix([h.instance('b',{...transform,b:.2})],h.context),0);retired(h.presenter);assert.equal(h.renderer.scene.children.length,0);h.presenter.dispose();
});
test('target mismatch and a partially selected prefix retire non-selected instances and definitions',()=>{
 const h=harness(),a=h.instance('a'),b=h.instance('b');assert.equal(h.presenter.drawPrefix([a,b],h.context),2);
 assert.equal(h.presenter.drawPrefix([a,{...b,transform:{...transform,c:.2}}],h.context),1);assert.equal(h.presenter.metrics().live_geometries,1);assert.equal(h.presenter.metrics().live_materials,1);
 assert.equal(h.presenter.drawPrefix([a],{...h.context,width:101}),0);retired(h.presenter);assert.equal(h.renderer.scene.children.length,0);h.presenter.dispose();
});
test('GPU image limits fall back before Three can silently resize a valid source crop',()=>{
 const h=harness(),a=h.instance('a');assert.equal(h.presenter.drawPrefix([a],h.context),1);
 h.renderer.capabilities.maxTextureSize=4;assert.equal(h.presenter.drawPrefix([a],h.context),0);retired(h.presenter);
 h.renderer.capabilities={};assert.equal(h.presenter.drawPrefix([a],h.context),0);retired(h.presenter);h.presenter.dispose();
});
