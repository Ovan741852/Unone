import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleProject,readObservation} from './load-project.js';
test('assembly preserves every config declaration without a field allowlist',async()=>{
  const config={name:'test',entry_script:'main.luau',main_scene:'scene.json',audio:{categories:{music:{fade_in_frames:2}}},future_declaration:{nested:true}};
  const result=await assembleProject(config,async name=>{assert.equal(name,'main.luau');return 'return {}';},async name=>{assert.equal(name,'scene.json');return {entities:[]};});
  assert.deepEqual(JSON.parse(JSON.stringify(result)).config,config);
  assert.equal(result.script,'return {}');
});

test('observation decoding borrows the current heap without copying and releases it before returning',()=>{
 const encoder=new TextEncoder(),module={};let length=0,pointerReads=0,lengthReads=0,copies=0;
 module._unone_web_observation_ptr=()=>{pointerReads++;return 13;};module._unone_web_observation_len=()=>{lengthReads++;return length;};
 function publish(value){const bytes=encoder.encode(JSON.stringify(value));module.HEAPU8=new Uint8Array(bytes.length+32);module.HEAPU8.set(bytes,13);length=bytes.length;
  module.HEAPU8.slice=()=>{copies++;throw Error('unexpected observation copy');};}
 const value={world:{text:'門派 🐉',data:'x'.repeat(415000)},save_payload:{coins:7}};publish(value);
 const marks=[],first=readObservation(module,(name,bytes)=>marks.push([name,bytes]));assert.deepEqual(first,value);
 assert.deepEqual(marks.map(([n])=>n),['observation_view','observation_utf8','observation_parse']);assert.equal(marks[0][1],length);
 module.HEAPU8.fill(0);assert.deepEqual(first,value,'JSON result must not alias the borrowed heap');
 publish({world:{text:'new heap after WASM memory growth'}});assert.equal(readObservation(module).world.text,'new heap after WASM memory growth');
 assert.equal(pointerReads,2);assert.equal(lengthReads,2);assert.equal(copies,0);
});
