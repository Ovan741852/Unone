import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasUi,createUiPointerRouter,flattenUi} from './canvas-ui.mjs';
import {uiUsage,UI_CONTRACT} from './ui-geometry.mjs';
import {projectScrollTree} from './ui-scroll.mjs';
import {createUiTree} from './ui-tree.js';
const rect={x:0,y:0,width:100,height:100};
const quad=(asset='asset://a',overrides={})=>({asset,rect:{x:10,y:20,width:20,height:10},...overrides});
const batch=(quads=[quad()],overrides={})=>({kind:'image_batch',id:'artwork',rect,quads,...overrides});
const tree=(...children)=>({ui:{children}}),flush=()=>new Promise(setImmediate);
function surface(){
 const calls=[],stack=[],ctx={globalAlpha:1,setTransform(){},clearRect(){},beginPath(){},rect(){},clip(){},
  save(){stack.push(this.globalAlpha)},restore(){this.globalAlpha=stack.pop()},
  drawImage(...args){calls.push({args,alpha:this.globalAlpha})},fillText(){},measureText(){return {width:1}}};
 return {canvas:{width:200,height:100,getContext:()=>ctx},ctx,calls};
}
test('ordered batch uses existing image paint, source pixels, stage placement, DPR and per-quad opacity',async()=>{
 const s=surface(),requested=[],images=new Map(['asset://a','asset://b'].map(id=>[id,{id,width:40,height:40}]));
 const ui=createCanvasUi(s.canvas,{resolveAsset:id=>{requested.push(id);return images.get(id)}});
 const nodes=tree({kind:'image',id:'before',rect:{x:0,y:0,width:5,height:5},asset:'asset://b',fit:'stretch'},
  batch([quad('asset://a',{source:{x:2,y:3,width:8,height:9},opacity:.25}),quad('asset://b',{rect:{x:30,y:40,width:10,height:20},source:null,opacity:null}),quad('asset://a',{rect:{x:50,y:50,width:20,height:20},opacity:0})],{rect:{x:10,y:20,width:60,height:50}}),
  {kind:'image',id:'after',rect:{x:90,y:0,width:10,height:10},asset:'asset://a',fit:'stretch'});
 const draw=()=>ui.draw(nodes,{width:200,height:100,dpr:2});draw();await flush();s.calls.length=0;draw();
 assert.deepEqual(s.calls.map(c=>c.args[0].id),['asset://b','asset://a','asset://b','asset://a','asset://a']);
 assert.deepEqual(s.calls[1].args.slice(1),[2,3,8,9,40,140,80,20]);
 assert.deepEqual(s.calls[2].args.slice(1),[120,80,40,40]);
 assert.deepEqual(s.calls.map(c=>c.alpha),[1,.25,1,0,1]);assert.equal(s.ctx.globalAlpha,1);
 assert.deepEqual(requested,['asset://b','asset://a']);
 assert.equal(ui.report().nodes,3);assert.equal(ui.report().usage.logical_nodes,6);
 assert.equal(ui.report().usage.leaf_nodes,3);assert.equal(ui.report().usage.render_regions_upper_bound,5);assert.equal(ui.report().render_regions,5);ui.dispose();
});
test('art batches cannot own input or hide lower controls or decorative hit identity',()=>{
 const r=createUiPointerRouter(),button={kind:'button',id:'control',rect,text:'Go',action:'Go'};
 r.setTree({children:[button,batch()]});assert.equal(r.hitTest(12,22).action,'Go');assert.equal(r.pointer({kind:'down',x:12,y:22}),true);r.releaseAll();
 r.setTree({children:[{kind:'image',id:'lower',rect,asset:'x'},batch()]});assert.equal(r.hitTest(12,22).nodeId,'lower');assert.equal(r.pointer({kind:'down',x:12,y:22}),false);
 r.setTree({children:[batch()]});assert.equal(r.hitTest(12,22),null);assert.equal(r.pointer({kind:'down',x:12,y:22}),false);
});
test('batch and every quad consume the shared node/string budgets while remaining one leaf',()=>{
 const n=batch([quad(),quad('asset://b')]);const t={budget:{max_nodes:3},children:[n]};
 assert.deepEqual(uiUsage(t).subtrees,[['artwork',3]]);assert.equal(flattenUi(t).length,1);
 assert.throws(()=>uiUsage({...t,budget:{max_nodes:2}}),/UI_NODE_LIMIT: path=root.children\[0\].quads\[1\].*used=3/);
 assert.throws(()=>uiUsage({children:[batch([quad('asset://'+ 'a'.repeat(UI_CONTRACT.max_string_bytes))])]}),/UI_STRING_LIMIT.*quads\[0\]/);
});
test('batch contract rejects malformed artwork instead of interpreting controls or implicit transforms',()=>{
 const invalid=[
  [batch([]),'EMPTY'],[batch(null),'QUADS'],[batch([quad()],{style:{}}),'FIELDS'],[batch([quad()],{clip:rect}),'FIELDS'],
  [batch([quad('https://example.com/a')]),'ASSET'],[batch([quad('',{action:'Go'})]),'FIELDS'],[batch([quad('asset://a',{id:'per-quad'})]),'FIELDS'],
  [batch([quad('asset://a',{rect:{...rect,width:101}})]),'BOUNDS'],[batch([quad('asset://a',{opacity:NaN})]),'OPACITY'],[batch([quad('asset://a',{opacity:1.01})]),'OPACITY'],
  [batch([quad('asset://a',{source:{x:-1,y:0,width:2,height:2}})]),'SOURCE'],[batch([quad('asset://a',{source:{x:0,y:0,width:0,height:2}})]),'SOURCE'],
  [batch([quad('asset://a',{source:{x:0,y:0,width:Infinity,height:2}})]),'SOURCE'],
 ];
 for(const [node,code]of invalid)assert.throws(()=>flattenUi({children:[node]}),new RegExp('UI_IMAGE_BATCH_'+code));
 const scroll={kind:'scroll_view',id:'scroll',rect,scroll:{axis:'vertical',enabled:true},children:[{kind:'component',id:'group',rect,children:[batch()]}]};
 assert.throws(()=>uiUsage({children:[scroll]}),/UI_IMAGE_BATCH_SPACE/);assert.throws(()=>projectScrollTree({children:[scroll]}),/UI_IMAGE_BATCH_SPACE/);
 let replacements=0;const legacy=createUiTree({replaceChildren(){replacements++}});
 assert.throws(()=>legacy(tree(batch())),/UI_HOST_CAPABILITY_UNSUPPORTED.*image_batch/);
 assert.throws(()=>legacy(tree(batch())),/UI_HOST_CAPABILITY_UNSUPPORTED.*image_batch/);assert.equal(replacements,0);
});
test('invalid decoded source bounds never stretch the whole image or erase another quad diagnostic',async()=>{
 const s=surface(),ui=createCanvasUi(s.canvas,{resolveAsset:()=>({width:40,height:40})});
 const bad=batch([quad('asset://a',{source:{x:30,y:0,width:20,height:10}}),quad('asset://a')]);
 const ordinary={kind:'image',id:'artwork/quad[0]',asset:'asset://a',rect};
 ui.draw(tree(bad,ordinary));await flush();ui.draw(tree(bad,ordinary));
 assert.equal(s.calls.length,2);assert.equal(ui.report().diagnostics.length,1);
 assert.equal(ui.report().diagnostics[0].code,'UI_IMAGE_BATCH_SOURCE_BOUNDS');assert.equal(ui.report().diagnostics[0].node,'artwork');assert.equal(ui.report().diagnostics[0].quad,0);
 ui.draw(tree(batch()));assert.deepEqual(ui.report().diagnostics,[]);ui.dispose();
});
test('quad used-set shares assets with image leaves and closes removed async decodes exactly once',async()=>{
 const s=surface(),pending=new Map(),closed=[],ui=createCanvasUi(s.canvas,{resolveAsset:id=>new Promise(resolve=>pending.set(id,resolve))});
 ui.draw(tree(batch([quad('asset://a'),quad('asset://b')])));await flush();
 ui.draw(tree({kind:'image',id:'keep',asset:'asset://a',rect}));
 pending.get('asset://b')({width:10,height:10,close(){closed.push('b')}});
 pending.get('asset://a')({width:10,height:10,close(){closed.push('a')}});await flush();
 assert.deepEqual(closed,['b']);assert.deepEqual(ui.report().assets,[{id:'asset://a',state:'ready'}]);
 ui.draw(tree());assert.deepEqual(closed,['b','a']);ui.dispose();assert.deepEqual(closed,['b','a']);
});
test('invalidation and disposal reject stale batch assets without late render requests',async()=>{
 const s=surface(),pending=[],closed=[],ui=createCanvasUi(s.canvas,{resolveAsset:()=>new Promise(resolve=>pending.push(resolve))});
 const n=tree(batch());ui.draw(n);await flush();ui.invalidateAssets();ui.draw(n);await flush();
 pending[0]({width:10,height:10,close(){closed.push('old')}});await flush();assert.deepEqual(closed,['old']);assert.equal(ui.report().assets[0].state,'loading');
 ui.dispose();pending[1]({width:10,height:10,close(){closed.push('new')}});await flush();assert.deepEqual(closed,['old','new']);assert.deepEqual(ui.report().assets,[]);
});
