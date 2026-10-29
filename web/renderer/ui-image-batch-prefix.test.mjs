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
  getViewport:v=>v.set(0,0,100,100),getScissor:v=>v.set(0,0,100,100),getScissorTest:()=>false,getPixelRatio:()=>1,setViewport(){},setScissor(){},setScissorTest(){},render(scene){this.scene=scene;this.calls=[];for(const mesh of [...scene.children].sort((a,b)=>a.renderOrder-b.renderOrder))for(const group of mesh.geometry.groups){const m=mesh.material[group.materialIndex];mesh.onBeforeRender(this,scene,null,mesh.geometry,m,group);this.calls.push({mesh,group,image:m.uniforms.projectedTexture.value.image,transform:[...m.uniforms.imageTransform.value.elements],snap:m.uniforms.imagePixelSnap.value,framebuffer:[...m.uniforms.imageFramebufferSize.value],dirty:m.uniformsNeedUpdate});}}};
 const presenter=createUiImageBatchPrefix(T,renderer),instance=(id,t=transform)=>resolver.resolve({kind:'image_batch',id,rect:bounds,content:id,transform:t},
  {[id]:retainImageResource({revision:1,bounds,quads:[{asset:'asset://a',rect:{x:10,y:10,width:20,height:20}}]})});
 return {presenter,renderer,instance,resolver,context:{width:100,height:100,images}};
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
const quad=(x=10,asset='asset://a',extra={})=>({asset,rect:{x,y:10,width:5,height:5},...extra});
function resolved(h,id,quads,{revision=1,retained=true,t=transform,definition,pixelSnap=false}={}){
 return h.resolver.resolve({kind:'image_batch',id,rect:bounds,...(retained?{content:id,transform:t}:{quads}),...(pixelSnap?{pixel_snap:true}:{})},
  retained?{[id]:definition??retainImageResource({revision,bounds,quads})}:undefined);
}
test('changed inline generations update owned same-capacity storage without geometry, mesh or material churn',()=>{
 const h=harness();let geometry,buffer,index;
 for(let frame=0;frame<200;frame++){
  const q=quad(10+frame%5,'asset://a',{source:{x:frame%2,y:1,width:4,height:5},opacity:frame%2?.25:.75}),p=resolved(h,'dynamic',[q],{retained:false});
  assert.equal(h.presenter.drawPrefix([p],h.context),1);const mesh=h.renderer.scene.children[0];
  if(!geometry){geometry=mesh.geometry;buffer=geometry.attributes.position.data;index=geometry.index;}
  assert.equal(mesh.geometry,geometry);assert.equal(geometry.attributes.position.data,buffer);assert.equal(geometry.index,index);
  assert.equal(buffer.array[0],q.rect.x);assert.equal(buffer.array[3],Math.fround(q.source.x/8));assert.equal(buffer.array[5],q.opacity);
  q.rect.x=90;assert.notEqual(buffer.array[0],90,'caller mutation cannot alias private GPU buffers');
 }
 const m=h.presenter.metrics();assert.equal(m.geometry_builds,1);assert.equal(m.geometry_disposes,0);assert.equal(m.material_builds,1);assert.equal(m.mesh_builds,1);assert.equal(m.geometry_updates,200);
 h.presenter.dispose();retired(h.presenter);assert.equal(h.presenter.metrics().live_meshes,0);
});
test('texture runs share one geometry/material and preserve authored A/B/A order across instance reorder',()=>{
 const h=harness(),imageB={width:8,height:8};h.context.images.set('asset://b',{state:'ready',image:imageB});
 const quads=[quad(1),quad(2,'asset://b'),quad(3)],a=resolved(h,'first',quads),b=resolved(h,'second',quads,{t:{...transform,tx:4}});
 h.presenter.drawPrefix([a,b],h.context);const first=h.renderer.scene.children[0],second=h.renderer.scene.children[1];
 assert.equal(first.material[0],second.material[0]);assert.equal(first.geometry.groups.length,3);
 assert.deepEqual(h.renderer.calls.map(c=>c.group.asset),['asset://a','asset://b','asset://a','asset://a','asset://b','asset://a']);assert.ok(h.renderer.calls.every(c=>c.dirty));
 h.presenter.drawPrefix([b,a],h.context);assert.deepEqual(h.renderer.calls.map(c=>c.mesh),[second,second,second,first,first,first]);
 const before=h.presenter.metrics().geometry_updates,geometry=first.geometry,version=geometry.attributes.position.data.version;
 h.presenter.drawPrefix([resolved(h,'first',quads.map(q=>({...q,asset:'asset://b'})))],h.context);
 assert.equal(h.renderer.scene.children[0].geometry,geometry);assert.equal(geometry.attributes.position.data.version,version);assert.equal(h.presenter.metrics().geometry_updates,before,'texture-only update with unchanged UV needs no vertex upload');
 assert.equal(geometry.groups.length,1);assert.equal(geometry.groups[0].count,18);assert.equal(h.presenter.metrics().live_materials,1);h.presenter.dispose();retired(h.presenter);
});
test('capacity grows geometrically, draw ranges shrink safely and active peak storage compacts',()=>{
 const h=harness(),make=count=>resolved(h,'sized',Array.from({length:count},(_,i)=>quad(i%90)));
 h.presenter.drawPrefix([make(3)],h.context);const original=h.renderer.scene.children[0].geometry;
 h.presenter.drawPrefix([make(4)],h.context);assert.equal(h.renderer.scene.children[0].geometry,original);
 h.presenter.drawPrefix([make(5)],h.context);const grown=h.renderer.scene.children[0].geometry;assert.notEqual(grown,original);assert.equal(h.presenter.metrics().buffer_capacity_quads,8);
 for(let i=0;i<100;i++){h.presenter.drawPrefix([make(i%2?2:5)],h.context);assert.equal(h.renderer.scene.children[0].geometry,grown);assert.equal(grown.drawRange.count,(i%2?2:5)*6);}
 h.presenter.drawPrefix([make(1024)],h.context);h.presenter.drawPrefix([make(1)],h.context);
 assert.equal(h.presenter.metrics().buffer_capacity_quads,1);assert.equal(h.presenter.metrics().live_geometries,1);assert.equal(h.presenter.metrics().material_builds,1);assert.equal(h.presenter.metrics().mesh_builds,1);
 h.presenter.drawPrefix([],h.context);retired(h.presenter);assert.equal(h.presenter.metrics().buffer_capacity_quads,0);assert.equal(h.renderer.scene.children.length,0);h.presenter.dispose();
});
test('resource migration never overwrites a still selected shared generation or trusts a reused revision',()=>{
 const h=harness(),old=retainImageResource({revision:1,bounds,quads:[quad(10)]}),fresh=retainImageResource({revision:1,bounds,quads:[quad(20)]});
 const a=resolved(h,'a',null,{definition:old}),b=resolved(h,'b',null,{definition:old});h.presenter.drawPrefix([a,b],h.context);
 const original=h.renderer.scene.children[0].geometry;assert.equal(h.renderer.scene.children[1].geometry,original);
 const changed=resolved(h,'a',null,{definition:fresh});h.presenter.drawPrefix([changed,b],h.context);
 assert.equal(original.attributes.position.data.array[0],10);assert.notEqual(h.renderer.scene.children[0].geometry,original);assert.equal(h.renderer.scene.children[1].geometry,original);
 h.presenter.drawPrefix([changed,resolved(h,'b',null,{definition:fresh})],h.context);assert.equal(h.renderer.scene.children[0].geometry,h.renderer.scene.children[1].geometry);assert.equal(h.presenter.metrics().live_geometries,1);
 const raw={revision:1,bounds,quads:[quad(30)]};h.presenter.drawPrefix([resolved(h,'a',null,{definition:raw})],h.context);const geometry=h.renderer.scene.children[0].geometry;
 raw.quads[0].rect.x=40;h.presenter.drawPrefix([resolved(h,'a',null,{definition:raw})],h.context);assert.equal(h.renderer.scene.children[0].geometry,geometry);assert.equal(geometry.attributes.position.data.array[0],40);h.presenter.dispose();retired(h.presenter);
});
test('decoded source replacement and dimension changes update UVs and retire old textures without rebuilding geometry',()=>{
 const h=harness(),p=resolved(h,'a',[quad(1,'asset://a',{source:{x:2,y:1,width:4,height:4}})]);h.presenter.drawPrefix([p],h.context);
 const geometry=h.renderer.scene.children[0].geometry,image={width:16,height:8};h.context.images.set('asset://a',{state:'ready',image});h.presenter.drawPrefix([p],h.context);
 assert.equal(h.renderer.scene.children[0].geometry,geometry);assert.equal(geometry.attributes.uv.data.array[3],.125);assert.equal(h.presenter.metrics().texture_disposes,1);
 const texture=h.renderer.calls[0].group.texture,version=texture.version;image.width=32;h.presenter.drawPrefix([p],h.context);
 assert.equal(geometry.attributes.uv.data.array[3],.0625);assert.ok(texture.version>version);assert.equal(h.presenter.metrics().live_textures,1);assert.equal(h.presenter.metrics().geometry_builds,1);h.presenter.dispose();retired(h.presenter);
});
test('aggregate capacity stays bounded when many active resources take turns peaking',()=>{
 const h=harness(),make=(id,count)=>resolved(h,id,Array.from({length:count},()=>quad(1))),nodes=Array.from({length:32},(_,i)=>make(`p${i}`,1));
 h.presenter.drawPrefix(nodes,h.context);
 for(let i=0;i<nodes.length;i++){nodes[i]=make(`p${i}`,512);h.presenter.drawPrefix(nodes,h.context);nodes[i]=make(`p${i}`,1);h.presenter.drawPrefix(nodes,h.context);assert.ok(h.presenter.metrics().buffer_capacity_quads<=256);}
 const builds=h.presenter.metrics().geometry_builds;for(let i=0;i<120;i++)h.presenter.drawPrefix(nodes,h.context);
 assert.equal(h.presenter.metrics().geometry_builds,builds,'steady frames do not churn to enforce capacity');assert.equal(h.presenter.metrics().material_builds,1);h.presenter.dispose();retired(h.presenter);
});
test('each group uploads current per-instance snap and framebuffer uniforms without changing topology',()=>{
 const h=harness(),plain=h.instance('a'),snap=resolved(h,'b',[quad()],{pixelSnap:true});h.presenter.drawPrefix([plain,snap],h.context);
 assert.deepEqual(h.renderer.calls.map(c=>c.snap),[0,1]);assert.deepEqual(h.renderer.calls[0].framebuffer,[100,100]);const builds=h.presenter.metrics().geometry_builds;
 h.presenter.drawPrefix([{...plain,pixelSnap:true},{...snap,pixelSnap:false}],h.context);assert.deepEqual(h.renderer.calls.map(c=>c.snap),[1,0]);assert.equal(h.presenter.metrics().geometry_builds,builds);h.presenter.dispose();
});
