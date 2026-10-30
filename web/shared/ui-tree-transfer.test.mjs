import test from 'node:test';
import assert from 'node:assert/strict';
import {InstanceTransfer,InstanceReceiver} from './instance-transfer.mjs';
import {createUiTreePublication,uiTreePublication,uiTreeGeneration} from './ui-tree-publication.mjs';
import {createSavePublication,attachSavePublication,savePublication} from './save-publication.mjs';
const tree=text=>({kind:'screen',id:'screen',node:'screen',children:[{kind:'text',id:'text',text,rect:{x:0,y:0,width:50,height:50}}]});
const publication=text=>createUiTreePublication(JSON.stringify(tree(text)));
const heap=new ArrayBuffer(0);

test('worker sends UI JSON only on changed private publications and restores receiver-owned frozen trees',()=>{
 const sender=new InstanceTransfer(),receiver=new InstanceReceiver(),entry=publication('first'),source={world:{frame:1,ui:entry.value}};
 const first=sender.encode(source,heap);assert.equal(first.ui_tree.json,entry.text);assert.equal(first.value.world.ui,undefined);assert.equal(source.world.ui,entry.value);
 const decoded=receiver.accept(structuredClone(first));assert.deepEqual(decoded.world.ui,entry.value);assert.notEqual(decoded.world.ui,entry.value);
 assert(Object.isFrozen(decoded.world.ui.children[0].rect));assert.notEqual(uiTreeGeneration(decoded.world.ui),entry.token);
 for(let i=0;i<120;i++){
  const packet=sender.encode({world:{frame:i+2,ui:entry.value}},heap);assert(!Object.hasOwn(packet.ui_tree,'json'));
  const next=receiver.accept(structuredClone(packet));assert.equal(next.world.ui,decoded.world.ui);assert.equal(next.world.frame,i+2);
 }
 const changed=publication('changed'),next=receiver.accept(structuredClone(sender.encode({observation:{world:{ui:changed.value}}},heap))).observation;
 assert.equal(next.world.ui.children[0].text,'changed');assert.notEqual(next.world.ui,decoded.world.ui);assert.equal(decoded.world.ui.children[0].text,'first');
 assert.equal(sender.report().ui_definition_updates,2);assert.equal(sender.report().ui_unchanged_publications,120);
});

test('inline caller trees never acquire generation authority and clear earlier worker UI ownership',()=>{
 const sender=new InstanceTransfer(),receiver=new InstanceReceiver(),entry=publication('owned');
 receiver.accept(structuredClone(sender.encode({world:{ui:entry.value}},heap)));
 const raw=tree('mutable'),packet=sender.encode({world:{ui:raw}},heap);assert.equal(packet.ui_tree,undefined);assert.equal(packet.value.world.ui,raw);assert.equal(sender.ui,null);
 const result=receiver.accept(structuredClone(packet));assert.equal(receiver.ui,null);assert.equal(uiTreeGeneration(result.world.ui),undefined);
 raw.children[0].text='changed in place';assert.equal(sender.encode({world:{ui:raw}},heap).value.world.ui.children[0].text,'changed in place');
 const frozen=Object.freeze(tree('caller frozen'));assert.equal(sender.encode({world:{ui:frozen}},heap).ui_tree,undefined);
 const full=sender.encode({world:{ui:entry.value}},heap);assert.equal(full.ui_tree.json,entry.text);receiver.accept(structuredClone(full));
 receiver.accept(sender.encode({world:{frame:9}},heap));assert.equal(receiver.ui,null);assert.equal(sender.ui,null);
 sender.reset();assert.equal(sender.ui,null);receiver.clear();assert.equal(receiver.ui,null);
});

test('worker rejects invalid, conflicting, missing and stale UI deltas before replacing previous ownership',()=>{
 const sender=new InstanceTransfer(),receiver=new InstanceReceiver(),entry=publication('old');
 const first=sender.encode({world:{ui:entry.value}},heap),decoded=receiver.accept(structuredClone(first)),old=receiver.ui;
 const delta=sender.encode({world:{ui:entry.value}},heap);
 for(const mutate of [p=>p.ui_tree.generation='0',p=>p.ui_tree.extra=true,p=>p.ui_tree.format='other',p=>p.value.world.ui=tree('inline'),p=>p.ui_tree=null,p=>p.ui_tree.json=JSON.stringify(tree('forged'))]){
  const invalid=structuredClone(delta);mutate(invalid);assert.throws(()=>receiver.accept(invalid),/TRANSFER_UI_TREE_INVALID/);assert.equal(receiver.ui,old);
 }
 const missing=structuredClone(delta);missing.ui_tree.generation='999';assert.throws(()=>receiver.accept(missing),/TRANSFER_UI_TREE_MISSING/);
 const invalidJson=structuredClone(delta);invalidJson.ui_tree.generation='2';invalidJson.ui_tree.json='[]';assert.throws(()=>receiver.accept(invalidJson),/UI_TREE_PUBLICATION_INVALID/);assert.equal(receiver.ui,old);
 sender.reset();const fresh=sender.encode({world:{ui:publication('reloaded').value}},heap);assert(fresh.ui_tree.json);receiver.accept(structuredClone(fresh));
 assert.throws(()=>receiver.accept(structuredClone(first)),/TRANSFER_UI_TREE_INVALID/);assert.equal(decoded.world.ui.children[0].text,'old');
 receiver.clear();assert.throws(()=>receiver.accept(delta),/TRANSFER_UI_TREE_MISSING/);
});

test('UI, image and save publications keep all private grants after combined envelope restoration',()=>{
 const sender=new InstanceTransfer(),receiver=new InstanceReceiver(),ui=publication('combined'),save=createSavePublication('{"items":[1,2]}');
 const snapshot=attachSavePublication({world:{ui:ui.value},save_payload:save.value},save),decoded=receiver.accept(structuredClone(sender.encode(snapshot,heap)));
 assert.equal(uiTreePublication(decoded.world.ui).text,ui.text);assert.equal(savePublication(decoded).text,save.text);
 assert.equal(decoded.save_payload.items[1],2);assert(Object.isFrozen(decoded.save_payload.items));
});
