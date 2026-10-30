import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasUi} from './canvas-ui.mjs';
import {projectScrollTree} from './ui-scroll.mjs';
import {createUiTreePublication} from './ui-tree-publication.mjs';
const rect={x:0,y:0,width:50,height:50};
const tree=text=>({kind:'screen',id:'s',node:'s',children:[{kind:'button',id:'button',rect,text,action:text}]});
const owned=value=>createUiTreePublication(JSON.stringify(value)).value;
function harness(){
 const state={clears:0,prefixDraws:0,text:[],actions:[]},ctx={setTransform(){},clearRect(){state.clears++},save(){},restore(){},beginPath(){},rect(){},clip(){},fillText:text=>state.text.push(text),measureText:()=>({width:1})};
 const canvas={width:100,height:100,getContext:()=>ctx},ui=createCanvasUi(canvas,{onAction:e=>state.actions.push(e),getImageBatchPresenter:()=>({clear(){},drawPrefix(){state.prefixDraws++;return 0;}})});
 return {ui,state};
}

test('Canvas skips repeat serialization of private source and projected trees without suppressing GPU draws or dirty triggers',()=>{
 const {ui,state}=harness(),source=owned(tree('Go')),snapshot={world:{ui:source}};ui.draw(snapshot,{width:100,height:100,dpr:1});
 const original=JSON.stringify;let calls=0;
 try{JSON.stringify=(...args)=>{calls++;return original(...args);};for(let i=0;i<20;i++)ui.draw(snapshot,{width:100,height:100,dpr:1});}
 finally{JSON.stringify=original;}
 assert.equal(calls,0);assert.equal(state.clears,1);assert.equal(state.prefixDraws,21);
 ui.setFont('test-font');ui.draw(snapshot,{width:100,height:100,dpr:1});assert.equal(state.clears,2);
 ui.draw(snapshot,{width:100,height:100,dpr:2});assert.equal(state.clears,3);assert.equal(ui.hitTest(25,25).action,'Go');
 const projected={ui:projectScrollTree(source).tree};ui.draw(projected,{width:100,height:100,dpr:2});
 let projectedCalls=0;try{JSON.stringify=(...args)=>{projectedCalls++;return original(...args);};ui.draw(projected,{width:100,height:100,dpr:2});}finally{JSON.stringify=original;}
 assert.equal(projectedCalls,0);ui.dispose();
});

test('new private generations cancel stale control capture and still validate first-use geometry',()=>{
 const {ui,state}=harness();ui.draw({ui:owned(tree('Old'))});ui.pointer({kind:'down',pointerId:2,x:25,y:25});
 ui.draw({ui:owned(tree('New'))});assert.deepEqual(state.actions.map(e=>[e.action,e.phase]),[['Old','down'],['Old','cancel']]);assert.equal(ui.hitTest(25,25).action,'New');
 const invalid=tree('Bad');invalid.children[0].rect={...rect,width:-1};assert.throws(()=>ui.draw({ui:owned(invalid)}),/UI_RECT_INVALID/);
 ui.draw({ui:owned(tree('Restored'))});assert.equal(ui.hitTest(25,25).action,'Restored');ui.dispose();
});
