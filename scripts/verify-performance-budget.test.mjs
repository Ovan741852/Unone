import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPerformance} from './verify-performance-budget.mjs';
const evidence=values=>({version:1,case:{project:'test',seed:42,profile:'release',device:'same device',viewport:[1280,720],simulation_hz:60},runs:values.map(n=>({ticks:600,digest:'sha256:'+'a'.repeat(64),metrics:{tick_ms:n}}))});
const budgets=[{metric:'tick_ms',direction:'lower',max_regression_percent:5,absolute_limit:16.67}];
test('regressions fail; a noisy isolated sample cannot hide the median',()=>{assert.equal(verifyPerformance(evidence([10,10,11]),evidence([11,12,1]),budgets).ok,false);assert.equal(verifyPerformance(evidence([10,10,11]),evidence([8,9,15]),budgets).ok,true);});
test('missing metrics, changed simulation results and mismatched devices are not successes',()=>{for(const mutate of [r=>r.runs[0].metrics.tick_ms=null,r=>r.runs[0].digest='sha256:'+'b'.repeat(64),r=>r.case.device='other',r=>r.runs.pop(),r=>r.case.profile='debug']){const r=evidence([10,10,10]);mutate(r);assert.equal(verifyPerformance(evidence([10,10,10]),r,budgets).ok,false);}});
