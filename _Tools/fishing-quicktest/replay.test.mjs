import test from 'node:test';import assert from 'node:assert/strict';
import {frameInput,checkAssertions,validateReplay} from './replay.mjs';
test('replay releases input after sequence ends; legacy constant input stays supported',()=>{
  assert.deepEqual(frameInput({input_sequence:[{actions:{Start:true}}]},1),{actions:{}});
  assert.deepEqual(frameInput({input:{Fire:true}},5),{actions:{Fire:true}});
});
test('failed, missing and unsupported observations never produce a pass',()=>{
  assert.equal(checkAssertions({assertions:[{observation:{key:'coins',equals:8}}]},{coins:8})[0].pass,true);
  assert.equal(checkAssertions({assertions:[{observation:{key:'safe',equals:true}}]},{})[0].pass,false);
  assert.equal(checkAssertions({assertions:[{observation:{key:'safe',equals:true}}]},{safe:false})[0].pass,false);
  assert.equal(checkAssertions({assertions:[{unknown:true}]},{})[0].pass,false);
});
test('replays require matching game code, valid seed and bounded input',()=>{
  const valid={format:'unone.fishing.quicktest.v1',scriptHash:'hash',seed:42,inputs:[{actions:{}}]};
  assert.equal(validateReplay(valid,'hash'),valid);
  for(const patch of [{scriptHash:'old'},{seed:-1},{inputs:[null]},{inputs:Array(120001).fill({})}])assert.throws(()=>validateReplay({...valid,...patch},'hash'));
});
