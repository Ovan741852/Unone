import test from 'node:test';
import assert from 'node:assert/strict';
import {fitFormalUI,TEXT_STYLES} from '../presentation/adaptive-ui.mjs';

let currentFont=22;
globalThis.document={createElement:()=>({getContext:()=>({
 set font(value){currentFont=Number.parseFloat(value)||22;},
 measureText:value=>({width:[...String(value)].length*currentFont}),
})})};

const button=(id,height)=>[
 {kind:'image',id:id+'_plate',rect:{x:10,y:80-height,width:24,height},asset:'plate'},
 {kind:'button',id,rect:{x:10,y:80-height,width:24,height},text:id==='start'?'開始':'系統設定',action:id},
];

test('semantic type roles keep CTA size independent from plate height and scale with the canvas',()=>{
 const snapshot={ui:{node:'home:menu',children:[
  ...button('start',9),...button('settings',7),
  {kind:'text',id:'screen_title',rect:{x:20,y:80,width:60,height:8},text:'是的，領主大人'},
  {kind:'text',id:'settings_hint',rect:{x:20,y:60,width:60,height:5},text:'系統設定說明'},
 ]}};
 const atDesignSize=fitFormalUI(snapshot).ui.children;
 const byId=Object.fromEntries(atDesignSize.map(node=>[node.id,node]));
 assert.equal(byId.start.fontSize,TEXT_STYLES.button.size);
 assert.equal(byId.settings.fontSize,TEXT_STYLES.button.size);
 assert.equal(byId.screen_title.fontSize,TEXT_STYLES.title.size);
 assert.equal(byId.settings_hint.fontSize,TEXT_STYLES.helper.size);

 const scaled=fitFormalUI(snapshot,{width:1440,height:810}).ui.children;
 assert.equal(scaled.find(node=>node.id==='start').fontSize,TEXT_STYLES.button.size*.75);
 assert.equal(scaled.find(node=>node.id==='settings').fontSize,TEXT_STYLES.button.size*.75);
});
