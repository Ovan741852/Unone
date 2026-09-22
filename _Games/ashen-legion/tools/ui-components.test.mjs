import test from 'node:test';
import assert from 'node:assert/strict';
import {isControl} from '../presentation/ui-components.mjs';

test('resource badges keep their own text bounds, including large balances',()=>{
 for(const resource of ['gold','crystal'])for(const text of ['0','320','999999']){
  assert.equal(isControl({kind:'text',text},{asset:'texture://ui_hud-'+resource}),false);
 }
});

test('enabled, disabled and icon buttons retain plate-based hit and label layout',()=>{
 assert.equal(isControl({kind:'button'},{asset:'texture://ui_hud-key'}),true);
 for(const skin of ['shop-button-primary-v2','shop-button-secondary-v2','control-quiet-v3']){
  for(const kind of ['button','text'])assert.equal(isControl({kind},{asset:'texture://ui_'+skin}),true);
 }
 assert.equal(isControl({kind:'text'},undefined),false);
});
