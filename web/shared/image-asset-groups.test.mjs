import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createAssetCatalog,createImageAssetBroker,validateImagePreloadPlan,installPlayerAssetGroups} from './asset-encoding.js';
function fixture(options={}){
 const assets=['a','b','c'].map(id=>({id,source:id+'.png',kind:'texture2d',encoding:{decoder:'image',format:'png',mime:'image/png'}}));
 const catalog=createAssetCatalog({assets}),raw={version:1,groups:{one:['a','b'],two:['b','c'],empty:[]},startup:[],dimensions:Object.fromEntries(assets.map(a=>[a.id,{format:'png',width:2,height:2}])),budget:{max_bytes:48,max_entries:3},...options.plan};
 const loaded=[],images=new Map();let inspected=0;
 const broker=createImageAssetBroker(catalog,{preloadPlan:raw,resolveAssetUrl:a=>a.source,inspectImage:async()=>{inspected++;return{format:'png',width:2,height:2};},loadImage:async(url,opts)=>{loaded.push(opts.asset.id);if(options.load)return options.load(url,opts);const image={width:2,height:2,closed:0,close(){this.closed++;}};images.set(opts.asset.id,image);return image;},...options.broker});
 return{broker,groups:broker.groups,loaded,images,inspected:()=>inspected,catalog,raw};
}
const flush=()=>new Promise(r=>setImmediate(r));
test('group preload coalesces, load promotes and overlapping groups share decode and budget',async()=>{
 const f=fixture();const a=f.groups.preload('one'),b=f.groups.preload('one');assert.equal(a,b);const c=f.groups.load('one');assert.equal(a,c);const ready=await a;assert.equal(ready.mode,'load');assert.equal(ready.ready,2);assert(Object.isFrozen(ready));assert.equal(f.inspected(),0,'authored dimensions avoid all header requests');
 await f.groups.load('two');assert.deepEqual(f.loaded,['a','b','c']);assert.equal(f.groups.snapshot().held_bytes_estimate,48);assert.equal(f.groups.snapshot().held_entries,3);assert.equal(f.groups.status('two').cache_hits,1);
 f.groups.unload('one');assert.equal(f.images.get('a').closed,1);assert.equal(f.images.get('b').closed,0);assert.equal(f.groups.snapshot().held_bytes_estimate,32);
 f.groups.unload('two');assert.equal(f.images.get('b').closed,1);assert.equal(f.images.get('c').closed,1);f.broker.dispose();
});
test('unload retires only group ownership and never closes a live renderer lease',async()=>{
 const f=fixture();await f.groups.load('one');const renderer=f.broker.acquire('a');f.groups.unload('one');assert.equal(f.images.get('a').closed,0);assert.equal(renderer.state,'ready');assert.equal(f.images.get('b').closed,1);renderer.release();f.broker.dispose();assert.equal(f.images.get('a').closed,1);
});
test('aggregate group budget is atomic and rejects excess without decoding it',async()=>{
 const f=fixture({plan:{budget:{max_bytes:32,max_entries:2}}});await f.groups.preload('one');await assert.rejects(f.groups.load('two'),/IMAGE_ASSET_GROUP_BUDGET/);assert.deepEqual(f.loaded,['a','b']);assert.equal(f.groups.snapshot().held_bytes_estimate,32);assert.equal(f.groups.status('two').state,'error');f.broker.dispose();
});
test('unload cancels pending work; a newer same-name request is not released by stale completion',async()=>{
 const waits=[];const f=fixture({load:(url,{signal})=>new Promise((resolve,reject)=>{waits.push({url,resolve});signal.addEventListener('abort',()=>reject(Object.assign(Error('abort'),{name:'AbortError'})),{once:true});})});
 const pending=f.groups.preload('one');await flush();assert.equal(waits.length,2);const cancelled=f.groups.unload('one');assert.equal(cancelled.cancelled,true);await assert.rejects(pending);assert.equal(f.groups.snapshot().held_entries,0);
 const next=f.groups.load('one');await flush();for(const w of waits.slice(2))w.resolve({width:2,height:2});await next;assert.equal(f.groups.status('one').state,'ready');assert.equal(f.groups.status('one').held,2);f.broker.dispose();
});
test('authored dimensions preserve decode-size validation, reject malformed and undeclared metadata',async()=>{
 const f=fixture({load:async()=>({width:3,height:2})});await assert.rejects(f.groups.load('one'),/DIMENSIONS_CHANGED/);assert.equal(f.groups.snapshot().held_entries,0);f.broker.dispose();
 const valid=fixture();for(const dimensions of [{a:{format:'png',width:0,height:2}},{a:{format:'webp',width:2,height:2}},{other:{format:'png',width:2,height:2}},{a:{format:'png',width:2,height:2,extra:true}}])assert.throws(()=>validateImagePreloadPlan({...valid.raw,dimensions},valid.catalog),/IMAGE_PRELOAD_PLAN_INVALID/);valid.broker.dispose();
});
test('required startup plan uses authored PNG metadata without inspecting network headers',async()=>{
 const f=fixture({plan:{startup:['one']}});const result=await f.broker.prepareScene({entities:[]});assert.equal(result.required_ready_entries,2);assert.equal(f.inspected(),0);f.broker.dispose();
});
test('empty groups are ready, unknown groups and disposed brokers reject explicitly',async()=>{
 const f=fixture();assert.equal((await f.groups.load('empty')).state,'ready');assert.throws(()=>f.groups.load('unknown'),/GROUP_MISSING/);f.broker.dispose();assert.throws(()=>f.groups.preload('one'),/BROKER_DISPOSED/);
});
test('public facade is stable before readiness, frozen and does not replace an existing host',async()=>{
 let broker=null;const target={},remove=installPlayerAssetGroups(target,()=>broker),api=target.unonePlayerAssets;assert(Object.isFrozen(api));assert.equal(api.status().available,false);await assert.rejects(api.load('one'),/GROUPS_NOT_READY/);
 const f=fixture();broker=f.broker;await api.load('one');const sample=api.snapshot({includeTimings:true});assert(Object.isFrozen(sample));assert(Object.isFrozen(sample.groups));assert(Object.isFrozen(sample.loading));assert(Object.isFrozen(sample.loading.recent));assert.equal(sample.loading.completed,2);assert.equal(sample.loading.recent[0].network_ms,null);assert.equal(sample.loading.recent[0].decode_ms,null);assert.equal(api.status('one').held,2);
 for(const bad of [null,[],{extra:true},{includeTimings:1}])assert.throws(()=>api.snapshot(bad),/OPTIONS_INVALID/);
 installPlayerAssetGroups(target,()=>null)();assert.equal(target.unonePlayerAssets,api);remove();assert.equal('unonePlayerAssets'in target,false);broker.dispose();
});

test('default HTML loader measures its load event and decode wait without inventing network bytes',async t=>{
 const previous=globalThis.Image;class MeasuredImage{constructor(){this.width=2;this.height=2;}set src(value){this.url=value;queueMicrotask(()=>this.onload?.());}decode(){return Promise.resolve();}}
 globalThis.Image=MeasuredImage;t.after(()=>{globalThis.Image=previous;});const catalog=createAssetCatalog({assets:[{id:'a',source:'a.png',kind:'texture2d'}]});
 const b=createImageAssetBroker(catalog,{resolveAssetUrl:a=>a.source,preloadPlan:{version:1,groups:{one:['a']},startup:[],dimensions:{a:{format:'png',width:2,height:2}}}});await b.groups.load('one');const timing=b.report({includeTimings:true}).loading_metrics.recent[0];assert(timing.elapsed_ms>=0);assert(timing.queue_ms>=0);assert(timing.load_event_ms>=0);assert(timing.decode_ms>=0);assert.equal(timing.transfer_bytes,null);assert.equal(timing.network_ms,null);b.dispose();
});

test('prototype-sensitive asset IDs do not inherit absent authored dimension records',async()=>{
 const catalog=createAssetCatalog({assets:[{id:'toString',kind:'texture2d',source:'x.png'}]});let inspected=0;
 const b=createImageAssetBroker(catalog,{resolveAssetUrl:a=>a.source,inspectImage:async()=>{inspected++;return{format:'png',width:2,height:2};},loadImage:async()=>({width:2,height:2}),preloadPlan:{version:1,groups:{constructor:['toString']},startup:[],dimensions:{}}});
 assert.equal((await b.groups.load('constructor')).ready,1);assert.equal(inspected,1);b.dispose();
});

test('actual metadata inspector rejects authored-dimension fast hits after disposal or cancellation',async()=>{
 const source=fs.readFileSync(new URL('./asset-encoding.js',import.meta.url),'utf8'),start=source.indexOf('function createImageMetadataInspector(');assert(start>=0);
 const make=vm.runInNewContext(source.slice(start)+'\ncreateImageMetadataInspector',{AbortController,imageDimensions:im=>({width:im.width,height:im.height,bytes:im.width*im.height*4}),abortImageError:()=>Object.assign(Error('IMAGE_ASSET_CANCELLED'),{name:'AbortError'})});
 let reads=0;const inspector=make({specFor:()=>({id:'a'}),entries:new Map(),dimensions:{a:{format:'png',width:2,height:2}},resolveAssetUrl:()=>{reads++;return'a.png';},inspectImage:()=>{reads++;},schedule:fn=>fn(),maxEntries:1});
 assert.equal((await inspector.inspect('a')).width,2);const cancelled=new AbortController();cancelled.abort();await assert.rejects(inspector.inspect('a',{signal:cancelled.signal}),{name:'AbortError'});
 inspector.dispose();await assert.rejects(inspector.inspect('a'),{name:'AbortError'});assert.equal(reads,0);
});
