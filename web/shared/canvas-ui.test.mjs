import test from 'node:test';import assert from 'node:assert/strict';
import {createUiPointerRouter,createCanvasUi,flattenUi} from './canvas-ui.mjs';
import {createHostInput} from './host-input.js';
const rect={x:0,y:0,width:50,height:50},button={kind:'button',id:'open',rect,text:'',action:'OpenChest'};

test('Canvas detects in-place text, action and clip edits and validates changed batches',()=>{
 const drawn=[],events=[],ctx={setTransform(){},clearRect(){},save(){},restore(){},beginPath(){},rect(){},clip(){},fillText:t=>drawn.push(t),measureText:()=>({width:1})};
 const ui=createCanvasUi({width:100,height:100,getContext:()=>ctx},{onAction:e=>events.push(e)});
 const node={...button,text:'Before',rect:{...rect}},snapshot={ui:{children:[node]}};
 ui.draw(snapshot);node.text='After';node.action='Continue';node.clip={x:20,y:20,width:10,height:10};ui.draw(snapshot);
 assert.deepEqual(drawn,['Before','After']);assert.equal(ui.hitTest(5,5),null);assert.equal(ui.hitTest(25,25).action,'Continue');
 ui.pointer({kind:'down',pointerId:4,x:25,y:25});node.action='Next';ui.draw(snapshot);
 assert.deepEqual(events.map(e=>[e.action,e.phase]),[['Continue','down'],['Continue','cancel']]);assert(ui.pointer({kind:'up',pointerId:4}));
 const batch={kind:'image_batch',id:'batch',rect:{x:0,y:0,width:20,height:20},quads:[{asset:'asset://tile',rect:{x:0,y:0,width:10,height:10}}]};
 snapshot.ui.children=[batch];ui.draw(snapshot);batch.quads[0].rect.width=21;
 assert.throws(()=>ui.draw(snapshot),/UI_IMAGE_BATCH_BOUNDS/);ui.dispose();
 assert.equal(ui.report().nodes,0);assert.equal(ui.report().usage,null);assert.equal(ui.hitTest(25,25),null);
 assert.deepEqual(ui.report().assets,[]);assert.deepEqual(ui.report().diagnostics,[]);assert.throws(()=>ui.draw(snapshot),/UI_DISPOSED/);
});

test('pointer router disposal cancels once and releases nodes and all pointer tails',()=>{
 const actions=[],sliders=[],router=createUiPointerRouter({onAction:e=>actions.push(e),onSlider:e=>sliders.push(e)});
 router.setTree({children:[button,modelSlider()]});router.pointer({kind:'down',pointerId:1,x:1,y:1});router.pointer({kind:'down',pointerId:2,x:30,y:35});
 router.dispose();router.dispose();assert.deepEqual(actions.map(e=>e.phase),['down','cancel']);assert.deepEqual(sliders.map(e=>e.phase),['start','cancel']);
 assert.deepEqual(router.capturedPointers,[]);assert.equal(router.hitTest(1,1),null);assert.equal(router.pointer({kind:'up',pointerId:1}),false);
 assert.equal(router.pointer({kind:'down',x:1,y:1}),false);assert.throws(()=>router.setTree({children:[button]}),/UI_DISPOSED/);
});
test('viewport clips drawing and input without resizing content',()=>{
 const clip={x:10,y:10,width:20,height:20},node={...button,clip,text:'Visible'},r=createUiPointerRouter();
 r.setTree({children:[node]});assert.equal(r.hitTest(5,5),null);assert.equal(r.pointer({kind:'down',x:5,y:5}),false);assert.equal(r.hitTest(15,15).action,'OpenChest');
 assert.throws(()=>flattenUi({children:[{...node,clip:{...clip,width:NaN}}]}),/UI_CLIP_INVALID/);
 const calls=[],ctx={setTransform(){},clearRect(){},save(){calls.push('save')},restore(){calls.push('restore')},beginPath(){},rect(...args){calls.push(args)},clip(){calls.push('clip')},fillText(text){calls.push(text)},measureText:()=>({width:1})};
 const canvas={width:100,height:100,getContext:()=>ctx},ui=createCanvasUi(canvas);
 ui.draw({ui:{children:[node,{...node,id:'outside',rect:{x:80,y:80,width:5,height:5},text:'Offscreen'}]}},{width:100,height:100,dpr:1});
 assert(calls.some(c=>Array.isArray(c)&&c.join(',')==='10,70,20,20'));assert(calls.includes('Visible'));assert(!calls.includes('Offscreen'));
 assert.equal(calls.filter(c=>c==='save').length,calls.filter(c=>c==='restore').length);ui.dispose();
});
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
 r.setTree({children:[button,{kind:'image',id:'cover',rect,asset:'cover'}]});assert.equal(r.hitTest(10,10).action,'OpenChest');assert.equal(r.pointer({kind:'down',x:10,y:10}),true);r.releaseAll();
 assert.equal(r.pointer({kind:'down',pointerId:2,x:90,y:90}),false);
});
test('semantic slider stays in hierarchy while pointer input passes through to settings logic',()=>{
 const r=createUiPointerRouter();const slider={kind:'slider',id:'settings_music_track_widget',action:'Setting_music',rect};
 r.setTree({children:[slider]});assert.deepEqual(r.hitTest(10,10),{nodeId:slider.id,action:null});
 assert.equal(r.pointer({kind:'down',x:10,y:10}),false);assert.deepEqual(r.capturedPointers,[]);
});

const modelSlider=(overrides={})=>({kind:'slider',id:'volume',action:'Volume',text:'50%',rect:{x:10,y:30,width:40,height:20},
 drag:{axis:'horizontal',reverse:false,enabled:true,track_rect:{x:15,y:35,width:30,height:2},hit_rect:{x:8,y:28,width:44,height:24}},...overrides});

test('official slider owns padded visible-track gesture, clamps outside and keeps quick tap edges',()=>{
 const input=createHostInput(),events=[],r=createUiPointerRouter({onSlider:e=>{events.push(e);input.queueSliderInteraction(e);}}),slider=modelSlider();
 r.setTree({children:[slider]});assert.equal(r.hitTest(9,29).sliderDrag,true);
 assert.equal(r.pointer({kind:'down',pointerId:7,x:9,y:29}),true);
 assert.equal(r.pointer({kind:'move',pointerId:7,x:30,y:90}),true);
 assert.equal(r.pointer({kind:'move',pointerId:7,x:60,y:90}),true);
 assert.equal(r.pointer({kind:'up',pointerId:7,x:99,y:99}),true);
 assert.deepEqual(events.map(e=>[e.phase,e.ratio]),[['start',0],['drag',.5],['drag',1],['end',1]]);
 assert.deepEqual([input.consumeFrame().ui_sliders.volume,input.consumeFrame().ui_sliders.volume,input.consumeFrame().ui_sliders.volume],
  [{phase:'start',ratio:0},{phase:'drag',ratio:1},{phase:'end',ratio:1}]);
 assert.equal(input.consumeFrame().ui_sliders,undefined);assert.equal(input.consumeFrame().pointer.down,false);
 r.pointer({kind:'down',x:30,y:36});r.pointer({kind:'up',x:30,y:36});
 assert.equal(input.consumeFrame().ui_sliders.volume.phase,'start');assert.equal(input.consumeFrame().ui_sliders.volume.phase,'end');
});

test('slider capture survives value text but cancels geometry, disabled and removed nodes without world leakage',()=>{
 const events=[],r=createUiPointerRouter({onSlider:e=>events.push(e)}),slider=modelSlider();
 r.setTree({children:[slider]});r.pointer({kind:'down',pointerId:1,x:30,y:35});
 r.setTree({children:[{...slider,text:'60%',style:{color:[1,1,1,1]}}]});assert.equal(events.length,1);
 r.pointer({kind:'down',pointerId:2,x:35,y:35});r.pointer({kind:'move',pointerId:2,x:40,y:35});r.pointer({kind:'up',pointerId:2});assert.equal(events.length,1);
 r.setTree({children:[modelSlider({drag:{...slider.drag,enabled:false}})]});assert.equal(events.at(-1).phase,'cancel');
 assert.equal(r.pointer({kind:'move',pointerId:1,x:99,y:99}),true);assert.equal(r.pointer({kind:'up',pointerId:1}),true);assert.equal(events.length,2);
 assert.equal(r.pointer({kind:'down',pointerId:3,x:30,y:35}),true);r.pointer({kind:'up',pointerId:3});assert.equal(events.length,2);
 r.setTree({children:[slider]});r.pointer({kind:'down',pointerId:4,x:30,y:35});
 r.setTree({children:[modelSlider({drag:{...slider.drag,reverse:true}})]});assert.equal(events.at(-1).phase,'cancel');r.pointer({kind:'up',pointerId:4});
 r.pointer({kind:'down',pointerId:5,x:30,y:35});r.setTree({children:[]});assert.equal(events.at(-1).phase,'cancel');assert.equal(r.pointer({kind:'up',pointerId:5}),true);
 r.setTree({children:[slider]});r.pointer({kind:'down',pointerId:6,x:30,y:35});r.releaseAll();assert.equal(events.at(-1).phase,'cancel');assert.equal(r.pointer({kind:'move',pointerId:6,x:99,y:99}),true);assert.equal(r.pointer({kind:'up',pointerId:6}),true);
});

test('slider uses foreground semantic order and scroll-local geometry with clipping and reverse once',()=>{
 const events=[],r=createUiPointerRouter({onSlider:e=>events.push(e)}),slider=modelSlider(),cover={...button,id:'cover',action:'Cover',rect:slider.rect};
 r.setTree({children:[slider,cover,{kind:'text',id:'caption',rect:slider.rect,text:'Overlay'}]});assert.equal(r.hitTest(30,35).action,'Cover');r.pointer({kind:'down',x:30,y:35});r.pointer({kind:'up'});assert.equal(events.length,0);
 r.setTree({children:[cover,slider]});assert.equal(r.hitTest(30,35).sliderDrag,true);r.pointer({kind:'down',x:30,y:35});r.pointer({kind:'up'});assert.equal(events.length,2);
 const local=modelSlider({rect:{x:5,y:5,width:10,height:60},drag:{axis:'vertical',reverse:true,enabled:true,track_rect:{x:8,y:10,width:2,height:40},hit_rect:{x:5,y:5,width:10,height:60}}});
 r.setTree({children:[{kind:'scroll_view',id:'scroll',rect:{x:10,y:20,width:40,height:60},scroll:{axis:'vertical',enabled:true},children:[local]}]});
 assert.equal(r.hitTest(19,70).sliderDrag,true);assert.equal(r.pointer({kind:'down',pointerId:9,x:19,y:70}),true);assert.equal(events.at(-1).ratio,0);
 r.pointer({kind:'move',pointerId:9,x:19,y:30});assert.equal(events.at(-1).ratio,1);r.pointer({kind:'up',pointerId:9,x:19,y:0});assert.equal(events.at(-1).ratio,1);
 assert.equal(r.pointer({kind:'down',pointerId:10,x:19,y:18}),false);
 assert.throws(()=>flattenUi({children:[modelSlider({drag:{...slider.drag,track_rect:{...slider.drag.track_rect,width:0}}})]}),/UI_SLIDER_DRAG_INVALID/);
});
test('decorative text, image and panel captions pass through to the topmost semantic control',()=>{
 const r=createUiPointerRouter(),label={kind:'text',id:'caption',rect,text:'Continue'},image={kind:'image',id:'ornament',rect,asset:'art'},panel={kind:'panel',id:'box',rect};
 r.setTree({children:[button,label,image,panel]});assert.equal(r.hitTest(10,10).action,'OpenChest');assert.equal(r.pointer({kind:'down',x:10,y:10}),true);r.releaseAll();
 r.setTree({children:[label,image,panel]});assert.equal(r.hitTest(10,10).action,null);assert.equal(r.pointer({kind:'down',x:10,y:10}),false);
 r.setTree({children:[button,{...button,id:'top',action:'Other'},label]});assert.equal(r.hitTest(10,10).action,'Other');
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
