import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {gouraudFrameCases} from './projected-frame-gouraud-profile.js';
import {projectedFrame} from '../shared/projected-frame.mjs';
test('fixed independent Gouraud registry preserves expected barycentric samples and color bytes',()=>{
 const gold=JSON.parse(readFileSync(new URL('./fixtures/frame-gouraud-reference.json',import.meta.url)));
 const cases=gouraudFrameCases(1280,720);assert.equal(cases.length,4);
 assert.deepEqual(cases[0].expected.slice(0,4).map(r=>r.rgb),gold.fixed_1280_720_rgb_first_four);
 assert.equal(cases.reduce((n,c)=>n+c.expected.length,0),32);
 for(const row of cases){const decoded=projectedFrame({projected_frame:row.frame});
  const vertices=decoded.draws[0].data.vertices;
  gold.rgba.forEach((rgba,i)=>rgba.forEach((value,c)=>assert.equal(vertices[i*10+6+c],value)));
 }
});
