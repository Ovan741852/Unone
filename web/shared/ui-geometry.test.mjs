import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {uiUsage,slicePatches,validateSlice,UI_CONTRACT} from './ui-geometry.mjs';
import {createCanvasUi,flattenUi} from './canvas-ui.mjs';
const rect={x:0,y:0,width:100,height:100},slice={left:2,top:3,right:4,bottom:5,pixels_per_unit:2};
test('generated contract matches Core, >256 succeeds, explicit budget is bounded and diagnosed',()=>{
 assert.deepEqual(UI_CONTRACT,JSON.parse(fs.readFileSync(new URL('../../crates/unone-engine/src/ui-contract.json',import.meta.url))));
 const tree={children:Array.from({length:3000},(_,i)=>({kind:'text',id:'n'+i,rect,text:'x'}))};
 assert.throws(()=>flattenUi(tree),/UI_NODE_LIMIT: path=root.children\[2048\].*used=2049/);
 tree.budget={max_nodes:3000};assert.equal(flattenUi(tree).length,3000);assert.equal(uiUsage(tree).limit_source,'screen.budget');
 for(const max_nodes of [0,-1,1.5,16385,Infinity,'3000'])assert.throws(()=>uiUsage({...tree,budget:{max_nodes}}),/UI_BUDGET_INVALID/);
 let n={kind:'text',id:'leaf',rect};for(let i=0;i<17;i++)n={kind:'component',id:'c'+i,children:[n]};
 assert.throws(()=>uiUsage({children:[n]}),/UI_DEPTH_LIMIT/);
});
test('nine-slice geometry matches Rust values, crop boundaries and small-destination policy',()=>{
 const patches=slicePatches(slice,20,20,200,100,100);assert.equal(patches.length,9);
 assert.deepEqual(patches[0],[{x:0,y:0,width:2,height:3},{x:0,y:0,width:1,height:1.5}]);
 for(const [,d]of slicePatches(slice,20,20,1,1,100))assert.ok(d.x+d.width<=1+1e-9&&d.y+d.height<=1+1e-9);
 assert.throws(()=>slicePatches(slice,4,4,100,100,100),/UI_SLICE_BOUNDS/);
 assert.throws(()=>validateSlice({...slice,left:-1}),/UI_SLICE_INVALID/);
 assert.throws(()=>validateSlice({...slice,pixels_per_unit:0}),/UI_SLICE_INVALID/);
 assert.throws(()=>slicePatches({...slice,source:{x:10,y:10,width:20,height:20}},20,20,100,100,100),/UI_SLICE_BOUNDS/);
 const tree={children:[{kind:'image',id:'frame',rect,asset:'a',slice}]};
 assert.equal(uiUsage(tree).logical_nodes,1);assert.equal(uiUsage(tree).render_regions_upper_bound,9);
});
test('Canvas really uses source crops and reports errors without full-image stretch',async()=>{
 const calls=[],ctx={setTransform(){},clearRect(){},save(){},restore(){},beginPath(){},rect(){},clip(){},drawImage(...args){calls.push(args);}};
 const ui=createCanvasUi({width:200,height:100,getContext:()=>ctx},{resolveAsset:()=>({width:20,height:20})});
 const tree={children:[{kind:'image',id:'frame',asset:'a',rect,slice}]};
 ui.draw({ui:tree});await new Promise(setImmediate);ui.draw({ui:tree});
 assert.equal(calls.length,9);assert.ok(calls.every(a=>a.length===9));assert.equal(ui.report().usage.logical_nodes,1);
 assert.equal(ui.report().gpu_render_ms,null);assert.equal(ui.report().decoded_rgba_bytes_estimate,1600);
 calls.length=0;tree.children[0].slice={...slice,left:100};ui.draw({ui:tree});
 assert.equal(calls.length,0);assert.equal(ui.report().diagnostics[0].code,'UI_SLICE_BOUNDS');assert.equal(ui.report().diagnostics[0].node,'frame');
 tree.children=[];ui.draw({ui:tree});assert.deepEqual(ui.report().diagnostics,[]);
 ui.dispose();
});
