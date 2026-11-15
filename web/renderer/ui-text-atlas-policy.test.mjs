import test from 'node:test';
import assert from 'node:assert/strict';
import {parseUiTextAtlasSize} from './ui-text-atlas-policy.js';
import {createPlayerRenderer} from '../shared/renderer-selection.mjs';

test('atlas setting accepts supported page sizes and rejects invalid declarations',()=>{
 assert.equal(parseUiTextAtlasSize(),4096);
 for(const size of [256,512,1024,2048,4096])assert.equal(parseUiTextAtlasSize(size),size);
 for(const size of [null,0,128,300,8192,2048.5,'2048',true])assert.throws(()=>parseUiTextAtlasSize(size),/UI_TEXT_ATLAS_SIZE_INVALID/);
});

test('official renderer receives the opt-in value; custom renderer rejects it',async()=>{
 const hooks={createOfficial:(_canvas,options)=>options,contentRoot:new URL('https://example.test/')};
 assert.equal((await createPlayerRenderer(null,{}, {ui_text_atlas_size:2048},hooks)).uiTextAtlasSize,2048);
 assert.equal((await createPlayerRenderer(null,{}, {},hooks)).uiTextAtlasSize,undefined);
 await assert.rejects(()=>createPlayerRenderer(null,{}, {ui_text_atlas_size:null},hooks),/UI_TEXT_ATLAS_SIZE_INVALID/);
 await assert.rejects(()=>createPlayerRenderer(null,{}, {renderer_mode:'custom',ui_text_atlas_size:2048},hooks),/UI_TEXT_ATLAS_OFFICIAL_ONLY/);
});
