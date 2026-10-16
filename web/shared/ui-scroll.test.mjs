import test from 'node:test';
import assert from 'node:assert/strict';
import {projectScrollTree,scrollExtent,virtualWindow} from './ui-scroll.mjs';
import {createUiPointerRouter} from './canvas-ui.mjs';
import {uiUsage} from './ui-geometry.mjs';
const leaf=(id,r)=>({kind:'button',id,action:id,text:id,rect:r});
const view=(id,rect,children,scroll={})=>({kind:'scroll_view',id,rect,children,scroll:{axis:'vertical',enabled:true,reset_key:'',...scroll}});
const tree=children=>({kind:'screen',id:'s',node:'s',children});
test('authored irregular content derives extent and shares render/hit clip',()=>{
 const source=tree([view('scroll',{x:10,y:10,width:30,height:60},[leaf('a',{x:0,y:0,width:20,height:10}),leaf('b',{x:0,y:100,width:20,height:30})])]);
 const {tree:projected,views}=projectScrollTree(source,new Map([['scroll',{y:70}]]));
 assert.deepEqual(views[0].extent,{width:20,height:130});assert.equal(views[0].maxY,70);
 const b=projected.children.find(n=>n.id==='b');assert.deepEqual(b.rect,{x:10,y:10,width:20,height:30});assert.deepEqual(b.clip,source.children[0].rect);
 const router=createUiPointerRouter();router.setTree(projected);assert.equal(router.hitTest(15,15).nodeId,'b');assert.equal(router.hitTest(15,9),null);
 assert.equal(source.children[0].children[1].rect.y,100,'projection is immutable');assert.equal(uiUsage(source).leaf_nodes,2);
});
test('nested viewports intersect parent clips and disabled collections cannot act',()=>{
 const inner=view('inner',{x:5,y:45,width:20,height:30},[leaf('item',{x:0,y:0,width:20,height:30})]);
 const source=tree([view('outer',{x:10,y:10,width:40,height:60},[inner])]);
 const p=projectScrollTree(source).tree,child=p.children.find(n=>n.id==='item');
 assert.deepEqual(child.rect,{x:15,y:-5,width:20,height:30});assert.deepEqual(child.clip,{x:15,y:10,width:20,height:15});
 source.children[0].scroll.enabled=false;const disabled=projectScrollTree(source).tree;assert.equal(disabled.children.find(n=>n.id==='item').kind,'text');
 const router=createUiPointerRouter();router.setTree(disabled);assert.equal(router.pointer({kind:'down',x:16,y:15}),false);
});
test('slider drag track and hit rectangles follow nested local scroll projection without mutating the source',()=>{
 const slider={kind:'slider',id:'gain',rect:{x:2,y:12,width:15,height:6},drag:{axis:'horizontal',reverse:false,enabled:true,
  track_rect:{x:3,y:14,width:13,height:1},hit_rect:{x:2,y:12,width:15,height:6}}};
 const inner=view('inner',{x:5,y:10,width:20,height:30},[slider,leaf('tail',{x:0,y:100,width:10,height:10})]);
 const outer=view('outer',{x:10,y:10,width:40,height:60},[inner,leaf('outer_tail',{x:0,y:100,width:10,height:10})]);
 const source=tree([outer]),projected=projectScrollTree(source,new Map([['outer',{y:5}],['inner',{y:8}]])).tree;
 const gain=projected.children.find(n=>n.id==='gain');
 assert.deepEqual(gain.rect,{x:17,y:55,width:15,height:6});
 assert.deepEqual(gain.drag.track_rect,{x:18,y:58,width:13,height:1});
 assert.deepEqual(gain.drag.hit_rect,gain.rect);assert.deepEqual(gain.clip,{x:15,y:35,width:20,height:30});
 assert.deepEqual(slider.drag.track_rect,{x:3,y:14,width:13,height:1});
 const stage=projectScrollTree(tree([{...slider,rect:{x:2,y:50,width:15,height:6}}])).tree.children[0];
 assert.deepEqual(stage.drag,slider.drag,'stage-space control geometry remains unchanged');
});

test('disabling a scroll ancestor removes slider drag metadata and cancels its capture',()=>{
 const gain={kind:'slider',id:'gain',rect:{x:0,y:0,width:20,height:6},drag:{axis:'horizontal',reverse:false,enabled:true,
  track_rect:{x:0,y:0,width:20,height:6},hit_rect:{x:-.65,y:-.65,width:21.3,height:7.3}}};
 const source=tree([view('rows',{x:10,y:10,width:30,height:60},[gain])]),events=[];
 const router=createUiPointerRouter({onSlider:event=>events.push(event)});
 router.setTree(projectScrollTree(source).tree);
 assert(router.pointer({kind:'down',pointerId:1,x:15,y:65}));
 source.children[0].scroll.enabled=false;
 const disabled=projectScrollTree(source).tree;
 assert.equal(disabled.children.find(n=>n.id==='gain').drag,undefined);
 router.setTree(disabled);
 assert.deepEqual(events.map(e=>e.phase),['start','cancel']);
 assert(router.pointer({kind:'up',pointerId:1,x:15,y:65}),'cancelled stream remains captured until terminal');
 assert.equal(router.pointer({kind:'down',pointerId:2,x:15,y:65}),false);
});
test('horizontal and both axes clamp independently without artificial overflow',()=>{
 const node=view('scroll',{x:0,y:0,width:50,height:50},[leaf('item',{x:0,y:0,width:120,height:80})],{axis:'both'});
 const r=projectScrollTree(tree([node]),new Map([['scroll',{x:900,y:900}]]));assert.deepEqual(r.views[0].offset,{x:70,y:30});
 node.scroll.axis='horizontal';assert.deepEqual(projectScrollTree(tree([node]),new Map([['scroll',{x:5,y:30}]])).views[0].offset,{x:5,y:0});
 node.children=[];assert.deepEqual(projectScrollTree(tree([node])).views[0].extent,{width:0,height:0});
});
test('virtual windows remain bounded for 100000 items, include last row, and count no phantom rows',()=>{
 const v={keys:Array.from({length:100000},(_,i)=>'key'+i),columns:8,column_width:9,row_height:12,gap_x:1,gap_y:1};
 const n=view('grid',{x:10,y:10,width:80,height:70},[],{virtual_items:v});
 assert.deepEqual(scrollExtent(n),{width:79,height:162499});
 for(const offset of [0,21,50000,162429]){const range=virtualWindow(v,offset,70);assert(range.first>=1&&range.last<=100000);assert(range.last-range.first+1<=72);}
 assert.equal(virtualWindow(v,162429,70).last,100000);v.keys=[];assert.deepEqual(virtualWindow(v,0,70),{first:0,last:0});assert.equal(scrollExtent(n).height,0);
});
