import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectedFrameDecoder,projectedFrame} from '../../web/shared/projected-frame.mjs';
import {createSyntheticProducer} from './claude-c01-synthetic-scene.mjs';
// Exact equality over changing synthetic sequences, including host reparses and redraws.
for(const scenario of ['level33','capacity620'])test(`retained decoder equals uncached decoder over ${scenario} updates`,()=>{
 const producer=createSyntheticProducer(scenario),decoder=createProjectedFrameDecoder();
 for(let i=0;i<25;i++){
  const {snapshot}=producer.step(),parsed=JSON.parse(JSON.stringify(snapshot));
  const expected=projectedFrame(parsed);
  assert.deepEqual(decoder.decode(parsed),expected);
  assert.deepEqual(decoder.decode(parsed),expected,'redraw of the same snapshot');
 }
 assert.equal(decoder.metrics().retained_geometries,producer.drawCount);
});
