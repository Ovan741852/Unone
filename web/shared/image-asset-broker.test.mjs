import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssetCatalog,createImageAssetBroker} from './asset-encoding.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const image=(id,width=2,height=2)=>({id,width,height,closed:0,close(){this.closed++;}});
const spec=id=>({id,kind:'texture2d',source:id+'.png'});
function fixture(ids=['a','b','c'],options={}){
 const catalog=createAssetCatalog({assets:ids.map(spec)}),images=new Map(),loads=[],inspections=[];
 const broker=createImageAssetBroker(catalog,{resolveAssetUrl:asset=>asset.source,loadImage:async(url,{asset})=>{loads.push(asset.id);const value=image(asset.id);images.set(asset.id,value);return value;},inspectImage:async(url,{asset})=>{inspections.push(asset.id);return{format:'png',width:2,height:2};},...options});
 return{broker,images,loads,inspections};
}
const scene=ids=>({entities:ids.map(asset=>({sprite:{asset,visible:false}}))});

test('requires private catalog, declared image assets, supported encoding and integer budgets',()=>{
 assert.throws(()=>createImageAssetBroker({assets:[]},{resolveAssetUrl:()=>''}),/ASSET_CATALOG_REQUIRED/);
 const catalog=createAssetCatalog({assets:[spec('a'),{id:'sound',kind:'audio',source:'a.wav'},{...spec('wrong'),encoding:{decoder:'image',format:'bmp',mime:'image/bmp'}}]});
 for(const options of [{sceneMaxBytes:-1},{unusedMaxBytes:NaN},{sceneMaxEntries:1.5},{unusedMaxEntries:Infinity}])assert.throws(()=>createImageAssetBroker(catalog,{resolveAssetUrl:()=>'',...options}),/IMAGE_ASSET_BUDGET/);
 const broker=createImageAssetBroker(catalog,{resolveAssetUrl:()=>''});
 assert.throws(()=>broker.acquire('missing'),/IMAGE_ASSET_MISSING/);assert.throws(()=>broker.acquire('sound'),/IMAGE_ASSET_KIND/);assert.throws(()=>broker.acquire('wrong'),/HOST_ASSET_ENCODING_UNSUPPORTED/);broker.dispose();assert.throws(()=>broker.acquire('a'),/BROKER_DISPOSED/);
});

test('singleflight ready acquisition is synchronous and only the final owner releases pixels',async()=>{
 const f=fixture(['a'],{unusedMaxBytes:0,unusedMaxEntries:0}),a=f.broker.acquire('a'),b=f.broker.acquire('a');
 assert.equal(a.state,'loading');const decoded=await a.promise;assert.equal(await b.promise,decoded);assert.equal(f.loads.length,1);
 const cursor=f.broker.acquire('a');assert.equal(cursor.state,'ready');assert.equal(cursor.image,decoded);assert.equal(cursor.error,null);assert.equal(f.broker.report().active_entries,1);
 a.release();a.release();assert.equal(a.image,null);assert.equal(a.state,'error');assert.match(a.error.message,/LEASE_RELEASED/);assert.equal(decoded.closed,0);b.release();assert.equal(decoded.closed,0);cursor.release();assert.equal(decoded.closed,1);assert.equal(f.broker.report().resident_entries,0);f.broker.dispose();assert.equal(decoded.closed,1);
});

test('unused decoded images use an aggregate LRU bound while active images remain pinned',async()=>{
 const f=fixture(['a','b','c'],{sceneMaxBytes:0,sceneMaxEntries:0,unusedMaxBytes:16,unusedMaxEntries:1});
 const a=f.broker.acquire('a');await a.promise;a.release();const b=f.broker.acquire('b');await b.promise;b.release();assert.equal(f.images.get('a').closed,1);assert.equal(f.images.get('b').closed,0);
 const c=f.broker.acquire('c');await c.promise;assert.equal(f.broker.report().unused_bytes_estimate,16);assert.equal(f.broker.report().active_bytes_estimate,16);assert.equal(f.broker.report().pressure_bytes,16);assert.equal(f.images.get('c').closed,0);c.release();assert.equal(f.images.get('b').closed,1);assert.equal(f.broker.report().unused_entries,1);f.broker.dispose();assert.equal(f.images.get('c').closed,1);
});

test('hidden scene sprites are unique dependencies, with no unrelated manifest scan',async()=>{
 const f=fixture(['a','b','unrelated'],{unusedMaxBytes:0,unusedMaxEntries:0});
 const result=await f.broker.prepareScene(scene(['a','b','a']));assert.equal(result.partial,false);assert.equal(result.declared_entries,2);assert.equal(result.ready_entries,2);assert.equal(result.reserved_bytes,32);assert.deepEqual(f.inspections.sort(),['a','b']);assert.deepEqual(f.loads.sort(),['a','b']);assert(Object.isFrozen(result));assert(Object.isFrozen(result.errors));
 const lease=f.broker.acquire('b');assert.equal(lease.state,'ready');assert.equal(lease.image,f.images.get('b'));lease.release();assert.equal(f.images.get('b').closed,0);assert.equal(f.broker.report().scene_entries,2);assert.equal(f.broker.report().unused_entries,0);
 for(let n=0;n<2000;n++)f.broker.report();assert.equal(f.images.get('a').closed,0);await f.broker.prepareScene({entities:{id:{sprite:{asset:'b',visible:false}}}});assert.equal(f.images.get('a').closed,1);assert.equal(f.images.get('b').closed,0);assert.equal(f.loads.filter(x=>x==='b').length,1);f.broker.dispose();assert.equal(f.images.get('b').closed,1);
});

test('budget and unknown formats are explicit partial preparation, preserving lazy use',async()=>{
 const f=fixture(['a','b','c'],{sceneMaxBytes:16,sceneMaxEntries:2,inspectImage:async(url,{asset})=>asset.id==='a'?null:{format:'png',width:2,height:2}});
 const result=await f.broker.prepareScene(scene(['a','b','c']));assert.equal(result.partial,true);assert.equal(result.ready_entries,1);assert.deepEqual(result.unsupported,[{id:'a',reason:'unknown_bounded_dimensions_or_non_png'}]);assert.deepEqual(result.budget_skipped,[{id:'c',reason:'scene_entry_budget'}]);assert.deepEqual(f.loads,['b']);
 const lazy=f.broker.acquire('a');await lazy.promise;assert.equal(lazy.state,'ready');lazy.release();f.broker.dispose();
 const tooLarge=fixture(['a'],{sceneMaxBytes:15});const over=await tooLarge.broker.prepareScene(scene(['a']));assert.equal(over.ready_entries,0);assert.equal(over.partial,true);assert.deepEqual(tooLarge.loads,[]);assert.equal(over.budget_skipped[0].reason,'scene_byte_budget');tooLarge.broker.dispose();
});

test('decoded dimensions must match the reserved scene header, including an already ready image',async()=>{
 const f=fixture(['a'],{loadImage:async()=>image('a',3,3)});const result=await f.broker.prepareScene(scene(['a']));assert.equal(result.partial,true);assert.equal(result.ready_entries,0);assert.match(result.errors[0].message,/DIMENSIONS_CHANGED/);assert.equal(f.broker.report().resident_bytes_estimate,0);f.broker.dispose();
 const g=fixture(['a']);const lease=g.broker.acquire('a');await lease.promise;g.broker.dispose();assert.equal(lease.image.closed,0);lease.release();assert.equal(g.images.get('a').closed,1);
 const h=fixture(['a'],{inspectImage:async()=>({format:'png',width:3,height:3})});const active=h.broker.acquire('a');await active.promise;const mismatch=await h.broker.prepareScene(scene(['a']));assert.equal(mismatch.partial,true);assert.match(mismatch.errors[0].message,/DIMENSIONS_CHANGED/);assert.equal(active.state,'ready');assert.equal(active.image.closed,0);active.release();h.broker.dispose();
});

test('global preflight and decode work never exceeds two concurrent tasks',async()=>{
 let active=0,maximum=0;const pending=[];
 const enter=async value=>{active++;maximum=Math.max(maximum,active);const wait=deferred();pending.push(wait);await wait.promise;active--;return value;};
 const f=fixture(['a','b','c','d'],{inspectImage:()=>enter({format:'png',width:2,height:2}),loadImage:(url,{asset})=>enter(image(asset.id))});
 const plan=f.broker.prepareScene(scene(['a','b','c','d']));let finished=false;plan.finally(()=>{finished=true;});
 for(let i=0;i<20&&!finished;i++){await tick();for(const p of pending.splice(0))p.resolve();}
 assert.equal((await plan).ready_entries,4);assert.equal(maximum,2);f.broker.dispose();
});

test('a released pending load is cancelled and late pixels cannot repopulate or close a new generation',async()=>{
 const first=deferred(),late=image('old');let count=0,signal;
 const f=fixture(['a'],{unusedMaxBytes:0,unusedMaxEntries:0,loadImage:(url,options)=>{count++;if(count===1){signal=options.signal;return first.promise;}return Promise.resolve(image('new'));}});
 const old=f.broker.acquire('a');await tick();old.release();assert.equal(signal.aborted,true);await assert.rejects(old.promise,/CANCELLED/);const current=f.broker.acquire('a');await current.promise;first.resolve(late);await tick();assert.equal(late.closed,1);assert.equal(current.state,'ready');assert.equal(current.image.id,'new');assert.equal(current.image.closed,0);current.release();f.broker.dispose();
});

test('dispose cancels loading work, fences late results and keeps existing active pixels until release',async()=>{
 const pending=deferred(),late=image('late');const f=fixture(['a'],{loadImage:()=>pending.promise});const a=f.broker.acquire('a');await tick();f.broker.dispose();await assert.rejects(a.promise,/CANCELLED/);pending.resolve(late);await tick();assert.equal(late.closed,1);a.release();assert.equal(late.closed,1);assert.equal(f.broker.report().resident_entries,0);
 const g=fixture(['a']);const held=g.broker.acquire('a');await held.promise;const value=held.image;g.broker.dispose();assert.equal(value.closed,0);assert.equal(held.image,value);held.release();assert.equal(value.closed,1);
});

test('queued cancellation immediately drops its task while unrelated active work is still pending',async()=>{
 const pending=new Map([['a',deferred()],['b',deferred()]]);const f=fixture(['a','b','c'],{loadImage:(url,{asset})=>pending.get(asset.id).promise,unusedMaxBytes:0,unusedMaxEntries:0});
 const a=f.broker.acquire('a'),b=f.broker.acquire('b'),c=f.broker.acquire('c');await tick();assert.equal(f.broker.report().active_tasks,2);assert.equal(f.broker.report().queued_tasks,1);
 c.release();await assert.rejects(c.promise,/CANCELLED/);assert.equal(f.broker.report().queued_tasks,0);assert.equal(f.broker.report().resident_entries,2);
 a.release();b.release();await Promise.all([assert.rejects(a.promise,/CANCELLED/),assert.rejects(b.promise,/CANCELLED/)]);f.broker.dispose();pending.get('a').resolve(image('a'));pending.get('b').resolve(image('b'));await tick();assert.equal(f.broker.report().active_tasks,0);assert.equal(f.broker.report().queued_tasks,0);
});

test('a superseded scene preparation is cancelled and cannot replace the newer plan',async()=>{
 const header=deferred();const f=fixture(['a','b'],{inspectImage:(url,{asset})=>asset.id==='a'?header.promise:Promise.resolve({format:'png',width:2,height:2}),unusedMaxBytes:0,unusedMaxEntries:0});
 const old=f.broker.prepareScene(scene(['a']));await tick();const current=await f.broker.prepareScene(scene(['b']));assert.equal(current.partial,false);assert.equal((await old).cancelled,true);header.resolve({format:'png',width:2,height:2});await tick();assert.equal(f.broker.report().preparation,current);assert.equal(f.broker.report().scene_entries,1);assert.deepEqual(f.loads,['b']);f.broker.dispose();
});

test('image identity ownership is shared safely even when an injected decoder reuses an object',async()=>{
 const shared=image('shared');const f=fixture(['a','b'],{loadImage:async()=>shared,unusedMaxBytes:0,unusedMaxEntries:0});const a=f.broker.acquire('a'),b=f.broker.acquire('b');await Promise.all([a.promise,b.promise]);a.release();assert.equal(shared.closed,0);b.release();assert.equal(shared.closed,1);f.broker.dispose();
});

test('loading errors are observable and do not create unhandled speculative rejections',async()=>{
 const f=fixture(['a'],{loadImage:async()=>{throw Error('decode-broken');}});const report=await f.broker.prepareScene(scene(['a']));assert.equal(report.partial,true);assert.match(report.errors[0].message,/decode-broken/);assert.equal(report.reserved_bytes,0);assert.equal(report.admitted_entries,0);assert.equal(f.broker.report().resident_entries,0);const lease=f.broker.acquire('a');await assert.rejects(lease.promise,/decode-broken/);assert.equal(lease.state,'error');assert.match(lease.error.message,/decode-broken/);lease.release();assert.equal(f.broker.report().resident_entries,0);f.broker.dispose();
});

test('a failed speculative decode does not poison the next required acquisition',async()=>{
 let attempts=0;const decoded=image('retry');const f=fixture(['a'],{loadImage:async()=>{if(++attempts===1)throw Error('transient');return decoded;}});
 const report=await f.broker.prepareScene(scene(['a']));assert.equal(report.partial,true);assert.equal(report.errors.length,1);assert.equal(report.reserved_bytes,0);assert.equal(f.broker.report().scene_entries,0);assert.equal(f.broker.report().resident_entries,0);
 const actual=f.broker.acquire('a');assert.equal(await actual.promise,decoded);assert.equal(actual.state,'ready');assert.equal(attempts,2);actual.release();f.broker.dispose();assert.equal(decoded.closed,1);
});

function pngHeader(width=2,height=2){const bytes=new Uint8Array(24),view=new DataView(bytes.buffer);bytes.set([137,80,78,71,13,10,26,10]);view.setUint32(8,13);view.setUint32(12,0x49484452);view.setUint32(16,width);view.setUint32(20,height);return bytes;}
test('default PNG header preflight cancels ignored-Range body and awaits HTMLImage decode',async()=>{
 const priorImage=globalThis.Image,priorFetch=globalThis.fetch,decode=deferred();let cancelled=0,decodeCalls=0,request;
 class FakeImage{naturalWidth=2;naturalHeight=2;removeAttribute(){};set src(value){this.value=value;queueMicrotask(()=>this.onload?.());}decode(){decodeCalls++;return decode.promise;}}
 globalThis.Image=FakeImage;globalThis.fetch=async(url,options)=>{request={url,options};return new Response(new ReadableStream({start(controller){controller.enqueue(pngHeader());},cancel(){cancelled++;}}));};
 let broker;
 try{broker=createImageAssetBroker(createAssetCatalog({assets:[spec('a')]}),{resolveAssetUrl:asset=>asset.source});const preparing=broker.prepareScene(scene(['a']));await tick();assert.equal(request.options.headers.Range,'bytes=0-23');assert.equal(cancelled,1);assert.equal(decodeCalls,1);const lease=broker.acquire('a');assert.equal(lease.state,'loading');decode.resolve();assert.equal((await preparing).ready_entries,1);assert.equal(lease.state,'ready');assert(lease.image instanceof FakeImage);assert.equal(lease.image.onload,null);assert.equal(lease.image.onerror,null);lease.release();}
 finally{broker?.dispose();globalThis.Image=priorImage;globalThis.fetch=priorFetch;}
});

test('default loader abort clears image handlers/source and unknown headers do not decode',async()=>{
 const priorImage=globalThis.Image,priorFetch=globalThis.fetch,instances=[];
 class FakeImage{removed=0;constructor(){instances.push(this);}set src(value){this.value=value;}removeAttribute(name){assert.equal(name,'src');this.removed++;}}
 globalThis.Image=FakeImage;globalThis.fetch=async()=>new Response(new Uint8Array([1,2,3]));let broker;
 try{broker=createImageAssetBroker(createAssetCatalog({assets:[spec('a')]}),{resolveAssetUrl:asset=>asset.source});assert.equal((await broker.prepareScene(scene(['a']))).unsupported.length,1);assert.equal(instances.length,0);const lease=broker.acquire('a');await tick();broker.dispose();await assert.rejects(lease.promise,/CANCELLED/);assert.equal(instances[0].onload,null);assert.equal(instances[0].onerror,null);assert.equal(instances[0].removed,1);lease.release();}
 finally{broker?.dispose();globalThis.Image=priorImage;globalThis.fetch=priorFetch;}
});
