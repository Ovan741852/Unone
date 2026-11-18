import test from 'node:test';
import assert from 'node:assert/strict';
import {parseUiTextAtlasSize,parseUiTextAtlasIdleMs} from './ui-text-atlas-policy.js';
import {createPlayerRenderer} from '../shared/renderer-selection.mjs';

test('atlas setting accepts supported page sizes and rejects invalid declarations',()=>{
 assert.equal(parseUiTextAtlasSize(),4096);
 for(const size of [256,512,1024,2048,4096])assert.equal(parseUiTextAtlasSize(size),size);
 for(const size of [null,0,128,300,8192,2048.5,'2048',true])assert.throws(()=>parseUiTextAtlasSize(size),/UI_TEXT_ATLAS_SIZE_INVALID/);
});
test('idle grace has an explicit bounded opt-in and keeps the 30 second default',()=>{
 assert.equal(parseUiTextAtlasIdleMs(),30000);for(const value of [1000,5000,30000,120000])assert.equal(parseUiTextAtlasIdleMs(value),value);
 for(const value of [null,-1,999,120001,1.5,'5000',true])assert.throws(()=>parseUiTextAtlasIdleMs(value),/UI_TEXT_ATLAS_IDLE_INVALID/);
});

test('official renderer receives the opt-in value; custom renderer rejects it',async()=>{
 const hooks={createOfficial:(_canvas,options)=>options,contentRoot:new URL('https://example.test/')};
 assert.equal((await createPlayerRenderer(null,{}, {ui_text_atlas_size:2048},hooks)).uiTextAtlasSize,2048);
 assert.equal((await createPlayerRenderer(null,{}, {},hooks)).uiTextAtlasSize,undefined);
 assert.equal((await createPlayerRenderer(null,{}, {ui_text_atlas_idle_ms:5000},hooks)).uiTextAtlasIdleMs,5000);
 await assert.rejects(()=>createPlayerRenderer(null,{}, {ui_text_atlas_idle_ms:0},hooks),/UI_TEXT_ATLAS_IDLE_INVALID/);
 await assert.rejects(()=>createPlayerRenderer(null,{}, {renderer_mode:'custom',ui_text_atlas_idle_ms:5000},hooks),/UI_TEXT_ATLAS_OFFICIAL_ONLY/);
 await assert.rejects(()=>createPlayerRenderer(null,{}, {ui_text_atlas_size:null},hooks),/UI_TEXT_ATLAS_SIZE_INVALID/);
 await assert.rejects(()=>createPlayerRenderer(null,{}, {renderer_mode:'custom',ui_text_atlas_size:2048},hooks),/UI_TEXT_ATLAS_OFFICIAL_ONLY/);
});
