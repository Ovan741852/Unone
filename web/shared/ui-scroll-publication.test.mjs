import test from 'node:test';
import assert from 'node:assert/strict';
import {projectScrollTree,uiProjectionGeneration} from './ui-scroll.mjs';
import {createUiTreePublication,uiTreeGeneration} from './ui-tree-publication.mjs';
const rect={x:10,y:10,width:30,height:40};
const leaf=(id,y=0)=>({kind:'button',id,action:id,text:id,rect:{x:0,y,width:20,height:10}});
const view=(id,children,extra={})=>({kind:'scroll_view',id,rect:{...rect},children,scroll:{axis:'vertical',enabled:true,reset_key:'',...extra}});
const screen=children=>({kind:'screen',id:'s',node:'s',children});
const owned=value=>createUiTreePublication(JSON.stringify(value)).value;

test('private unchanged trees reuse sealed projection while raw and caller-frozen trees detect edits',()=>{
 const source=owned(screen([{kind:'component',id:'group',children:[leaf('a')]}])),a=projectScrollTree(source),b=projectScrollTree(source);
 assert.equal(a,b);assert.equal(a.tree,b.tree);assert(uiProjectionGeneration(a.tree));assert(Object.isFrozen(a.tree.children[0]));assert(Object.isFrozen(a.tree.children));
 assert.notEqual(uiTreeGeneration(source),uiProjectionGeneration(a.tree));assert.throws(()=>a.tree.children[0].rect.y=99,TypeError);
 const raw=screen([leaf('raw')]),before=projectScrollTree(raw);raw.children[0].text='edited';const after=projectScrollTree(raw);
 assert.notEqual(after,before);assert.equal(after.tree.children[0].text,'edited');assert.equal(uiProjectionGeneration(after.tree),undefined);
 Object.freeze(raw);raw.children[0].text='nested edit';assert.equal(projectScrollTree(raw).tree.children[0].text,'nested edit');
 raw.children.push(view('added',[leaf('tail',100)]));assert.equal(projectScrollTree(raw).views.length,1);
});

test('actual nested scroll offsets invalidate only current projection and seal derived control geometry',()=>{
 const slider={kind:'slider',id:'slider',rect:{x:0,y:30,width:20,height:5},drag:{axis:'horizontal',reverse:false,enabled:true,track_rect:{x:0,y:31,width:20,height:1},hit_rect:{x:0,y:30,width:20,height:5}}};
 const source=owned(screen([view('outer',[view('inner',[slider,leaf('tail',100)]),leaf('outer-tail',120)])]));
 const offsets=new Map([['outer',{x:0,y:10}],['inner',{x:0,y:5}]]),first=projectScrollTree(source,offsets);
 assert.equal(projectScrollTree(source,offsets),first);offsets.set('unrelated',{x:50,y:60});assert.equal(projectScrollTree(source,offsets),first);
 offsets.get('inner').y=6;const moved=projectScrollTree(source,offsets);assert.notEqual(moved,first);assert.equal(projectScrollTree(source,offsets),moved);
 const a=first.tree.children.find(n=>n.id==='slider'),b=moved.tree.children.find(n=>n.id==='slider');assert.equal(b.rect.y,a.rect.y+1);
 for(const value of [b,b.rect,b.clip,b.drag,b.drag.track_rect,b.drag.hit_rect])assert(Object.isFrozen(value));
 offsets.get('outer').y=20;assert.notEqual(projectScrollTree(source,offsets),moved);
 const reloaded=owned(screen([view('outer',[leaf('replacement')])]));assert.equal(projectScrollTree(reloaded).tree.children.at(-1).id,'replacement');
});

test('a publication grant never skips first-use invalid geometry or stage-only batch checks',()=>{
 const source=owned(screen([view('scroll',[{kind:'image_batch',id:'bad',rect:{...rect},quads:[]}])]));
 assert.throws(()=>projectScrollTree(source),/UI_IMAGE_BATCH_SPACE/);assert.throws(()=>projectScrollTree(source),/UI_IMAGE_BATCH_SPACE/);
});
