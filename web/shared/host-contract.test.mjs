import assert from "node:assert/strict";
import { test } from "node:test";
import { createHostInput } from "./host-input.js";
import { requireAssetEncoding } from "./asset-encoding.js";
test("invalid pointer values are rejected and focus loss drops pending presses", () => {
  const input = createHostInput();
  for (const x of [NaN, Infinity, "1"]) assert.throws(() => input.updatePointer({position:{x,y:0},down:true}), /INPUT_FRAME_INVALID/);
  input.queueAction("Fire"); input.setHeld("Right",true); input.releaseAll();
  assert.deepEqual(input.consumeFrame().actions,{});
});
test("explicit decoder contracts fail closed instead of extension guessing", () => {
  const asset = {id:"asset://image",source:"wrong.png",encoding:{decoder:"image",format:"svg",mime:"image/svg+xml"}};
  requireAssetEncoding(asset,"image");
  assert.throws(() => requireAssetEncoding(asset,"audio"), /HOST_ASSET_ENCODING_UNSUPPORTED/);
  asset.encoding.format_version = "future";
  assert.throws(() => requireAssetEncoding(asset,"image"), /HOST_ASSET_ENCODING_UNSUPPORTED/);
});

test('slider streams preserve per-control edges while coalescing only adjacent drag samples',()=>{
  const input=createHostInput(),q=(id,phase,ratio)=>input.queueSliderInteraction({id,phase,ratio});
  q('a','start',.1);q('a','drag',.2);q('a','drag',.3);q('b','start',.4);q('a','end',.5);q('b','end',.6);
  assert.deepEqual(input.consumeFrame().ui_sliders,{a:{phase:'start',ratio:.1},b:{phase:'start',ratio:.4}});
  assert.deepEqual(input.consumeFrame().ui_sliders,{a:{phase:'drag',ratio:.3},b:{phase:'end',ratio:.6}});
  assert.deepEqual(input.consumeFrame().ui_sliders,{a:{phase:'end',ratio:.5}});
  assert.equal(input.consumeFrame().ui_sliders,undefined);
  q('__proto__','start',.5);assert.deepEqual(Object.keys(input.consumeFrame().ui_sliders),['__proto__']);
});

test('focus reset cancels consumed starts even when their end was still queued and drops stale drag',()=>{
  const input=createHostInput(),q=(phase,ratio)=>input.queueSliderInteraction({id:'volume',phase,ratio});
  q('start',.1);input.consumeFrame();q('drag',.5);q('end',.8);input.releaseAll();
  assert.deepEqual(input.consumeFrame().ui_sliders,{volume:{phase:'cancel',ratio:.1}});
  assert.equal(input.consumeFrame().ui_sliders,undefined);
  q('start',.3);input.releaseAll();assert.equal(input.consumeFrame().ui_sliders.volume.phase,'cancel');
});

test('slider input rejects invalid protocol values and fails closed at bounded queue capacity',()=>{
  const input=createHostInput();
  for(const event of [{id:'',phase:'start',ratio:.5},{id:'x',phase:'move',ratio:.5},{id:'x',phase:'start',ratio:Infinity},{id:'x',phase:'drag',ratio:-.1},{id:'x',phase:'end',ratio:1.1}])assert.throws(()=>input.queueSliderInteraction(event),/UI_SLIDER_INPUT_INVALID/);
  input.queueSliderInteraction({id:'active',phase:'start',ratio:.4});input.consumeFrame();
  for(let i=0;i<256;i++)input.queueSliderInteraction({id:'active',phase:i%2?'drag':'start',ratio:.5});
  assert.throws(()=>input.queueSliderInteraction({id:'active',phase:'end',ratio:1}),/UI_SLIDER_QUEUE_FULL/);
  assert.equal(input.consumeFrame().ui_sliders.active.phase,'cancel');assert.equal(input.consumeFrame().ui_sliders,undefined);
});

test('world pointer cancellation preserves independent semantic controls and keyboard holds',()=>{
  const input=createHostInput();input.updatePointer({position:{x:1,y:2},down:true});
  input.setHeld('KeyW',true);input.queueActionTransition('Pause',true);
  input.queueSliderInteraction({id:'volume',phase:'start',ratio:.4});input.releasePointer();
  const frame=input.consumeFrame();assert.equal(frame.pointer.down,false);assert.deepEqual(frame.actions,{KeyW:true,Pause:true});
  assert.deepEqual(frame.ui_sliders,{volume:{phase:'start',ratio:.4}});assert.equal(input.pendingPointerFrames.length,0);
});
