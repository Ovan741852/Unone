import assert from 'node:assert/strict';
import {module,payload,loadProject,tick,readObservation} from './runtime-harness.mjs';
import {simulate,policies} from '../../../_Tools/fishing-quicktest/balance.mjs';
for(const policy of policies){const r=await simulate({seed:42,policy,maxFrames:1200,load:seed=>loadProject(module,payload,BigInt(seed)),tick,observe:()=>readObservation(module).world.observations});assert.ok(r.fired>0,policy.id+' reaches combat');assert.deepEqual(r.invariantFailures,[]);console.log(policy.id+': fired '+r.fired+', battle '+r.battleSeconds.toFixed(1)+'s');}

