import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../web/vendor/three/three.module.js';
import {createGpuUi} from '../web/renderer/ui-gpu.js';
import {createCanvasUi} from '../web/shared/canvas-ui.mjs';

// Real official presenters and text painters. Fake Canvas/GL records commands;
// it proves cache invalidation and placement, never glyph pixels/GPU/FPS.
function fixture({dedicated=false}={}){
 let scene=null,W=200,H=100,scale=1,frame=0;const paints=[],uploads=[];
 const createSurface=()=>{
  const canvas={width:1,height:1},stack=[];
  const ctx={canvas,font:'10px sans-serif',fillStyle:'#000',globalAlpha:1,letterSpacing:'0px',tx:0,ty:0,
   setTransform(_a,_b,_c,_d,x,y){this.tx=x;this.ty=y;},clearRect(){},beginPath(){},rect(){},roundRect(){},clip(){},fill(){},stroke(){},
   save(){stack.push({font:this.font,fillStyle:this.fillStyle,globalAlpha:this.globalAlpha,letterSpacing:this.letterSpacing,tx:this.tx,ty:this.ty});},
   restore(){Object.assign(this,stack.pop());},
   measureText(text){const px=Number(/([\d.]+)px/.exec(this.font)?.[1]??10);return{width:String(text).length*px*.5+String(text).length*Number.parseFloat(this.letterSpacing)};},
   fillText(text,x,y){paints.push({text:String(text),x:x+this.tx,y:y+this.ty,font:this.font,color:this.fillStyle});},
   fillRect(){},getImageData(_x,_y,w,h){return{data:new Uint8ClampedArray(w*h*4)};}};
  canvas.getContext=()=>ctx;return canvas;
 };
 const gl={TEXTURE_2D:1,UNPACK_FLIP_Y_WEBGL:2,UNPACK_PREMULTIPLY_ALPHA_WEBGL:3,UNPACK_ALIGNMENT:4,RGBA:5,UNSIGNED_BYTE:6,
  isContextLost:()=>false,pixelStorei(){},texSubImage2D(...args){uploads.push(args.slice(2,6));}};
 const renderer={autoClear:true,capabilities:{maxTextureSize:dedicated?32:256},getDrawingBufferSize:v=>v.set(W,H),getPixelRatio:()=>scale,
  getContext:()=>gl,state:{bindTexture(){}},properties:{get:t=>({__webglTexture:t})},getScissorTest:()=>false,getRenderTarget:()=>null,getViewport:v=>v.set(0,0,W,H),
  setRenderTarget(){},setScissorTest(){},setViewport(){},initTexture(){},render(s){scene=s;}};
 const gpu=createGpuUi(THREE,renderer,{createSurface}),canvas=createCanvasUi(null,{getPresenter:()=>gpu,createSurface,fontFamily:'Test Sans',textColor:'#ffffff'});
 const base=()=>({kind:'text',id:'label',text:'A stable label',rect:{x:10,y:25,width:40,height:20},style:{font_size:4,color:[1,1,1,1],wrap:'none'}});
 const draw=(nodes=[base()])=>{const value=Array.isArray(nodes)?nodes:[nodes];const result=canvas.draw({world:{frame:++frame,ui:{children:value}}});assert.equal(result.status,'completed');return gpu.metrics();};
 const origin=()=>{const m=scene?.children.find(m=>m.visible);assert(m,'real presenter submitted visible geometry');const a=m.geometry.getAttribute('uiOrigin');return[a.data.array[a.offset],a.data.array[a.offset+1]];};
 return{gpu,canvas,paints,uploads,base,draw,origin,resize(w,h,dpr=scale){W=w;H=h;scale=dpr;},dispose(){canvas.dispose();gpu.dispose();}};
}

for(const dedicated of [false,true])test(`${dedicated?'dedicated':'atlas'} integer translation preserves local text pixels and raster/upload counts`,()=>{
 const f=fixture({dedicated});try{
  const a=f.base(),first=f.draw(a),oldOrigin=f.origin(),paintBefore=f.paints.length;
  assert.equal(first.text_rasters,1);assert.equal(first.dedicated_text_textures,dedicated?1:0);
  // At 200x100 one x design unit is two pixels, and one y unit one pixel.
  const b={...a,rect:{...a.rect,x:a.rect.x+.5,y:a.rect.y-1}},next=f.draw(b),nextOrigin=f.origin();
  assert.deepEqual(nextOrigin,[oldOrigin[0]+1,oldOrigin[1]+1],'quad placement must really move');
  assert.equal(next.text_rasters,first.text_rasters,'integer translation must reuse unchanged local raster');
  assert.equal(next.atlas_uploads,first.atlas_uploads,'integer translation must avoid another upload');
  assert.equal(f.paints.length,paintBefore,'real painter must not run on a valid cache hit');
 }finally{f.dispose();}
});

const changes=[
 ['fractional pixel phase',n=>({...n,rect:{...n.rect,x:n.rect.x+.125}})],
 ['independent clip edge',n=>({...n,clip:{x:11,y:25,width:39,height:20}})],
 ['wrapped content width',n=>({...n,rect:{...n.rect,width:20},style:{...n.style,wrap:'word'}})],
 ['ellipsis width',n=>({...n,rect:{...n.rect,width:10},style:{...n.style,overflow:'ellipsis'}})],
 ['content height',n=>({...n,rect:{...n.rect,height:19}})],
 ['padding',n=>({...n,style:{...n.style,padding:{left:1}}})],
 ['font family',n=>({...n,style:{...n.style,font_family:'Other Sans'}})],
 ['font weight',n=>({...n,style:{...n.style,font_weight:700}})],
 ['font size',n=>({...n,style:{...n.style,font_size:5}})],
 ['line height',n=>({...n,style:{...n.style,line_height:1.8}})],
 ['letter spacing',n=>({...n,style:{...n.style,letter_spacing:.1}})],
 ['text color',n=>({...n,style:{...n.style,color:[1,0,0,1]}})],
 ['text shadow',n=>({...n,style:{...n.style,text_shadow:{offset_x:1,offset_y:1,color:[0,0,0,1]}}})],
 ['content',n=>({...n,text:'Different text'})],
];
for(const [name,change]of changes)test(`${name} invalidates actual text raster`,()=>{
 const f=fixture();try{const a=f.base(),before=f.draw(a),after=f.draw(change(a));assert(after.text_rasters>before.text_rasters);assert(after.atlas_uploads>before.atlas_uploads);}finally{f.dispose();}
});

for(const [name,override,mutate]of [
 ['selection',{text:'Typed',text_edit:{focused:true,selection_start:0,selection_end:0}},n=>({...n,text_edit:{...n.text_edit,selection_end:2}})],
 ['caret position',{text:'Typed',text_edit:{focused:true,selection_start:0,selection_end:0}},n=>({...n,text_edit:{...n.text_edit,selection_start:2,selection_end:2}})],
 ['focus',{},n=>({...n,text_edit:{...n.text_edit,focused:true}})],
 ['composition underline',{text:'Typed',text_edit:{focused:true,selection_start:0,selection_end:0,composing:false}},n=>({...n,text_edit:{...n.text_edit,composing:true}})],
 ['placeholder',{},n=>({...n,placeholder:'New placeholder'})],
])test(`text input ${name} invalidates`,()=>{
 const f=fixture();try{const a={...f.base(),kind:'text_input',text:'',placeholder:'Type here',text_edit:{focused:false,selection_start:0,selection_end:0},...override},before=f.draw(a),after=f.draw(mutate(a));assert(after.text_rasters>before.text_rasters);assert(after.atlas_uploads>before.atlas_uploads);}finally{f.dispose();}
});

test('rounded shadow crop changes invalidate',()=>{
 const f=fixture();try{const a={...f.base(),style:{...f.base().style,border_radius:2,text_shadow:{offset_x:1,offset_y:-1,color:[0,0,0,1]}}},before=f.draw(a),after=f.draw({...a,style:{...a.style,border_radius:4}});assert(after.text_rasters>before.text_rasters);}finally{f.dispose();}
});

test('viewport height and DPR changes invalidate',()=>{
 const f=fixture();try{const a=f.base(),before=f.draw(a);f.resize(200,120);const resized=f.draw(a);assert(resized.text_rasters>before.text_rasters);f.resize(200,120,2);const scaled=f.draw(a);assert(scaled.text_rasters>resized.text_rasters);}finally{f.dispose();}
});

test('fallback font family invalidates independently of node fields',()=>{
 const f=fixture();try{const a=f.base(),before=f.draw(a);f.canvas.setFont('Other fallback');const after=f.draw(a);assert(after.text_rasters>before.text_rasters);}finally{f.dispose();}
});

test('duplicate-id slots do not reuse another label content',()=>{
 const f=fixture();try{const a=f.base(),b={...f.base(),text:'Other label',rect:{...a.rect,y:50}},before=f.draw([a,b]);assert.equal(before.text_rasters,2);const after=f.draw([b,a]);assert.equal(after.text_rasters,4);}finally{f.dispose();}
});

test('context loss forces a new raster/upload even with identical text',()=>{
 const f=fixture();try{const a=f.base(),before=f.draw(a);f.gpu.contextLost();const after=f.draw(a);assert(after.text_rasters>before.text_rasters);assert(after.atlas_uploads>before.atlas_uploads);}finally{f.dispose();}
});
