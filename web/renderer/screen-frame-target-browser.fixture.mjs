import * as THREE from '../vendor/three/three.module.js';
import {createScreenFrameTarget} from './screen-frame-target.js';
const W=128,H=96;
function makeRenderer(depth,alpha,premultipliedAlpha,space,clearAlpha){const canvas=document.createElement('canvas');document.body.append(canvas);
 const renderer=new THREE.WebGLRenderer({canvas,alpha,premultipliedAlpha,depth,antialias:false,preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setSize(W,H,false);renderer.outputColorSpace=space;renderer.setClearColor(0x3a274c,clearAlpha);return renderer;}
function mesh(scene,color,z,opacity,width=1,height=1){const material=new THREE.MeshBasicMaterial({color,transparent:opacity<1,opacity,depthTest:true,depthWrite:opacity===1});const result=new THREE.Mesh(new THREE.PlaneGeometry(width,height),material);result.position.z=z;scene.add(result);return result;}
function render(renderer,depth,staged){const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,20);camera.position.z=5;
 mesh(scene,0x274dd5,1,1,1.3,1.4);mesh(scene,0xb1a33f,0,1,1.7,.9);mesh(scene,0xdf3047,2,.37,.8,1);
 const ui=new THREE.Scene(),bar=mesh(ui,0xe0bd80,4,.64,1.5,.2);bar.position.y=-.75;
 const transaction=staged?createScreenFrameTarget(THREE,renderer):null;
 if(transaction){const start=transaction.begin({width:W,height:H,depth});if(start.status!=='completed')throw Error(JSON.stringify(start));}
 renderer.autoClear=true;renderer.render(scene,camera);renderer.autoClear=false;renderer.render(ui,camera);
 if(transaction){const end=transaction.commit();if(end.status!=='completed')throw Error(JSON.stringify(end));}
 const gl=renderer.getContext(),pixels=new Uint8Array(W*H*4);gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
 const out={pixels,attrs:gl.getContextAttributes(),error:gl.getError(),metrics:transaction?.metrics()??null};transaction?.dispose();scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});ui.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});renderer.dispose();renderer.domElement.remove();return out;}
window.runScreenFrameMatrix=()=>{const out=[];for(const alpha of [false,true])for(const premul of [false,true])for(const space of [THREE.SRGBColorSpace,THREE.LinearSRGBColorSpace])for(const clearAlpha of [1,.25]){
 const a=render(makeRenderer(true,alpha,premul,space,clearAlpha),true,false),b=render(makeRenderer(false,alpha,premul,space,clearAlpha),true,true);let changed=0,max=0;
 for(let i=0;i<a.pixels.length;i++){const d=Math.abs(a.pixels[i]-b.pixels[i]);if(d)changed++;max=Math.max(max,d);}
 out.push({alpha,premul,space,clearAlpha,changed,max,errors:[a.error,b.error],candidate:b.attrs,metrics:b.metrics});}return out;};
// Test the compositor-visible image across real RAFs with the production
// preserveDrawingBuffer=false attribute. readPixels cannot prove this case.
window.startAtomicFrameTest=()=>{const canvas=document.createElement('canvas');canvas.id='atomic';document.body.append(canvas);
 const renderer=new THREE.WebGLRenderer({canvas,alpha:false,antialias:false,depth:false,preserveDrawingBuffer:false});renderer.setPixelRatio(1);renderer.setSize(320,180,false);renderer.setClearColor(0x251840,1);
 const camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,20);camera.position.z=5;const first=new THREE.Scene(),second=new THREE.Scene();mesh(first,0x22bb55,1,1,1.5,1.2);mesh(second,0xdd3344,1,1,1.5,1.2);
 const tx=createScreenFrameTarget(THREE,renderer);window.atomicTest={renderer,tx,first,second,camera,canvas};
 const begin=tx.begin({width:320,height:180,depth:true});if(begin.status!=='completed')throw Error(JSON.stringify(begin));renderer.autoClear=true;renderer.render(first,camera);const committed=tx.commit();if(committed.status!=='completed')throw Error(JSON.stringify(committed));return {begin,committed,attrs:renderer.getContext().getContextAttributes()};};
window.abortAtomicFrame=()=>{const {renderer,tx,second,camera}=window.atomicTest;const begin=tx.begin({width:320,height:180,depth:true});if(begin.status!=='completed')throw Error(JSON.stringify(begin));renderer.render(second,camera);return tx.abort();};
window.finishAtomicFrame=()=>{const {renderer,tx,second,camera}=window.atomicTest;const begin=tx.begin({width:320,height:180,depth:false});if(begin.status!=='completed')throw Error(JSON.stringify(begin));renderer.render(second,camera);return {outcome:tx.commit(),metrics:tx.metrics()};};
