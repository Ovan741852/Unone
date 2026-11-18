import test from 'node:test';import assert from 'node:assert/strict';import {createUiFrameWait} from './ui-frame-wait.mjs';
class Elem{constructor(){this.dataset={};this.style={};this.children=[];this.handlers={};this.hidden=false;}append(...e){this.children.push(...e)}setAttribute(){}addEventListener(k,f){this.handlers[k]=f}remove(){this.removed=true}}
function fixture(){const body=new Elem(),listeners=new Map(),timers=new Map(),calls=[];let seq=0;
 const doc={body,createElement:()=>new Elem()},win={addEventListener(k,f){listeners.set(k,f)},removeEventListener(k){listeners.delete(k)}};
 const wait=createUiFrameWait({document:doc,window:win,onEnter:()=>calls.push('enter'),onLeave:()=>calls.push('leave'),onRetry:()=>calls.push('retry'),onReload:()=>calls.push('reload'),schedule:f=>(timers.set(++seq,f),seq),cancel:id=>timers.delete(id)});
 return {wait,body,listeners,timers,calls};}
test('pending blocks gameplay keys, preserves an existing IME composition, and cancels held state once',()=>{const f=fixture();f.wait.show();f.wait.show();assert.deepEqual(f.calls,['enter']);
 let prevent=0,stop=0;f.listeners.get('keydown')({preventDefault(){prevent++},stopImmediatePropagation(){stop++}});assert.deepEqual([prevent,stop],[1,1]);
 f.listeners.get('keydown')({isComposing:true,preventDefault(){prevent++},stopImmediatePropagation(){stop++}});assert.deepEqual([prevent,stop],[1,1]);
 f.wait.hide();f.wait.hide();assert.deepEqual(f.calls,['enter','leave']);assert.equal(f.timers.size,0);f.wait.dispose();assert.equal(f.listeners.size,0);});
test('long pending exposes retry/reload without pretending failure, retry starts fresh timeout',()=>{const f=fixture();f.wait.show();[...f.timers.values()][0]();assert.equal(f.wait.report().mode,'delayed');
 const root=f.body.children[0],panel=root.children[0],retry=panel.children[1],reload=panel.children[2];assert.equal(retry.hidden,false);retry.handlers.click();assert.equal(f.wait.report().mode,'pending');assert.equal(retry.hidden,true);assert.deepEqual(f.calls,['enter','retry']);
 f.wait.show('error','network');assert.equal(f.wait.report().mode,'error');assert.equal(reload.hidden,false);reload.handlers.click();assert.deepEqual(f.calls,['enter','retry','reload']);f.wait.dispose();});
test('labels are configurable and composition final input remains admitted without focusing the overlay',()=>{
 const body=new Elem(),listeners=new Map(),labels={loading:'載入中',delayed:'請稍候',error:'連線失敗',retry:'重試',reload:'重新進入'};
 const doc={body,createElement:()=>new Elem()},win={addEventListener(k,f){listeners.set(k,f)},removeEventListener(k){listeners.delete(k)}};
 const wait=createUiFrameWait({document:doc,window:win,labels,isComposing:()=>true,schedule:()=>1,cancel(){}});wait.show();
 const panel=body.children[0].children[0];assert.equal(panel.children[0].textContent,'載入中');
 let prevented=0,stopped=0;listeners.get('beforeinput')({type:'beforeinput',target:{dataset:{unoneTextInput:''}},inputType:'insertText',preventDefault(){prevented++},stopImmediatePropagation(){stopped++}});
 assert.deepEqual([prevented,stopped],[0,0]);panel.children[1].handlers.pointerdown({preventDefault(){prevented++}});assert.equal(prevented,1);
 wait.show('error','technical detail');assert.equal(panel.children[0].textContent,'連線失敗');wait.dispose();
 assert.throws(()=>createUiFrameWait({document:doc,window:win,labels:{...labels,retry:''}}),/UI_FRAME_WAIT_LABEL_INVALID/);
});
