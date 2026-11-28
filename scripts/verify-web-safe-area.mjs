import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createRuntimeCore} from '../web/shared/runtime-core.mjs';

// Exercise the shipped loader, its actual WASM and the same transport as the player.
async function loadModule(dir) {
  const manifest = JSON.parse(await readFile(path.join(dir, 'runtime.json'), 'utf8'));
  const loader = await readFile(path.join(dir, manifest.javascript), 'utf8');
  const wasmBinary = await readFile(path.join(dir, manifest.wasm));
  return new Promise((resolve, reject) => {
    const context = vm.createContext({
      console, TextEncoder, TextDecoder, URL, setTimeout, clearTimeout, performance, crypto: webcrypto,
      window: {}, document: {currentScript: {src: 'file:///unone-player.js'}},
      Module: {
        noInitialRun: true, wasmBinary, print() {}, printErr: console.error,
        onAbort: reject, onRuntimeInitialized() { resolve(context.Module); },
      },
    });
    vm.runInContext(loader, context);
  });
}

const script = `
  local function view(api)
    local v = api.ui.getViewport()
    if v.safeInsets == nil then return {aspect=v.aspect} end
    return {aspect=v.aspect, revision=v.revision, insets=v.safeInsets,
      bounds=v.safeBounds, rect=api.ui.fitSafeArea({x=0,y=0,width=100,height=100})}
  end
  return {
    start=function(api) api.observation.set('first',view(api)) end,
    update=function(api) api.observation.set('current',view(api)) end,
  }
`;

async function verify(dir, supportsSafeArea) {
  const module = await loadModule(dir);
  assert.equal(typeof module._unone_web_set_viewport_safe_area === 'function', supportsSafeArea);
  const core = createRuntimeCore(module);
  try {
    const payload = {
      config: {name:'viewport smoke', entry_script:'main.luau', systems:{
        physics2d:false, physics3d:false, audio:false, save:false, jobs:false, particle:false,
        spine:false, effekseer:false,
      }},
      script, viewport_size:[1200,600], viewport_safe_area:[10,3,20,7],
    };
    const original = JSON.stringify(payload);
    const loaded = await core.execute({kind:'load', payload, seed:'42'});
    const first = loaded.world.observations.first;
    assert.equal(first.aspect, 2);
    assert.equal(JSON.stringify(payload), original);
    if (supportsSafeArea) {
      assert.deepEqual(first.insets, {left:10, top:3, right:20, bottom:7});
      assert.deepEqual(first.bounds, {left:10, top:3, width:70, height:90});
      assert.deepEqual(first.rect, {x:10, y:7, width:70, height:90});
    } else {
      assert.deepEqual(first, {aspect:2});
    }
    const tick = async () => (await core.execute({kind:'tick', input:{actions:{}}})).world.observations.current;
    const unchanged = await core.execute({kind:'safeArea', value:[10,3,20,7]});
    assert.equal(unchanged.world.frame, loaded.world.frame);
    assert.deepEqual(await tick(), first);
    await core.execute({kind:'safeArea', value:[0,5,10,2]});
    const next = await tick();
    if (supportsSafeArea) {
      assert.equal(next.revision, first.revision + 1);
      assert.deepEqual(next.rect, {x:0, y:2, width:90, height:93});
    } else {
      assert.deepEqual(next, first);
    }
    console.log(JSON.stringify({runtime:dir, supportsSafeArea, firstFrame:first, resized:next}));
  } finally {
    core.close();
  }
}

const [current, legacy] = process.argv.slice(2);
if (!current || !legacy) throw new Error('Usage: node scripts/verify-web-safe-area.mjs current-runtime-dir legacy-runtime-dir');
await verify(current, true);
await verify(legacy, false);
