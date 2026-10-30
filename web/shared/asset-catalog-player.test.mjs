// Actual official-player start() lines: manifest fetch, catalog creation and the renderer factory call.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as encoding from './asset-encoding.js';
const source=fs.readFileSync(process.env.UNONE_CATALOG_MAIN_SOURCE??new URL('../player/main.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const lines=source.split('\n');
const pick=pred=>lines.filter(pred).join('\n');
const fetchLine=pick(l=>l.trimStart().startsWith('const [project,assets,presentation]=await Promise.all('));
const catalogLine=pick(l=>l.includes('createAssetCatalog(')&&!l.trimStart().startsWith('import'));
const rendererLine=pick(l=>l.trimStart().startsWith('renderer=await adoptStartupRenderer('));
async function start(assets){
 let options=null;
 const context={...encoding,renderPasses:{},json:async path=>path==='content/assets.json'?assets:{config:{}},uiAssetManifest:null,projectPayload:null,profiler:null,canvas:{},metrics:{},document:{body:{}},
  publishRasterState(){},console,backend:{memory(){}},presentationMemory:null,requireAssetEncoding:encoding.requireAssetEncoding,URL,
  createPlayerRenderer:(canvas,o)=>{options=o;return {};},adoptStartupRenderer:async factory=>factory(),createThreeRenderer(){},startupAbort:new AbortController(),disposeRenderer(){},renderer:null};
 vm.createContext(context);vm.runInContext(`async function start(){${fetchLine}\n${catalogLine}\n${rendererLine}\n}`,context);await context.start();
 return {options,context};
}
test('official player grants one immutable catalog of the fetched manifest to the renderer',async()=>{
 assert(fetchLine&&rendererLine,'production start() lines found');
 const assets={assets:[{id:'white',kind:'texture2d',source:'white.png'},{id:'b',kind:'audio',source:'b.wav'}]};
 const {options}=await start(assets);
 assert.equal(typeof options.getAssetCatalog,'function','renderer receives an explicit catalog grant');
 const catalog=options.getAssetCatalog();assert(encoding.isAssetCatalog(catalog));
 assert.equal(options.getAssetCatalog(),catalog,'same generation across draws');
 assert.equal(catalog.manifest,assets,'catalog adopts the player-owned fetched manifest (no second copy)');
 assert.equal(options.getAssetManifest(),assets,'legacy callers read the same single manifest');
 assert(Object.isFrozen(assets.assets[0]),'adopted manifest is frozen, so it cannot drift from the index');
 assert.equal(catalog.specs.get('white').source,'white.png');
});
test('a malformed fetched manifest fails start() with ASSET_CATALOG_INVALID before the renderer exists',async()=>{
 await assert.rejects(start({assets:[null]}),/ASSET_CATALOG_INVALID/);
});
