// The refresh tool assembles a production player like `game export web`, so it
// must write the same resolved error_policy (crates/unone-cli/src/export.rs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveErrorPolicy} from './web-export-content.mjs';

test('refreshed production players recover unless the project declares otherwise',()=>{
 assert.deepEqual(resolveErrorPolicy(undefined),{ui_capacity:'keep_previous',script_errors:'continue',max_consecutive_script_errors:60});
 assert.deepEqual(resolveErrorPolicy({}),{ui_capacity:'fail',script_errors:'fail',max_consecutive_script_errors:60},'declared fields default to strict');
 assert.deepEqual(resolveErrorPolicy({script_errors:'continue',max_consecutive_script_errors:5}),{ui_capacity:'fail',script_errors:'continue',max_consecutive_script_errors:5});
 for(const declared of [null,[],'continue',{ui_capacity:'truncate'},{retries:2},{max_consecutive_script_errors:0},{max_consecutive_script_errors:3601}])
  assert.throws(()=>resolveErrorPolicy(declared),/ERROR_POLICY_INVALID/,JSON.stringify(declared));
});
