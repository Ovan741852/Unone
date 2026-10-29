import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isProjectedBase64} from './projected-base64.js';
const old=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
test('shape matches prior regex for exhaustive short alphabet and malformed padding',()=>{
 const alphabet=['A','/','=','!'];
 for(let size=0;size<=8;size++)for(let value=0;value<4**size;value++){
  let s='',v=value;for(let n=0;n<size;n++){s+=alphabet[v%4];v=Math.floor(v/4);}
  assert.equal(isProjectedBase64(s),old.test(s),JSON.stringify(s));
 }
 for(const s of [null,12,{},[],undefined])assert.equal(isProjectedBase64(s),false);
});
test('large bounded payload has no grouped-regexp stack growth',()=>{
 const s='AAAA'.repeat(3_495_254);assert.equal(isProjectedBase64(s),true);
 assert.equal(isProjectedBase64(s.slice(0,-1)+'!'),false);
});
