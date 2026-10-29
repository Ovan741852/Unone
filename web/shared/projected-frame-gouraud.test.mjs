import {test} from 'node:test';import assert from 'node:assert/strict';
import {projectedFrame} from './projected-frame.mjs';
import {frameFixture} from './projected-frame.test.mjs';
import {parseFrameProfile,assertFrameSnapshot} from '../renderer/projected-frame-policy.js';
const profile='rgb8_encoded_gouraud_v1';
function gradient(){
 const frame=frameFixture(),vertices=Buffer.from(frame.draws[0].vertices,'base64');
 [[1,0,0,.25],[0,1,0,.75],[0,0,1,1]].forEach((rgba,i)=>rgba.forEach((v,c)=>vertices.writeFloatLE(v,i*40+24+c*4)));
 frame.draws[0].vertices=vertices.toString('base64');return frame;
}
test('new explicit Gouraud profile preserves per-vertex RGB and alpha; legacy rejects',()=>{
 const f=gradient();assert.throws(()=>projectedFrame({projected_frame:f}),/constant triangle/);
 f.profile=profile;const decoded=projectedFrame({projected_frame:f});
 assert.equal(decoded.profile,profile);assert.equal(decoded.draws[0].data.vertices[19],.75);
 assert.equal(parseFrameProfile(profile),profile);
});
test('presentation and published Frame profile must match',()=>{
 const old=frameFixture(),world={projected_frame:old,projected_world_visible:false};
 assert.throws(()=>assertFrameSnapshot(profile,world,old),/PROFILE_MISMATCH/);
});
