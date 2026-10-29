import test from 'node:test';
import assert from 'node:assert/strict';
import {publishRasterState,assertRasterReady} from './raster-diagnostics.mjs';
test('READY requires actual current validation and a legal game draw; an old result is not a restored lease',()=>{
 const valid={projected:{requested:'upper_left_checked',status:'validated',context_epoch:1,target_generation:1,last_validation:{context_epoch:1,target_generation:1}}};
 for(const status of ['unchecked','checking','lost','failed','disposed'])
  assert.throws(()=>assertRasterReady({projected:{...valid.projected,status}},1),/NOT_VALIDATED/);
 assert.throws(()=>assertRasterReady(valid,0),/NOT_VALIDATED/);assert.doesNotThrow(()=>assertRasterReady(valid,1));
 assert.throws(()=>assertRasterReady({projected:{...valid.projected,context_epoch:2}},1),/NOT_VALIDATED/);
 assert.throws(()=>assertRasterReady({projected:{...valid.projected,target_generation:2}},1),/NOT_VALIDATED/);
 assert.doesNotThrow(()=>assertRasterReady({projected:{requested:'host',status:'host'}},0));
});
test('loss/unchecked/current epoch are immediately public without replaying historical READY',()=>{
 const metrics={first_presented_ms:12},body={dataset:{}},messages=[];
 for(const [status,epoch] of [['lost',1],['unchecked',2],['checking',2],['validated',2]]){
  publishRasterState(metrics,body,{projected:{status,context_epoch:epoch}},m=>messages.push(m));
  assert.equal(JSON.parse(body.dataset.playerMetrics).raster.projected.status,status);
  assert.equal(JSON.parse(body.dataset.playerRaster).projected.context_epoch,epoch);
 }
 assert.equal(messages.length,4);assert.ok(messages.every(m=>m.startsWith('UNONE_RASTER_STATE ')));
 assert.ok(!messages.some(m=>m.includes('PLAYER_READY')));assert.equal(metrics.first_presented_ms,12);
});
