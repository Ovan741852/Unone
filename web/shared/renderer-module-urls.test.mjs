import test from 'node:test';
import assert from 'node:assert/strict';
import {rendererModuleUrls} from './renderer-selection.mjs';
const root=new URL('https://player.invalid/release/content/');

test('custom renderer modules declared in renderer_files are offered for early fetching',()=>{
  const presentation={renderer_mode:'custom',renderer_module:'presentation/renderer.mjs',renderer_files:['presentation/renderer.mjs','presentation/lib/state.js','presentation/style.css','assets/a.png']};
  assert.deepEqual(rendererModuleUrls(presentation,root),['https://player.invalid/release/content/presentation/renderer.mjs','https://player.invalid/release/content/presentation/lib/state.js']);
});

test('official mode, missing lists and malformed paths offer nothing for those entries',()=>{
  assert.deepEqual(rendererModuleUrls({},root),[]);
  assert.deepEqual(rendererModuleUrls({renderer_mode:'custom'},root),[]);
  assert.deepEqual(rendererModuleUrls({renderer_mode:'custom',renderer_files:'presentation/renderer.mjs'},root),[]);
  assert.deepEqual(rendererModuleUrls({renderer_mode:'custom',renderer_files:['../escape.mjs','a//b.mjs','./x.mjs','c:/x.mjs','x.mjs?y','a\\b.mjs',7,'ok.mjs']},root),['https://player.invalid/release/content/ok.mjs']);
});
