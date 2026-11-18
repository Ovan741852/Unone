import test from 'node:test';import assert from 'node:assert/strict';
import {createCanvasUi} from './canvas-ui.mjs';
import {createUiTreePublication} from './ui-tree-publication.mjs';
const owned=value=>createUiTreePublication(JSON.stringify(value)).value;
const node=(id,text)=>({kind:'text',id,rect:{x:0,y:0,width:30,height:10},text});
const snap=children=>({world:{ui:owned({kind:'screen',id:'s',node:'s',children})}});
function harness(){const calls=[];let skip=false;const presenter={target:()=>({width:3840,height:2160,scale:1}),draw(c){calls.push({changed:c.changed,nodeKeys:[...c.nodeKeys]});return {skipped:skip,regions:2,cpu_ms:0};},metrics:()=>({})};
 const ui=createCanvasUi(null,{getPresenter:()=>presenter});return {ui,calls,setSkip:v=>skip=v};}
test('GPU paint comparison preserves equality, order, content and empty composition without joining',()=>{
 const h=harness(),original=Array.prototype.join;let joining=false;
 try{Array.prototype.join=function(separator){if(separator==='\u0001')joining=true;return original.apply(this,arguments)};
  h.ui.draw(snap([node('a','A'),node('b','B')]));assert.equal(h.calls.at(-1).changed,true);
  h.ui.draw(snap([node('a','A'),node('b','B')]));assert.equal(h.calls.at(-1).changed,false);
  h.ui.draw(snap([node('a','A'),node('b','C')]));assert.equal(h.calls.at(-1).changed,true);
  h.ui.draw(snap([node('b','C'),node('a','A')]));assert.equal(h.calls.at(-1).changed,true);
  h.ui.draw(snap([]));assert.equal(h.calls.at(-1).changed,true);
  h.ui.draw(snap([]));assert.equal(h.calls.at(-1).changed,false);
  assert.equal(joining,false);
 }finally{Array.prototype.join=original;h.ui.dispose();}
});
test('skipped GPU submission retries unchanged content and resize remains dirty',()=>{
 const h=harness();let s=snap([node('a','A')]);h.setSkip(true);h.ui.draw(s);assert.equal(h.calls.at(-1).changed,true);
 h.setSkip(false);h.ui.draw(s);assert.equal(h.calls.at(-1).changed,true);h.ui.draw(s);assert.equal(h.calls.at(-1).changed,false);
 h.ui.setFont('another-font');h.ui.draw(s);assert.equal(h.calls.at(-1).changed,true);h.ui.dispose();
});
test('a presenter cannot mutate the committed paint keys to hide a later change',()=>{
 let count=0,changed=[];const presenter={target:()=>({width:100,height:100,scale:1}),draw(c){count++;changed.push(c.changed);if(count===1)c.nodeKeys[0]=JSON.stringify({...node('a','B'),rect:{x:0,y:0,width:30,height:10}});return {skipped:false,regions:1,cpu_ms:0}},metrics:()=>({})};
 const ui=createCanvasUi(null,{getPresenter:()=>presenter});ui.draw(snap([node('a','A')]));ui.draw(snap([node('a','B')]));assert.deepEqual(changed,[true,true]);ui.dispose();
});
test('retained image-batch definition replacement remains dirty even with identical node keys',async()=>{
 const {retainImageResource}=await import('./retained-image-generation.mjs');const calls=[];const presenter={target:()=>({width:100,height:100,scale:1}),draw(c){calls.push(c.changed);return {skipped:false,regions:1,cpu_ms:0}},metrics:()=>({})};
 const ui=createCanvasUi(null,{getPresenter:()=>presenter,resolveAsset:()=>({width:10,height:10})});
 const tree=owned({kind:'screen',id:'s',node:'s',children:[{kind:'image_batch',id:'b',content:'art',rect:{x:0,y:0,width:100,height:100}}]});
 const make=()=>retainImageResource({revision:1,bounds:{x:0,y:0,width:10,height:10},quads:[{asset:'asset://a',rect:{x:0,y:0,width:10,height:10}}]});
 const first=make(),second=make();ui.draw({world:{ui:tree,ui_image_batches:{art:first}}});ui.draw({world:{ui:tree,ui_image_batches:{art:first}}});
 ui.draw({world:{ui:tree,ui_image_batches:{art:second}}});assert.deepEqual(calls,[true,false,true]);ui.dispose();
});
