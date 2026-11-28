import test from 'node:test';
import assert from 'node:assert/strict';
import {stageSafeInsets} from './viewport-safe-area.mjs';

test('safe insets intersect the actual stage instead of adding padding twice',()=>{
 const window={width:900,height:400}, insets={left:45,right:45,top:0,bottom:20};
 assert.deepEqual(stageSafeInsets({left:0,top:0,width:900,height:400},window,insets),[5,0,5,5]);
 assert.deepEqual(stageSafeInsets({left:100,top:20,width:700,height:350},window,insets),[0,0,0,0]);
 assert.deepEqual(stageSafeInsets({left:25,top:0,width:800,height:400},window,insets),[2.5,0,0,5]);
});
