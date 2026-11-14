import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Exercise the production resize closure (Ovan741852/Unone#2), not a copy of it.
const source=await readFile(new URL('./three.js',import.meta.url),'utf8');
const start=source.indexOf('  let resizedTo = null;'),end=source.indexOf('  function textureFor(',start);
assert(start>=0&&end>start,'production resize markers');
const resizeSource=source.slice(start,end);

// A canvas that counts every drawing-buffer write, and a renderer that sizes it as three.js does.
function fixture({clientWidth=926,clientHeight=428,ratio=1.5}={}){
  const writes={width:0,height:0},canvas={clientWidth,clientHeight,_width:300,_height:150};
  Object.defineProperty(canvas,'width',{get(){return this._width;},set(value){writes.width++;this._width=value;}});
  Object.defineProperty(canvas,'height',{get(){return this._height;},set(value){writes.height++;this._height=value;}});
  const calls={setSize:0,viewports:[]};
  const renderer={_ratio:ratio,getPixelRatio(){return this._ratio;},
    setPixelRatio(value){this._ratio=value;this.setSize(this._w??1,this._h??1,false);},
    setSize(width,height){calls.setSize++;this._w=width;this._h=height;canvas.width=Math.floor(width*this._ratio);canvas.height=Math.floor(height*this._ratio);this.setViewport(0,0,width,height);},
    setViewport(x,y,width,height){calls.viewports.push([x,y,width,height]);}};
  const camera={position:{},updateProjectionMatrix(){camera.updates=(camera.updates??0)+1;}};
  const visibleSize=world=>({width:(world.camera?.view_height??10)*world.__aspect,height:world.camera?.view_height??10});
  const resize=new Function('canvas','renderer','camera','visibleSize',`${resizeSource}\nreturn resize;`)(canvas,renderer,camera,visibleSize);
  return {resize,canvas,renderer,camera,writes,calls};
}
const world=(x=0,zoom=1)=>({camera:{position:{x,y:2},view_height:10,zoom}});

test('a fixed size sizes the drawing buffer once, not every frame',()=>{
  const f=fixture();
  for(let i=0;i<600;i++)f.resize(world(i));
  assert.deepEqual(f.writes,{width:1,height:1},'only the first draw writes canvas.width/height');
  assert.equal(f.calls.setSize,1);
  assert.equal(f.canvas.width,Math.floor(926*1.5));assert.equal(f.canvas.height,Math.floor(428*1.5));
  // The viewport is still reset every frame, and the camera follows the world without any resize.
  assert.equal(f.calls.viewports.length,600);
  assert.deepEqual(f.calls.viewports.at(-1),[0,0,926,428]);
  assert.equal(f.camera.updates,600);assert.equal(f.camera.position.x,599);assert.equal(f.camera.position.y,2);
  assert.ok(Math.abs(f.camera.right-f.camera.left-10*926/428)<1e-9);
});

test('a new CSS size, pixel ratio or buffer resizes again',()=>{
  const f=fixture();
  f.resize(world());f.resize(world());
  assert.equal(f.calls.setSize,1);
  f.canvas.clientWidth=428;f.canvas.clientHeight=926;f.resize(world());
  assert.equal(f.calls.setSize,2,'a CSS size change (rotation)');
  assert.deepEqual([f.canvas.width,f.canvas.height],[Math.floor(428*1.5),Math.floor(926*1.5)]);
  f.renderer._ratio=2;f.resize(world());
  assert.equal(f.calls.setSize,3,'a pixel ratio change, whoever set it');
  assert.deepEqual([f.canvas.width,f.canvas.height],[856,1852]);
  f.canvas._width=300;f.resize(world());
  assert.equal(f.calls.setSize,4,'a buffer someone else rewrote (a restored context) is sized back');
  f.resize(world());f.resize(world());
  assert.equal(f.calls.setSize,4,'and then stays');
});
