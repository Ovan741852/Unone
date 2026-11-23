import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasUi,createUiPointerRouter,flattenUi} from './canvas-ui.mjs';

const rect={x:0,y:0,width:100,height:100};
const art={kind:'panel',id:'art',rect,style:{background:[1,0,0,1]}};
const label={kind:'text',id:'label',rect,text:'NPC'};
const button={kind:'button',id:'button',rect,text:'OK',action:'Confirm'};
const group=(id,role,children)=>({kind:'component',id,component:'game.group',render_role:role,rect,children});
const plain={kind:'screen',id:'s',node:'town',children:[art,label,button]};
const layered={kind:'screen',id:'s',node:'town',children:[group('world','scene',[art]),group('names','scene_labels',[label]),group('hud','overlay',[button])]};

test('full-resolution renderer receives identical leaves in identical paint and input order',()=>{
 assert.deepEqual(flattenUi(layered),flattenUi(plain));
 const captures=[],presenter={target:()=>({width:3840,height:2160,scale:1}),draw(c){captures.push(c.nodes.map(n=>n.id));return {skipped:false,regions:3,cpu_ms:0};},metrics:()=>({})};
 const ui=createCanvasUi(null,{getPresenter:()=>presenter});
 for(const tree of [plain,layered]){ui.draw({world:{ui:tree}});assert.equal(ui.hitTest(50,50).action,'Confirm');}
 assert.deepEqual(captures,[['art','label','button'],['art','label','button']]);ui.dispose();
 const router=createUiPointerRouter();for(const tree of [plain,layered]){router.setTree(tree);assert.equal(router.hitTest(50,50).action,'Confirm');}router.dispose();
});
