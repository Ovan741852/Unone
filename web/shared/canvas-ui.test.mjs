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
 r.setTree({children:[button,{kind:'image',id:'cover',rect,asset:'cover'}]});assert.equal(r.hitTest(10,10).action,null);assert.equal(r.pointer({kind:'down',x:10,y:10}),false);
 assert.equal(r.pointer({kind:'down',pointerId:2,x:90,y:90}),false);
});
test('semantic slider stays in hierarchy while pointer input passes through to settings logic',()=>{
 const r=createUiPointerRouter();const slider={kind:'slider',id:'settings_music_track_widget',action:'Setting_music',rect};
 r.setTree({children:[slider]});assert.deepEqual(r.hitTest(10,10),{nodeId:slider.id,action:null});
 assert.equal(r.pointer({kind:'down',x:10,y:10}),false);assert.deepEqual(r.capturedPointers,[]);
});
test('Canvas has transparent buttons, draws loaded images in leaf order and reports failures',async()=>{
 const calls=[],ctx={setTransform(){},clearRect(){},save(){},restore(){},beginPath(){},rect(){},clip(){},drawImage:()=>calls.push('image'),fillText:t=>calls.push(t),measureText:t=>({width:t.length*10})};
 const canvas={width:100,height:100,getContext:()=>ctx};const ui=createCanvasUi(canvas,{resolveAsset:async()=>({width:10,height:10})});
 const s={ui:{children:[{kind:'image',id:'bg',rect,asset:'x'}, {...button,text:'中文'}]}};ui.draw(s);await new Promise(setImmediate);calls.length=0;ui.draw(s);
 assert.deepEqual(calls,['image','中文']);assert.equal(ui.report().assets[0].state,'ready');ui.dispose();
 assert.throws(()=>flattenUi({children:[{kind:'scroll'}]}),/UNSUPPORTED/);
});
test('explicit font size stays consistent across control heights and scales with canvas pixels',()=>{
 const sizes=[],ctx={setTransform(){},clearRect(){},save(){},restore(){},beginPath(){},rect(){},clip(){},fillText(){},measureText:t=>({width:t.length}),set font(v){sizes.push(Number.parseFloat(v));}};
 const canvas={width:100,height:50,getContext:()=>ctx},ui=createCanvasUi(canvas);
 const tree={ui:{children:[
  {kind:'button',id:'tall',rect:{x:0,y:20,width:100,height:80},text:'Start',fontSize:12},
  {kind:'button',id:'short',rect:{x:0,y:0,width:100,height:40},text:'Start',fontSize:12},
 ]}};
 ui.draw(tree,{width:100,height:50,dpr:1});assert.deepEqual(sizes,[12,12,12,12]);
 sizes.length=0;ui.draw(tree,{width:100,height:50,dpr:2});assert.deepEqual(sizes,[24,24,24,24]);ui.dispose();
});

test('combobox captures the complete field and keeps capture when expanded changes',()=>{
 const events=[],r=createUiPointerRouter({onAction:e=>events.push(e)});
 const field={kind:'combobox',id:'quality',text:'High',action:'ToggleQuality',expanded:false,rect};
 r.setTree({children:[field]});
 for(const x of [1,25,49]){
  assert.equal(r.pointer({kind:'down',x,y:10}),true);
  r.setTree({children:[{...field,expanded:true}]});
  assert.equal(r.pointer({kind:'up'}),true);
 }
 assert.deepEqual(events.map(e=>e.phase),['down','up','down','up','down','up']);
 r.setTree({children:[field,{...button,action:'SelectLow'}]});
 assert.equal(r.hitTest(10,10).action,'SelectLow');
 r.pointer({kind:'down',x:10,y:10});r.setTree({children:[]});
 assert.equal(events.at(-1).phase,'cancel');r.pointer({kind:'up'});
});
