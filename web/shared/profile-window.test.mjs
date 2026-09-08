import test from 'node:test';
import assert from 'node:assert/strict';
import {createProfileWindow} from './profile-window.js';
test('windows reset, freeze and bound samples independently of total counts',()=>{
 const p=createProfileWindow(2);p.start();
 for(const n of [1,2,3])p.tick({input_ms:n,wasm_tick_publish_ms:n*10,decode_ms:n*2});
 p.stop();const r=p.read();assert.equal(r.tick_count,3);assert.equal(r.cpu.input_ms.samples,2);assert.equal(r.cpu.input_ms.mean_ms,2.5);
 p.tick({});assert.deepEqual(p.read(),r);p.start();assert.equal(p.read().tick_count,0);assert.equal(p.read().id,2);
});
