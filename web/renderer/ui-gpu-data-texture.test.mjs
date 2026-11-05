import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import {createGpuUi} from './ui-gpu.js';
import {createCanvasUi} from '../shared/canvas-ui.mjs';

const ASSET='data-texture://minimap';
const node=(asset=ASSET)=>({kind:'image',id:'picture',asset,fit:'stretch',rect:{x:0,y:0,width:20,height:20}});

function fixture(textures){
  let scene=null;
  const renderer={autoClear:true,capabilities:{maxTextureSize:4096},getDrawingBufferSize:v=>v.set(100,100),getPixelRatio:()=>1,
    getContext:()=>({isContextLost:()=>false}),getScissorTest:()=>false,getRenderTarget:()=>null,getViewport:v=>v.set(0,0,100,100),
    setRenderTarget(){},setScissorTest(){},setViewport(){},compile(){},properties:{get:()=>({currentProgram:{getUniforms(){}}})},
    initTexture(){},render(s){scene=s;}};
  const gpu=createGpuUi(THREE,renderer,{dataTextures:textures});
  return {gpu,get drawn(){return scene?.children.find(mesh=>mesh.visible)?.material.uniforms.uiTexture.value??null;},
    draw(nodes,errors=[]){return gpu.draw({nodes,images:new Map(),batches:new Map(),scale:1,changed:true,identity:'fixture',hasText:()=>false,imageError:(_,__,error)=>errors.push(error)});}};
}

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
