import test from 'node:test';
import assert from 'node:assert/strict';
import {framePresentationIdentity} from './projected-frame-publication.js';
import {frameProfileCases} from './projected-frame-profile.js';

test('publication identity retains unchanged packed strings without serializing geometry',()=>{
 const frame=frameProfileCases(1280,720).find(c=>c.id==='alpha-always').frame;
 frame.draws[0].vertices='A'.repeat(4*1024*1024);
 const stringify=JSON.stringify;let geometrySerializations=0;
 JSON.stringify=function(value,...args){if(value?.draws||value?.vertices)geometrySerializations++;return stringify(value,...args);};
 try{
  const token=framePresentationIdentity(frame);
  for(let i=0;i<120;i++)assert.equal(framePresentationIdentity(frame,token),token);
  const reparse=structuredClone(frame);reparse.revision++;
  assert.equal(framePresentationIdentity(reparse,token),token,'content, not revision, owns completed-frame proof');
  assert.equal(geometrySerializations,0);
 }finally{JSON.stringify=stringify;}
});

test('in-place edits to initial, material, scissor, order and packed bytes revoke publication identity',()=>{
 const original=frameProfileCases(1280,720).find(c=>c.id==='alpha-always').frame;
 for(const mutate of [f=>f.initial.rgb8[0]++,f=>f.initial.depth=.5,f=>f.draws[0].material.depth.write=!f.draws[0].material.depth.write,
  f=>f.draws[0].scissor={x:1,y:2,width:3,height:4},f=>f.draws[0].vertices+='A',f=>f.draws[0].texture='other',
  f=>f.draws.push({...f.draws[0],id:'new'})]){
  const frame=structuredClone(original),token=framePresentationIdentity(frame);mutate(frame);
  assert.notEqual(framePresentationIdentity(frame,token),token);
 }
 assert.equal(framePresentationIdentity(null),null);
});
