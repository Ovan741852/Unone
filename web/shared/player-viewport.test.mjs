import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the official player's own viewport code (web/player/main.js), not a copy of it.
const source=await readFile(new URL('../player/main.js',import.meta.url),'utf8');
const start=source.indexOf('// The player\'s pixel ratio for the drawing buffer'),end=source.indexOf('function acceptSnapshot(',start);
assert(start>=0&&end>start,'production viewport markers');
const code=source.slice(start,end);

// Values made inside the sandbox have its prototypes: compare plain copies.
const plain=value=>JSON.parse(JSON.stringify(value));

function fixture({devicePixelRatio=1,rendererRatio=null}={}){
 const frames=[],requests=[],fits=[],ratios=[];
 const context={
  readSafeArea:()=>[0,0,0,0],snapshot:{world:{}},startupAbort:{signal:{aborted:false}},window:{devicePixelRatio},canvas:{clientWidth:800,clientHeight:600},
  renderer:rendererRatio===null?null:{ratio:rendererRatio,pixelRatio(){return this.ratio;},setPixelRatio(value){ratios.push(value);this.ratio=value;}},
  requestAnimationFrame:callback=>frames.push(callback),fitStage:()=>fits.push(true),
  backend:{request:command=>{requests.push(command);return Promise.resolve({world:{}});}},acceptSnapshot(){},fail(error){throw error;},
 };
 vm.createContext(context);
 const api=vm.runInContext(`(()=>{${code}\nreturn {physicalViewport,followPixelRatio,viewportChanged,sendViewport,
  setApplied:value=>{appliedPixelRatio=value;},setSent:value=>{sentViewport=value;},state:()=>({appliedPixelRatio,sentViewport,viewportQueued})};})()`,context);
 const flush=()=>{for(const callback of frames.splice(0))callback();};
 return {context,api,frames,requests,fits,ratios,flush};
}

test('a burst of resize events fits the stage each time and tells the runtime once a frame',()=>{
 const f=fixture();f.api.setSent([800,600]);
 f.context.canvas.clientWidth=1000;
 for(let i=0;i<20;i++)f.api.viewportChanged();
 assert.equal(f.fits.length,20,'the stage follows every event');
 assert.equal(f.frames.length,1,'one frame is queued for the runtime');
 f.flush();
 assert.deepEqual(plain(f.requests),[{kind:'viewport',width:1000,height:600}]);
 f.api.viewportChanged();f.flush();
 assert.equal(f.requests.length,1,'a size the runtime already has is not sent again');
 f.context.canvas.clientHeight=700;f.api.viewportChanged();f.flush();
 assert.deepEqual(plain(f.requests.at(-1)),{kind:'viewport',width:1000,height:700});
});

test('the drawing buffer follows the device pixel ratio unless the game chose its own',()=>{
 const f=fixture({devicePixelRatio:1,rendererRatio:1});f.api.setApplied(1);
 f.context.window.devicePixelRatio=2;f.api.followPixelRatio();
 assert.deepEqual(f.ratios,[2],'a zoom or another monitor moves the buffer with it');
 assert.deepEqual(plain(f.api.physicalViewport()),[1600,1200],'and the runtime is told the buffer\'s real size');
 f.context.window.devicePixelRatio=3;f.api.followPixelRatio();
 assert.deepEqual(f.ratios,[2],'capped at 2');
 f.context.renderer.ratio=1.5;f.context.window.devicePixelRatio=1;f.api.followPixelRatio();
 assert.deepEqual(f.ratios,[2],'a ratio a presentation hook set stays');
 assert.deepEqual(plain(f.api.physicalViewport()),[1200,900],'and the runtime is told that one');
});

test('before the renderer exists the player ratio sizes the viewport',()=>{
 const f=fixture({devicePixelRatio:2.5});
 assert.deepEqual(plain(f.api.physicalViewport()),[1600,1200]);
 f.api.followPixelRatio();assert.deepEqual(f.ratios,[]);
});

test('rotation can change only safe-area edges; duplicate events need no backend call',()=>{
 const f=fixture();f.api.setSent([800,600]);
 f.context.readSafeArea=()=>[8,0,0,2];f.api.viewportChanged();f.flush();
 assert.deepEqual(plain(f.requests),[{kind:'safeArea',value:[8,0,0,2]}]);
 f.api.viewportChanged();f.flush();assert.equal(f.requests.length,1);
 f.context.readSafeArea=()=>[0,0,0,0];f.api.viewportChanged();f.flush();
 assert.deepEqual(plain(f.requests.at(-1)),{kind:'safeArea',value:[0,0,0,0]});
});
