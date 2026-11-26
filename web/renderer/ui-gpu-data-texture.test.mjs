import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import {createGpuUi} from './ui-gpu.js';
import {createCanvasUi} from '../shared/canvas-ui.mjs';
import {createImageBatchResolver} from '../shared/ui-image-batch.mjs';

const ASSET='data-texture://minimap';
const node=(asset=ASSET)=>({kind:'image',id:'picture',asset,fit:'stretch',rect:{x:0,y:0,width:20,height:20}});

function fixture(textures){
  let scene=null;
  const renderer={autoClear:true,capabilities:{maxTextureSize:4096},getDrawingBufferSize:v=>v.set(100,100),getPixelRatio:()=>1,
    getContext:()=>({isContextLost:()=>false}),getScissorTest:()=>false,getRenderTarget:()=>null,getViewport:v=>v.set(0,0,100,100),
    setRenderTarget(){},setScissorTest(){},setViewport(){},compile(){},properties:{get:()=>({currentProgram:{getUniforms(){}}})},
    initTexture(){},render(s){scene=s;}};
  const gpu=createGpuUi(THREE,renderer,{dataTextures:textures});
  return {gpu,get scene(){return scene;},get drawn(){return scene?.children.find(mesh=>mesh.visible)?.material.uniforms.uiTexture.value??null;},
    draw(nodes,errors=[],batches=new Map()){return gpu.draw({nodes,images:new Map(),batches,scale:1,changed:true,identity:'fixture',hasText:()=>false,imageError:(_,__,error)=>errors.push(error)});}};
}

test('an image-batch quad tint reaches the texture shader as uiColor.rgb while other image quads stay white',()=>{
  const texture=new THREE.DataTexture(new Uint8Array(16),2,2),f=fixture({get:()=>texture});
  try{
    const batch={kind:'image_batch',id:'art',rect:{x:0,y:0,width:100,height:100},quads:[
      {asset:ASSET,rect:{x:0,y:0,width:10,height:10},opacity:.5,tint:[.25,.5,1]},{asset:ASSET,rect:{x:10,y:0,width:10,height:10}}]};
    const errors=[];f.draw([batch,node()],errors,new Map([[batch,createImageBatchResolver().resolve(batch)]]));assert.deepEqual(errors,[]);
    const mesh=f.scene.children.find(m=>m.visible),attribute=mesh.geometry.attributes.uiColor,stride=attribute.data.stride;
    assert.equal(mesh.geometry.instanceCount,3,'both quads and the image share one texture run');
    assert.deepEqual([0,1,2].map(i=>[...attribute.data.array.slice(i*stride+attribute.offset,i*stride+attribute.offset+4)]),[[.25,.5,1,.5],[1,1,1,1],[1,1,1,1]]);
    assert.match(mesh.material.fragmentShader,/texture2D\(uiTexture,vUv\)\*vec4\(vColor\.rgb,1\.0\)\*vColor\.a/);
  }finally{f.gpu.dispose();}
});

test('a UI image names a data texture and draws that very texture, with no file behind it',()=>{
  const texture=new THREE.DataTexture(new Uint8Array(16),2,2);
  const f=fixture({get:id=>id==='minimap'?texture:null});
  try{
    assert.equal(f.gpu.showsDataTextures,true);
    const errors=[];
    assert.equal(f.draw([node()],errors).status??'completed','completed');
    assert.deepEqual(errors,[]);
    assert.equal(f.drawn,texture,'The presenter must sample the runtime texture, so its updates need no new UI tree');
  }finally{f.gpu.dispose();}
});

test('a data texture not set yet draws nothing and reports no image error',()=>{
  const f=fixture({get:()=>null});
  try{
    const errors=[];
    f.draw([node()],errors);
    assert.deepEqual(errors,[]);
    assert.equal(f.drawn,null);
  }finally{f.gpu.dispose();}
});

test('the Canvas UI asks for no file for a data texture and refuses a host that cannot show one',()=>{
  const f=fixture({get:()=>null});
  let resolved=0;
  const canvas=createCanvasUi(null,{getPresenter:()=>f.gpu,resolveAsset:()=>{resolved++;return null;}});
  try{
    canvas.draw({world:{frame:1,ui:{children:[node()]}}});
    assert.equal(resolved,0,'A runtime texture has no asset to resolve');
  }finally{canvas.dispose();f.gpu.dispose();}
  const plain=fixture(null);
  const unsupported=createCanvasUi(null,{getPresenter:()=>plain.gpu,resolveAsset:()=>null});
  try{
    assert.equal(plain.gpu.showsDataTextures,false);
    assert.throws(()=>unsupported.draw({world:{frame:1,ui:{children:[node()]}}}),/UI_DATA_TEXTURE_UNSUPPORTED/);
  }finally{unsupported.dispose();plain.gpu.dispose();}
});
