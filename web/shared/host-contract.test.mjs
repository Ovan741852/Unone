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
