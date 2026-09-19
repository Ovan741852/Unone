import test from 'node:test';import assert from 'node:assert/strict';
import {createUiPointerRouter,createCanvasUi,flattenUi} from './canvas-ui.mjs';
import {createHostInput} from './host-input.js';
const rect={x:0,y:0,width:50,height:50},button={kind:'button',id:'open',rect,text:'',action:'OpenChest'};
test('lifecycle reset drops queued taps and captures across multiple pointers',()=>{
 const input=createHostInput(),r=createUiPointerRouter({onAction:e=>input.queueActionTransition(e.action,e.phase==='down')});
 r.setTree({children:[button]});
 r.pointer({kind:'down',pointerId:1,x:1,y:1});r.pointer({kind:'down',pointerId:2,x:1,y:1});
 r.releaseAll();input.releaseAll();
 assert.deepEqual(r.capturedPointers,[]);assert.deepEqual(input.consumeFrame().actions,{});
 r.pointer({kind:'down',pointerId:1,x:1,y:1});assert.equal(input.consumeFrame().actions.OpenChest,true);
});
test('hold down/up survive a single display frame without click-through',()=>{
 const input=createHostInput(),events=[];const r=createUiPointerRouter({onAction:e=>{events.push(e);input.queueActionTransition(e.action,e.phase==='down');}});
 r.setTree({children:[{kind:'image',id:'background',rect,asset:'x'},button]});
 assert.equal(r.pointer({kind:'down',x:10,y:10}),true);assert.equal(input.consumeFrame().actions.OpenChest,true);
 assert.equal(input.consumeFrame().actions.OpenChest,true);assert.equal(r.pointer({kind:'up',x:99,y:99}),true);assert.equal(input.consumeFrame().actions.OpenChest,undefined);
 r.pointer({kind:'down',x:10,y:10});r.pointer({kind:'up',x:10,y:10});assert.equal(input.consumeFrame().actions.OpenChest,true);assert.equal(input.consumeFrame().actions.OpenChest,undefined);assert.equal(events.length,4);
});
test('reverse leaf order, cancellation and multiple fingers share action safely',()=>{
 const events=[],r=createUiPointerRouter({onAction:e=>events.push(e)});r.setTree({children:[{kind:'component',id:'c',children:[button]}]});
 r.pointer({kind:'down',pointerId:1,x:2,y:2});r.pointer({kind:'down',pointerId:2,x:2,y:2});r.pointer({kind:'up',pointerId:1});assert.equal(events.length,1);
 r.setTree({children:[]});assert.equal(events[1].phase,'cancel');assert.equal(r.pointer({kind:'move',pointerId:2,x:90,y:90}),true);assert.equal(r.pointer({kind:'up',pointerId:2}),true);assert.equal(r.capturedPointers.length,0);
 r.setTree({children:[button,{kind:'image',id:'cover',rect,asset:'cover'}]});assert.equal(r.hitTest(10,10).action,null);assert.equal(r.pointer({kind:'down',x:10,y:10}),true);
 assert.equal(r.pointer({kind:'down',pointerId:2,x:90,y:90}),false);
});
test('Canvas has transparent buttons, draws loaded images in leaf order and reports failures',async()=>{
 const calls=[],ctx={setTransform(){},clearRect(){},save(){},restore(){},beginPath(){},rect(){},clip(){},drawImage:()=>calls.push('image'),fillText:t=>calls.push(t),measureText:t=>({width:t.length*10})};
 const canvas={width:100,height:100,getContext:()=>ctx};const ui=createCanvasUi(canvas,{resolveAsset:async()=>({width:10,height:10})});
 const s={ui:{children:[{kind:'image',id:'bg',rect,asset:'x'}, {...button,text:'中文'}]}};ui.draw(s);await new Promise(setImmediate);calls.length=0;ui.draw(s);
 assert.deepEqual(calls,['image','中文']);assert.equal(ui.report().assets[0].state,'ready');ui.dispose();
 assert.throws(()=>flattenUi({children:[{kind:'scroll'}]}),/UNSUPPORTED/);
});
