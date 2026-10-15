import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayerRenderer,createRendererDisposer} from '../web/shared/renderer-selection.mjs';

const renderer = () => ({draw(){}, ready(){}, metrics(){return{};}, setBloom(){}, dispose(){}});
const root = new URL('https://example.test/releases/fixture/content/');
test('default uses official renderer and never loads a custom module', async () => {
  let loaded = false;
  const expected = renderer();
  const result = await createPlayerRenderer('canvas', {bloom:true}, {}, {
    createOfficial:(canvas, options) => {assert.equal(canvas, 'canvas');assert.equal(options.bloom,true);return expected;},
    loadModule:() => {loaded=true;throw Error('unexpected module');}, contentRoot:root,
  });
  assert.equal(result, expected);assert.equal(loaded, false);
});
test('custom renderer requires explicit mode and a complete entry declaration', async () => {
  for (const presentation of [
    {renderer_module:'render.mjs'}, {renderer_files:['render.mjs']},
    {renderer_mode:'unknown'}, {renderer_mode:'custom'},
    {renderer_mode:'custom',renderer_module:'render.mjs',renderer_files:[]},
    {renderer_mode:'custom',renderer_module:'../render.mjs',renderer_files:['../render.mjs']},
    {renderer_mode:'custom',renderer_module:'host/%2e%2e/render.mjs',renderer_files:['host/%2e%2e/render.mjs']},
    {renderer_mode:'custom',renderer_module:'render.mjs',renderer_files:'render.mjs'},
  ]) {
    await assert.rejects(createPlayerRenderer(null, {}, presentation, {createOfficial:renderer, contentRoot:root}));
  }
});
test('explicit custom module resolves within the packaged generation and exposes player contract', async () => {
  const presentation={renderer_mode:'custom',renderer_module:'host/render.mjs',renderer_files:['host/render.mjs','host/helper.mjs']};
  const expected=renderer();
  const result=await createPlayerRenderer('canvas',{bloom:true},presentation,{
    createOfficial:()=>{throw Error('unexpected official renderer');},contentRoot:root,
    loadModule:async url=>{assert.equal(url,'https://example.test/releases/fixture/content/host/render.mjs');return {createRenderer:(canvas,options)=>{assert.equal(canvas,'canvas');assert.equal(options.bloom,true);return expected;}};},
  });
  assert.equal(result, expected);
  for (const module of [{},{createRenderer:()=>({draw(){}})}, {createRenderer:()=>{const result=renderer();delete result.dispose;return result;}}]) {
    await assert.rejects(createPlayerRenderer(null,{},presentation,{contentRoot:root,loadModule:async()=>module}), /RENDERER_(FACTORY_REQUIRED|CONTRACT_INVALID)/);
  }
});
test('fatal errors and pagehide share one renderer teardown, including cleanup failure', () => {
  const dispose=createRendererDisposer();let count=0;
  const first={dispose(){count++;}};
  dispose(null);dispose(first);dispose(first);assert.equal(count,1);
  const failing={dispose(){count++;throw Error('cleanup failed');}};
  assert.throws(()=>dispose(failing),/cleanup failed/);dispose(failing);assert.equal(count,2);
  dispose({dispose(){count++;}});assert.equal(count,3);
});
test('a malformed custom renderer is cleaned up before reporting the contract failure', async () => {
  let count=0;
  const presentation={renderer_mode:'custom',renderer_module:'render.mjs',renderer_files:['render.mjs']};
  await assert.rejects(createPlayerRenderer(null,{},presentation,{
    contentRoot:root,loadModule:async()=>({createRenderer:()=>({dispose(){count++;throw Error('cleanup error');}})}),
  }), /RENDERER_CONTRACT_INVALID: missing draw/);
  assert.equal(count,1);
});
