import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseFrameProfile,assertFrameOptions,assertFrameSnapshot} from './projected-frame-policy.js';
import {createPlayerRenderer} from '../shared/renderer-selection.mjs';import {createStartupPresentationState} from './startup-presentation-state.js';
test('optional constructor policy preserves omission and rejects wrong target/prerequisites/custom route',async()=>{
 const profile='rgb8_encoded_rebuild_v1';assert.equal(parseFrameProfile(undefined),null);
 for(const value of [null,false,1,'','other'])assert.throws(()=>parseFrameProfile(value));
 const good={backend:'webgl',raster:'upper_left_checked',antialias:false,bloom:false,ao:false};assertFrameOptions(profile,good);
 for(const patch of [{backend:'webgpu'},{raster:'host'},{antialias:true},{bloom:true},{ao:true}])assert.throws(()=>assertFrameOptions(profile,{...good,...patch}));
 let passed;await createPlayerRenderer({}, {},{projected_material_profile:profile},{createOfficial:async(c,o)=>{passed=o;},contentRoot:new URL('http://fixture/content/')});
 assert.equal(passed.projectedMaterialProfile,profile);
 await assert.rejects(createPlayerRenderer({}, {},{renderer_mode:'custom',projected_material_profile:profile},{contentRoot:new URL('http://fixture/content/')}),/OFFICIAL_WEBGL_ONLY/);
 assert.throws(()=>assertFrameSnapshot(profile,{projected_world_visible:true},{draws:[]}),/WORLD_DEPTH_UNSUPPORTED/);
});
test('completed-game token binds the active material profile and Frame revision',()=>{
 const metrics={status:'validated',context_epoch:1,target_generation:1,last_validation:{context_epoch:1,target_generation:1,physical_size:[1280,720],dpr:1}};
 const view={width:1280,height:720,dpr:1,material_profile:'rgb8_encoded_rebuild_v1',frame_revision:1};
 const state=createStartupPresentationState({available:()=>true,metrics:()=>metrics,view:()=>view});state.drawn();
 assert.equal(state.sample().state,'presented');assert.equal(state.metrics().frame_revision,1);
 view.frame_revision=2;assert.equal(state.sample().state,'needs_draw');state.drawn();assert.equal(state.metrics().frame_revision,2);
 state.dispose();assert.throws(()=>state.sample(),/DISPOSED/);
});
