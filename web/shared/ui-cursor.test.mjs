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
test('completion waits only for a visible requested custom cursor and reports failed artwork',async()=>{
 const f=surface();let resolve;const pending=new Promise(yes=>{resolve=yes;});
 const errors=[],host=createUiCursorHost({...f,loadImage:()=>pending,onError:error=>errors.push(error)});
 assert.equal(host.update(image).status,'completed','no pointer requires no cursor paint');f.emit(74,60);
 assert.equal(host.update(image).reason,'cursor_assets_pending');f.emit(-1,60);assert.equal(host.update(image).status,'completed');f.emit(74,60);
 resolve({width:17,height:19});await Promise.resolve();assert.equal(host.update(image).status,'completed');host.dispose();
 const failed=surface(),bad=createUiCursorHost({...failed,loadImage:()=>Promise.reject(Error('cursor unavailable')),onError:error=>errors.push(error)});
 failed.emit(74,60);bad.update(image);await Promise.resolve();await Promise.resolve();assert.equal(bad.update(image).reason,'cursor_diagnostics');assert.equal(errors.length,1);bad.dispose();
});
test('cursor readiness waits for current visible artwork, ignores retired loads and rejects disposal',async()=>{
 const f=surface(),loads=new Map(),host=createUiCursorHost({...f,loadImage:id=>new Promise(resolve=>loads.set(id,resolve)),onError() {}});
 f.emit(74,60);host.update(image);let settled=false;const waiting=host.ready().then(()=>settled=true);await Promise.resolve();assert.equal(settled,false);
 host.update({...image,asset:'texture://new'});loads.get(image.asset)({width:17,height:19});await Promise.resolve();assert.equal(settled,false,'retired artwork cannot unblock current cursor');
 loads.get('texture://new')({width:17,height:19});await waiting;assert.equal(settled,true);
 host.update({...image,asset:'texture://pending'});const cancelled=assert.rejects(host.ready(),/UI_CURSOR_DISPOSED/);host.dispose();await cancelled;
});
test('broker-ready cursor paints synchronously and unchanged declarations reuse one lease',()=>{
 const f=surface(),bitmap={width:17,height:19,close(){throw Error('shared image closed');}};let acquired=0,released=0;
 const broker={acquire(id){assert.equal(id,image.asset);acquired++;return{state:'ready',image:bitmap,error:null,promise:Promise.resolve(bitmap),release(){released++;}};}};
 const host=createUiCursorHost({...f,getImageAssets:()=>broker,loadImage(){throw Error('duplicate legacy loader');},onError:error=>{throw error;}});f.emit(74,60);
 assert.equal(host.update(image).status,'completed');assert.equal(f.calls.filter(c=>c[0]==='draw').at(-1)[1],bitmap);host.update({...image,filter:'linear'});assert.equal(acquired,1);assert.equal(host.report().shared_image_leases,1);
 assert.throws(()=>host.update({...image,width:0}),/UI_CURSOR_INVALID/);assert.equal(released,0,'invalid declaration must not retire the current owner');host.update({kind:'default'});assert.equal(released,1);host.dispose();assert.equal(released,1);
});
test('broker cursor changes/invalidation/disposal release their generations and ignore late completions',async()=>{
 const f=surface(),entries=new Map(),leases=[],errors=[];
 const broker={acquire(asset){let state=entries.get(asset);if(!state){let resolve;const promise=new Promise(done=>{resolve=done;});state={state:'loading',image:null,promise,resolve};entries.set(asset,state);}let released=false;const lease={get state(){return released?'error':state.state;},get image(){return released?null:state.image;},get error(){return released?Error('released'):null;},promise:state.promise,releases:0,release(){if(released)return;released=true;lease.releases++;}};leases.push(lease);return lease;}};
 const host=createUiCursorHost({...f,getImageAssets:()=>broker,onError:e=>errors.push(e)});f.emit(74,60);assert.equal(host.update(image).reason,'cursor_assets_pending');
 host.update({...image,asset:'texture://new'});assert.equal(leases[0].releases,1);const old=entries.get(image.asset);old.image={};old.state='ready';old.resolve(old.image);await Promise.resolve();await Promise.resolve();assert.equal(f.calls.filter(c=>c[0]==='draw').length,0,'retired image cannot paint current cursor');
 const next=entries.get('texture://new'),bitmap={width:17,height:19,close(){throw Error('shared close');}};next.image=bitmap;next.state='ready';next.resolve(bitmap);await Promise.resolve();assert.equal(host.render().status,'completed');
 assert.equal(host.invalidateAssets().status,'completed','broker cached ready generation reattaches synchronously');assert.equal(leases[1].releases,1);assert.equal(leases.length,3);host.dispose();host.dispose();assert.equal(leases[2].releases,1);assert.deepEqual(errors,[]);
});
test('broker errors are synchronous diagnostics and disposed pending leases cannot revive the cursor',async()=>{
 const f=surface(),errors=[],error=Error('cursor shared failure');let released=0;
 const failedBroker={acquire(){return{state:'error',image:null,error,promise:Promise.reject(error),release(){released++;}};}};
 const host=createUiCursorHost({...f,getImageAssets:()=>failedBroker,onError:e=>errors.push(e)});f.emit(74,60);assert.equal(host.update(image).reason,'cursor_diagnostics');await assert.rejects(host.ready(),/UI_CURSOR_ASSET_FAILED/);assert.equal(errors.length,1);host.dispose();assert.equal(released,1);
 const g=surface();let resolve;const pending=new Promise(done=>{resolve=done;}),lease={state:'loading',image:null,promise:pending,release(){released++;}},pendingBroker={acquire:()=>lease},other=createUiCursorHost({...g,getImageAssets:()=>pendingBroker,onError:e=>errors.push(e)});g.emit(74,60);other.update(image);other.dispose();resolve({width:17,height:19});await Promise.resolve();await Promise.resolve();assert.equal(g.calls.filter(c=>c[0]==='draw').length,0);assert.equal(released,2);
});
