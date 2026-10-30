import test from 'node:test';
import assert from 'node:assert/strict';
import {readObservation,releaseObservationResources} from './load-project.js';
import {createUiTreePublication,uiTreePublication,uiTreeGeneration,UI_TREE_MAX_ENCODED_BYTES} from './ui-tree-publication.mjs';
import {flattenUi} from './canvas-ui.mjs';

const encoder=new TextEncoder();
const tree=(label='UI')=>({kind:'screen',id:'root',node:'stage',children:[{kind:'text',id:'caption',text:label,rect:{x:1,y:2,width:30,height:8},style:{color:[1,.5,0,1],padding:{left:1,right:2}}}]});
function runtime(){
 const module={};let length=0;
 module._unone_web_observation_ptr=()=>16;module._unone_web_observation_len=()=>length;
 function write(value){const bytes=encoder.encode(JSON.stringify(value));module.HEAPU8.set(bytes,16);length=bytes.length;return value;}
 function publish({text=JSON.stringify(tree()),epoch='1',revision='1',offset=8192,extra={},parts=[]}={}){
  const content=encoder.encode(text),end=Math.max(offset+content.length,...parts.map(p=>p.offset+encoder.encode(p.text).length));
  module.HEAPU8=new Uint8Array(end+100);
  module.HEAPU8.set(content,offset);
  for(const part of parts)module.HEAPU8.set(encoder.encode(part.text),part.offset);
  return write({world:{frame:1},ui_tree_transport:{format:'ui-tree-memory-v1',epoch,revision,memory:{offset,byte_length:content.length}},...extra});
 }
 return{module,publish,write};
}

test('UI publication grants only freshly decoded deeply frozen data and retains exact encoded text',()=>{
 const source=tree('繁體😀'),text=JSON.stringify(source),entry=createUiTreePublication(text);
 assert.deepEqual(entry.value,source);assert.equal(entry.text,text);assert.equal(entry.bytes,encoder.encode(text).length);
 assert(Object.isFrozen(entry));assert(Object.isFrozen(entry.token));assert(Object.isFrozen(entry.value.children[0].style.padding));
 assert(Object.isFrozen(entry.value.children[0].style.color));assert(Object.isFrozen(entry.value.children));
 assert.equal(uiTreePublication(entry.value),entry);assert.equal(uiTreeGeneration(entry.value),entry.token);
 assert.equal(uiTreeGeneration(source),undefined);assert.equal(uiTreeGeneration(Object.freeze(tree())),undefined);
 assert.throws(()=>entry.value.children[0].text='changed',TypeError);
 source.children[0].text='caller changed';assert.equal(entry.value.children[0].text,'繁體😀');
 assert.equal(uiTreeGeneration({...entry.value}),undefined);
 for(const invalid of [null,{},0])assert.throws(()=>createUiTreePublication(invalid),/UI_TREE_PUBLICATION_INVALID/);
 for(const invalid of ['null','[]','0','"text"'])assert.throws(()=>createUiTreePublication(invalid),/UI_TREE_PUBLICATION_INVALID/);
 assert.throws(()=>createUiTreePublication('{'),SyntaxError);
 // The initial length check rejects this rope without parsing or walking it.
 assert.throws(()=>createUiTreePublication(' '.repeat(UI_TREE_MAX_ENCODED_BYTES+1)),/UI_TREE_PUBLICATION_LIMIT/);
});

test('UI memory lease reuses one private publication for120 ticks, including moved and grown heaps',()=>{
 const r=runtime();r.publish();const first=readObservation(r.module),ui=first.world.ui,publication=uiTreePublication(ui);
 assert.equal(first.ui_tree_transport,undefined);
 for(let index=0;index<120;index++){
  r.publish({offset:8192+index*100});const next=readObservation(r.module);
  assert.equal(next.world.ui,ui);assert.equal(uiTreePublication(next.world.ui),publication);
 }
 r.module.HEAPU8.fill(0);assert.equal(ui.children[0].text,'UI');
 r.publish({text:JSON.stringify(tree('changed')),revision:'2'});const changed=readObservation(r.module);
 assert.notEqual(changed.world.ui,ui);assert.equal(changed.world.ui.children[0].text,'changed');
 r.publish({text:JSON.stringify(tree('new runtime')),epoch:'2'});assert.equal(readObservation(r.module).world.ui.children[0].text,'new runtime');
});

test('a UI ownership grant never bypasses first-use geometry validation',()=>{
 const text=JSON.stringify(tree()).replace('"width":30','"width":1e400'),entry=createUiTreePublication(text);
 assert.equal(entry.value.children[0].rect.width,Infinity);assert(uiTreeGeneration(entry.value));
 assert.throws(()=>flattenUi(entry.value),/UI_RECT_INVALID/);
});

test('no descriptor preserves absent or inline UI and retires the current cache; explicit release also reparses',()=>{
 const r=runtime();r.publish();const first=readObservation(r.module).world.ui;
 r.publish({extra:{ui_tree_transport:undefined}});const absent=readObservation(r.module);
 assert.equal(Object.hasOwn(absent.world,'ui'),false);
 r.publish();const afterAbsent=readObservation(r.module).world.ui;assert.notEqual(afterAbsent,first);
 r.publish({extra:{ui_tree_transport:undefined,world:{frame:2,ui:tree('inline')}}});const inline=readObservation(r.module);
 assert.equal(inline.world.ui.children[0].text,'inline');assert.equal(uiTreeGeneration(inline.world.ui),undefined);
 assert.equal(Object.isFrozen(inline.world.ui),false);
 r.publish();const afterInline=readObservation(r.module).world.ui;assert.notEqual(afterInline,afterAbsent);
 releaseObservationResources(r.module);r.publish();assert.notEqual(readObservation(r.module).world.ui,afterInline);
 r.publish({text:JSON.stringify({...tree(),children:[]}),revision:'2'});const empty=readObservation(r.module);
 assert.equal(Object.hasOwn(empty.world,'ui'),true);assert.deepEqual(empty.world.ui.children,[]);
});

test('UI descriptor metadata is strict and malformed contents never replace the last valid generation',()=>{
 const r=runtime();r.publish();const first=readObservation(r.module).world.ui;
 const edits=[
  v=>v.ui_tree_transport.format='wrong',v=>v.ui_tree_transport.epoch='0',v=>v.ui_tree_transport.revision='18446744073709551616',
  v=>v.ui_tree_transport.epoch='01',v=>v.ui_tree_transport.revision=1,v=>v.ui_tree_transport.extra=true,
  v=>v.ui_tree_transport.memory.extra=true,v=>v.ui_tree_transport.memory.offset=-1,
  v=>v.ui_tree_transport.memory.offset=Number.MAX_SAFE_INTEGER,v=>v.ui_tree_transport.memory.offset=.5,
  v=>v.ui_tree_transport.memory.byte_length=0,v=>v.ui_tree_transport.memory.byte_length=UI_TREE_MAX_ENCODED_BYTES+1,
  v=>v.ui_tree_transport.memory.byte_length=r.module.HEAPU8.length,v=>v.world.ui=null,v=>v.world=undefined,
  v=>v.ui_tree_transport=null,
 ];
 for(const edit of edits){const value=r.publish();edit(value);r.write(value);assert.throws(()=>readObservation(r.module),/UI_TREE_TRANSPORT_INVALID/);}
 for(const text of ['{','null','[]','42']){r.publish({text,revision:'2'});assert.throws(()=>readObservation(r.module),/UI_TREE_TRANSPORT_INVALID/);}
 r.publish({revision:'2'});r.module.HEAPU8[8192]=0xff;assert.throws(()=>readObservation(r.module),/UI_TREE_TRANSPORT_INVALID/);
 r.publish();assert.equal(readObservation(r.module).world.ui,first);
});

test('UI, image and save generation caches commit together only after all descriptors validate',()=>{
 const r=runtime(),image=(revision,asset)=>JSON.stringify({revision,bounds:{x:0,y:0,width:10,height:10},quads:[{asset,rect:{x:0,y:0,width:10,height:10}}]});
 function publish(revision=1,badSave=false,badImage=false){
  const resource=image(revision,'texture://'+revision),save=JSON.stringify({coins:revision}),parts=[{offset:16384,text:resource},{offset:24576,text:save}];
  r.publish({text:JSON.stringify(tree('tree'+revision)),revision:String(revision),parts,extra:{
   ui_transport:{format:'retained-image-batches-v1',epoch:'1',resources:{art:{revision:String(revision),memory:{offset:badImage?-1:16384,byte_length:encoder.encode(resource).length}}}},
   save_transport:{format:'save-memory-v1',epoch:'1',revision:String(revision),memory:{offset:badSave?-1:24576,byte_length:encoder.encode(save).length}},
  }});
 }
 publish();const first=readObservation(r.module);
 for(const [badSave,badImage]of [[true,false],[false,true]]){
  publish(2,badSave,badImage);assert.throws(()=>readObservation(r.module),/SAVE_TRANSPORT_INVALID|UI_IMAGE_TRANSPORT_INVALID/);
  publish();const restored=readObservation(r.module);
  assert.equal(restored.world.ui,first.world.ui);assert.equal(restored.world.ui_image_batches.art,first.world.ui_image_batches.art);assert.equal(restored.save_payload,first.save_payload);
 }
 publish(2);const changed=readObservation(r.module);
 assert.equal(changed.world.ui.children[0].text,'tree2');assert.equal(changed.world.ui_image_batches.art.quads[0].asset,'texture://2');assert.equal(changed.save_payload.coins,2);
});
