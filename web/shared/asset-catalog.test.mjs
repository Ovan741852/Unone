import test from 'node:test';
import assert from 'node:assert/strict';
import * as encoding from './asset-encoding.js';
const api=()=>{assert.equal(typeof encoding.createAssetCatalog,'function','createAssetCatalog export');return encoding;};
const legacy=m=>new Map((m?.assets??[]).map(a=>[String(a.id),a]));
const sample=()=>({version:3,assets:[{id:'a',kind:'texture2d',source:'a.png',encoding:{decoder:'image',format:'png',mime:'image/png'}},{id:7,kind:'audio',source:'s.wav'},{id:'a',kind:'texture2d',source:'a2.png'}]});
test('index matches the legacy per-draw Map exactly: String(id) keys, last duplicate wins, same order',()=>{
 const {createAssetCatalog}=api();
 for(const m of [sample(),{assets:[]},{},null,undefined]){
  const c=createAssetCatalog(m),l=legacy(m);
  assert.deepEqual([...c.specs.entries()],[...l.entries()]);assert.equal(c.specs.size,l.size);assert.equal(c.size,l.size);
  for(const k of [...l.keys(),'missing'])assert.deepEqual(c.specs.get(k),l.get(k));
 }
 assert.equal(createAssetCatalog(sample()).specs.get('a').source,'a2.png');assert.equal(createAssetCatalog(sample()).specs.get('7').kind,'audio');
});
test('catalogs are immutable snapshots with monotonic generations; the index view is read-only',()=>{
 const {createAssetCatalog,isAssetCatalog}=api(),m=sample(),a=createAssetCatalog(m),b=createAssetCatalog(m);
 assert(b.generation>a.generation);assert(isAssetCatalog(a));assert.equal(isAssetCatalog({...a}),false);
 assert(Object.isFrozen(a)&&Object.isFrozen(a.manifest)&&Object.isFrozen(a.manifest.assets)&&Object.isFrozen(a.specs.get('a'))&&Object.isFrozen(a.manifest.assets[0].encoding));
 assert.equal(typeof a.specs.set,'undefined');assert.equal(a.specs instanceof Map,false);
 assert.throws(()=>{'use strict';a.manifest.assets.push({id:'x'});},TypeError);
 // Default (non-adopting) catalogs copy: later in-place edits of the caller's manifest do not leak in.
 m.assets[0].source='changed.png';m.assets.length=1;assert.equal(a.specs.get('a').source,'a2.png');assert.equal(a.size,2);
 assert.equal(Object.isFrozen(m),false,'caller manifest untouched by a copying catalog');
});
test('adopting catalogs freeze the owner manifest in place, so in-place mutation fails loudly instead of desynchronizing',()=>{
 const {createAssetCatalog}=api(),m=sample(),c=createAssetCatalog(m,{adopt:true});
 assert.equal(c.manifest,m);assert(Object.isFrozen(m.assets[0].encoding));
 assert.throws(()=>{m.assets[0].source='x';},TypeError);assert.throws(()=>{m.assets.push({id:'y'});},TypeError);assert.equal(c.specs.get('a').source,'a2.png');
});
test('invalid manifests are rejected atomically: nothing frozen, no generation consumed',()=>{
 const {createAssetCatalog}=api(),probe=createAssetCatalog({}).generation;
 for(const bad of [[],'x',{assets:{}},{assets:[null]},{assets:[{id:'a'},3]},{assets:[{id:'a',f(){}}]}]){
  assert.throws(()=>createAssetCatalog(bad,{adopt:true}),/ASSET_CATALOG_INVALID/);
  if(bad&&typeof bad==='object')assert.equal(Object.isFrozen(bad),false);
 }
 assert.equal(createAssetCatalog({}).generation,probe+1);
 const {assetCatalogSpecs}=encoding;assert.throws(()=>assetCatalogSpecs({specs:new Map()}),/ASSET_CATALOG_REQUIRED/);
});
