import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCursor,cursorRect,createUiCursorHost} from './ui-cursor.mjs';
const image={kind:'image',asset:'texture://point',width:17,height:19,hotspot_x:3,hotspot_y:5,filter:'nearest'};

function surface(){
 const handlers=new Map(),calls=[];const style={cursor:'crosshair'};
 const target={width:1280,height:720,style,getBoundingClientRect:()=>({left:10,top:20,width:640,height:360}),
  addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:(name)=>handlers.delete(name)};
 const context={clearRect:(...a)=>calls.push(['clear',...a]),drawImage:(...a)=>calls.push(['draw',...a]),imageSmoothingEnabled:true};
 const layer={width:0,height:0,style:{},getContext:()=>context};
 const focusHandlers=new Map();
 const focus={addEventListener:(name,fn)=>focusHandlers.set(name,fn),removeEventListener:(name)=>focusHandlers.delete(name)};
 const emit=(x,y,type='mouse')=>handlers.get('pointermove')?.({clientX:x,clientY:y,pointerType:type});
 return {target,layer,context,calls,handlers,focus,focusHandlers,emit};
}

test('strict shape and explicit default/hidden/image',()=>{
 assert.equal(validateCursor(null).kind,'default');assert.deepEqual(validateCursor(image),image);
 for(const bad of [{kind:'hand'},{kind:'hidden',asset:'x'},{...image,width:0},{...image,width:17.5},
  {...image,hotspot_y:19},{...image,hotspot_x:-1},{...image,width:513},{...image,filter:'cubic'},
  {...image,unknown:true},{...image,asset:''},{...image,width:NaN}])assert.throws(()=>validateCursor(bad),/UI_CURSOR_INVALID/);
});

test('drawing-buffer hotspot and nearest pixels have no implicit CSS unit conversion',()=>{
 assert.deepEqual(cursorRect(image,{x:128,y:80}),{x:125,y:75,width:17,height:19});
});

test('host uses true pointer/CSS mapping and paints last on passive overlay',async()=>{
 const f=surface(),bitmap={width:17,height:19};
 const host=createUiCursorHost({...f,loadImage:async()=>bitmap,onError:error=>{throw error;}});
 host.update(image);f.emit(74,60);await Promise.resolve();host.render();
 assert.equal(f.target.style.cursor,'none');assert.equal(f.context.imageSmoothingEnabled,false);
 assert.deepEqual(f.calls.filter(c=>c[0]==='draw').at(-1),['draw',bitmap,125,75,17,19]);
 assert.equal(host.report().visible,true);assert.equal(f.layer.style.pointerEvents,'none');
 host.dispose();assert.equal(f.target.style.cursor,'crosshair');assert.equal(f.handlers.size,0);
});

test('outside/blur/touch/default restore host cursor and never inject input',async()=>{
 const f=surface(),host=createUiCursorHost({...f,loadImage:async()=>({}),onError:error=>{throw error;}});
 host.update(image);f.emit(74,60);await Promise.resolve();host.render();
 f.emit(-1,60);assert.equal(f.target.style.cursor,'crosshair');assert.equal(host.report().visible,false);
 f.emit(74,60);f.focusHandlers.get('blur')();assert.equal(f.target.style.cursor,'crosshair');
 f.emit(74,60,'touch');assert.equal(host.report().visible,false);
 host.update({kind:'hidden'});f.emit(74,60);assert.equal(f.target.style.cursor,'none');
 host.update({kind:'default'});assert.equal(f.target.style.cursor,'crosshair');host.dispose();
});

test('late image load cannot revive a cleared/replaced cursor',async()=>{
 const f=surface();let resolve;const pending=new Promise(r=>{resolve=r;});
 const host=createUiCursorHost({...f,loadImage:()=>pending,onError:error=>{throw error;}});
 host.update(image);f.emit(74,60);host.update({kind:'default'});resolve({});await Promise.resolve();host.render();
 assert.equal(f.target.style.cursor,'crosshair');assert.equal(host.report().visible,false);
 assert.equal(f.calls.some(c=>c[0]==='draw'),false);host.dispose();
});

test('invalid declaration is atomic and resize uses current pixel geometry',async()=>{
 const f=surface(),host=createUiCursorHost({...f,loadImage:async()=>({}),onError:error=>{throw error;}});
 host.update(image);f.emit(74,60);await Promise.resolve();assert.throws(()=>host.update({...image,height:0}));
 f.target.width=2560;f.target.height=1440;f.emit(74,60);host.render();
 assert.equal(f.layer.width,2560);assert.equal(f.layer.height,1440);
 assert.equal(host.report().mode,'image');assert.equal(host.report().rect.x,253);host.dispose();
});
