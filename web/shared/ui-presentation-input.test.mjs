import test from 'node:test';
import assert from 'node:assert/strict';
import * as style from './ui-style.mjs';
import {createCanvasUi,createUiPointerRouter,flattenUi} from './canvas-ui.mjs';
const rect={x:10,y:20,width:30,height:10};
function context(){
 const calls=[];return {calls,save(){},restore(){},beginPath(){},rect(...v){calls.push(['clip',...v]);},clip(){},
  fillText(text,x,y){calls.push(['text',text,x,y,this.font,this.fillStyle]);},measureText(text){return {width:[...text].length*10};},
  setTransform(){},clearRect(){},fill(){},stroke(){}};
}
test('shadow reuses the foreground glyph layout, font, tracking and translated content clip',()=>{
 const ctx=context(),bounds={x:10,y:20,width:100,height:40,viewportHeight:1000};
 const node={text:'繁中 AB',style:{font_size:2,font_weight:400,padding:{left:1},
  text_shadow:{offset_x:.25,offset_y:.5,color:[.04,.02,0,1]}}};
 const foreground=style.layoutUiText(ctx,node,bounds);style.paintUiText(ctx,node,bounds);
 const draws=ctx.calls.filter(c=>c[0]==='text');assert.equal(draws.length,2);
 assert.deepEqual(draws[0],['text','繁中 AB',foreground.lines[0].x+2.5,foreground.lines[0].y+5,foreground.font,'rgba(10,5,0,1)']);
 assert.deepEqual(draws[1],['text','繁中 AB',foreground.lines[0].x,foreground.lines[0].y,foreground.font,foreground.color]);
 assert.deepEqual(ctx.calls.filter(c=>c[0]==='clip'),[['clip',12.5,25,100,40],['clip',22.5,25,90,40],['clip',10,20,100,40],['clip',20,20,90,40]]);
});
test('TC back baseline matches the existing clipped two-leaf adapter without changing foreground box',()=>{
 const bounds={x:296,y:454,width:48,height:26,viewportHeight:480},base={font_size:5,text_align:'center',vertical_align:'middle'};
 const prior=context();style.paintUiText(prior,{text:'返回',style:{...base,color:[.04,.02,0,1]}},{...bounds,x:297,y:455,height:25});
 style.paintUiText(prior,{text:'返回',style:base},bounds);
 const next=context();style.paintUiText(next,{text:'返回',style:{...base,text_shadow:{offset_x:100/480,offset_y:50/480,color:[.04,.02,0,1]}}},bounds);
 assert.deepEqual(next.calls.filter(c=>c[0]==='text'),prior.calls.filter(c=>c[0]==='text'));
});
test('input region uses button edge, clip, shared action and cancellation contracts without drawing',()=>{
 const events=[],router=createUiPointerRouter({onAction:e=>events.push(e)}),node={kind:'input_region',id:'owner',action:'Owner',rect};
 router.setTree({children:[node]});
 for(const [x,y,inside]of [[10,20,true],[40,20,false],[10,30,false],[9.999,25,false],[39.999,29.999,true]]){
  assert.equal(router.pointer({kind:'down',pointerId:7,x,y}),inside);router.pointer({kind:'up',pointerId:7,x:90,y:90});
 }
 router.pointer({kind:'down',pointerId:1,x:11,y:21});router.pointer({kind:'down',pointerId:2,x:12,y:22});
 const count=events.length;router.pointer({kind:'up',pointerId:1});assert.equal(events.length,count);
 router.setTree({children:[]});assert.equal(events.at(-1).phase,'cancel');
 assert.equal(router.pointer({kind:'move',pointerId:2,x:90,y:90}),true);assert.equal(router.pointer({kind:'up',pointerId:2}),true);
 router.setTree({children:[{...node,clip:{x:20,y:20,width:5,height:5}}]});
 assert.equal(router.pointer({kind:'down',x:15,y:22}),false);assert.equal(router.pointer({kind:'down',x:20,y:20}),true);
 router.releaseAll();assert.equal(router.pointer({kind:'move',x:90,y:90}),true);assert.equal(router.pointer({kind:'up'}),true);
 const ctx=context(),ui=createCanvasUi({width:100,height:100,getContext:()=>ctx});
 ui.draw({ui:{children:[node]}},{width:100,height:100,dpr:1});
 assert.equal(ui.report().render_regions,0);assert.deepEqual(ui.report().assets,[]);assert.equal(ui.report().usage.render_regions_upper_bound,0);
 assert.equal(ctx.calls.length,0);ui.dispose();
});
test('host rejects painted input regions and invalid shadow contracts rather than ignoring them',()=>{
 const node={kind:'input_region',id:'owner',action:'Owner',rect};
 for(const extra of [{text:''},{style:{}},{children:[]},{action:''}])assert.throws(()=>flattenUi({children:[{...node,...extra}]}));
 for(const shadow of [{offset_x:NaN,offset_y:0,color:[0,0,0,1]},
  {offset_x:0,offset_y:Infinity,color:[0,0,0,1]}, {offset_x:101,offset_y:0,color:[0,0,0,1]},
  {offset_x:0,offset_y:0,color:Array(4)}, {offset_x:0,offset_y:0,color:[0,0,,1]},
  {offset_x:0,offset_y:0,color:[0,0,0,2]}, {offset_x:0,offset_y:0,color:[0,0,0,1],blur:1}]) {
  assert.throws(()=>style.paintUiText(context(),{text:'x',style:{text_shadow:shadow}},{x:0,y:0,width:20,height:20,viewportHeight:100}));
 }
});

test('disabled scroll cancels a held nonvisual region and keeps its release tail consumed',()=>{
 const events=[],router=createUiPointerRouter({onAction:e=>events.push(e)});
 const region={kind:'input_region',id:'owner',action:'Owner',rect:{x:0,y:0,width:30,height:20}};
 const tree=enabled=>({children:[{kind:'scroll_view',id:'scroll',rect:{x:10,y:20,width:30,height:20},scroll:{axis:'vertical',enabled},children:[region]}]});
 router.setTree(tree(true));assert.equal(router.pointer({kind:'down',pointerId:9,x:11,y:21}),true);
 router.setTree(tree(false));assert.deepEqual(events.map(e=>e.phase),['down','cancel']);
 router.setTree(tree(true));assert.equal(router.pointer({kind:'move',pointerId:9,x:11,y:21}),true);
 assert.equal(events.length,2);assert.equal(router.pointer({kind:'up',pointerId:9}),true);
 router.pointer({kind:'down',pointerId:9,x:11,y:21});assert.equal(events.at(-1).phase,'down');router.releaseAll();
});
