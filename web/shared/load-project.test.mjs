import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleProject} from './load-project.js';
test('assembly preserves every config declaration without a field allowlist',async()=>{
  const config={name:'test',entry_script:'main.luau',main_scene:'scene.json',audio:{categories:{music:{fade_in_frames:2}}},future_declaration:{nested:true}};
  const result=await assembleProject(config,async name=>{assert.equal(name,'main.luau');return 'return {}';},async name=>{assert.equal(name,'scene.json');return {entities:[]};});
  assert.deepEqual(JSON.parse(JSON.stringify(result)).config,config);
  assert.equal(result.script,'return {}');
});
