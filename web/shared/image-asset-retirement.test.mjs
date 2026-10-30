import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssetCatalog,createImageAssetBroker} from './asset-encoding.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const catalog=()=>createAssetCatalog({assets:[{id:'a',kind:'texture2d',source:'a.png'}]});
function defaultFixture(t){
 const previous=globalThis.Image,instances=[],leases=[];
 class ControlledImage{
  naturalWidth=2;naturalHeight=2;removed=0;writes=0;decodeCalls=0;
  constructor(){instances.push(this);}
  set src(value){this.url=value;this.writes++;}
  removeAttribute(name){assert.equal(name,'src');this.removed++;this.url=null;}
  decode(){this.decodeCalls++;return this.decoding?.promise??Promise.resolve();}
 }
 globalThis.Image=ControlledImage;const broker=createImageAssetBroker(catalog(),{resolveAssetUrl:asset=>asset.source,unusedMaxBytes:0,unusedMaxEntries:0});
 t.after(()=>{for(const lease of leases)lease.release();broker.dispose();globalThis.Image=previous;});
 return{broker,instances,acquire(){const lease=broker.acquire('a');leases.push(lease);return lease;}};
}
function empty(broker){const report=broker.report();assert.equal(report.resident_entries,0);assert.equal(report.active_entries,0);assert.equal(report.unused_entries,0);assert.equal(report.loading,0);return report;}

test('completed default HTML images retire without resetting src and remain valid until the final owner releases',async t=>{
 const f=defaultFixture(t),a=f.acquire(),b=f.acquire();await tick();const image=f.instances[0],lateLoad=image.onload;image.onload();assert.equal(await a.promise,image);await b.promise;assert.equal(image.decodeCalls,1);assert.equal(image.onload,null);assert.equal(image.onerror,null);
 f.broker.dispose();assert.equal(b.image,image);a.release();a.release();assert.equal(image.removed,0);assert.equal(b.state,'ready');b.release();b.release();const report=empty(f.broker);assert.equal(report.closed_images,1);assert.equal(report.released_bytes_estimate,16);assert.equal(image.removed,0);assert.equal(image.writes,1);assert.equal(image.url,'a.png');assert.equal(a.image,null);assert.equal(b.image,null);lateLoad();await tick();assert.equal(image.decodeCalls,1);assert.match(report.scope,/logical final image-ownership retirement/);
});

test('explicit close remains exactly once for shared custom decoded-image ownership',async t=>{
 const image={width:2,height:2,closed:0,removed:0,close(){this.closed++;},removeAttribute(){this.removed++;}},broker=createImageAssetBroker(catalog(),{resolveAssetUrl:asset=>asset.source,loadImage:async()=>image,unusedMaxBytes:0,unusedMaxEntries:0});t.after(()=>broker.dispose());const a=broker.acquire('a'),b=broker.acquire('a');await Promise.all([a.promise,b.promise]);broker.dispose();a.release();assert.equal(image.closed,0);b.release();b.release();assert.equal(image.closed,1);assert.equal(image.removed,0);assert.equal(empty(broker).closed_images,1);
});

test('a truly pending default-image abort cancels src once, clears callbacks and ignores captured late events',async t=>{
 const f=defaultFixture(t),lease=f.acquire();await tick();const image=f.instances[0],lateLoad=image.onload,lateError=image.onerror;lease.release();await assert.rejects(lease.promise,/CANCELLED/);await tick();assert.equal(image.removed,1);assert.equal(image.onload,null);assert.equal(image.onerror,null);assert.equal(image.url,null);lateLoad();lateError();await tick();assert.equal(image.decodeCalls,0);assert.equal(image.removed,1);assert.equal(empty(f.broker).closed_images,0);assert.equal(f.broker.report().active_tasks,0);
});

test('aborting after onload while decode is pending never resets completed src or adopts a late completion',async t=>{
 const f=defaultFixture(t),lease=f.acquire();await tick();const image=f.instances[0];image.decoding=deferred();const lateLoad=image.onload;image.onload();assert.equal(image.decodeCalls,1);lease.release();await assert.rejects(lease.promise,/CANCELLED/);assert.equal(image.removed,0);assert.equal(image.onload,null);assert.equal(image.onerror,null);image.decoding.resolve();lateLoad();await tick();assert.equal(image.decodeCalls,1);assert.equal(image.url,'a.png');assert.equal(image.removed,0);assert.equal(lease.image,null);assert.equal(empty(f.broker).closed_images,0);assert.equal(f.broker.report().active_tasks,0);
});

test('completed decode failures report the original error without resetting src',async t=>{
 const f=defaultFixture(t),lease=f.acquire();await tick();const image=f.instances[0];image.decoding=deferred();image.onload();image.decoding.reject(Error('decode-failed'));await assert.rejects(lease.promise,/decode-failed/);assert.equal(image.onload,null);assert.equal(image.onerror,null);assert.equal(image.removed,0);assert.equal(image.url,'a.png');lease.release();empty(f.broker);
});

test('invalid completed-image dimensions fail without changing its source',async t=>{
 const f=defaultFixture(t),lease=f.acquire();await tick();const image=f.instances[0];image.naturalWidth=0;image.onload();await assert.rejects(lease.promise,/DIMENSIONS/);assert.equal(image.decodeCalls,0);assert.equal(image.onload,null);assert.equal(image.onerror,null);assert.equal(image.removed,0);lease.release();empty(f.broker);
});

test('a completed network error clears callbacks without a second source mutation',async t=>{
 const f=defaultFixture(t),lease=f.acquire();await tick();const image=f.instances[0];image.onerror();await assert.rejects(lease.promise,/LOAD_FAILED/);assert.equal(image.onload,null);assert.equal(image.onerror,null);assert.equal(image.removed,0);assert.equal(image.writes,1);lease.release();empty(f.broker);
});

test('late completed custom HTML-like images from a cancelled generation retire logically without src reset',async t=>{
 const pending=deferred(),image={width:2,height:2,removed:0,removeAttribute(){this.removed++;}},broker=createImageAssetBroker(catalog(),{resolveAssetUrl:asset=>asset.source,loadImage:()=>pending.promise,unusedMaxBytes:0,unusedMaxEntries:0});t.after(()=>broker.dispose());const lease=broker.acquire('a');await tick();lease.release();await assert.rejects(lease.promise,/CANCELLED/);pending.resolve(image);await tick();const report=empty(broker);assert.equal(report.closed_images,1);assert.equal(report.active_tasks,0);assert.equal(image.removed,0);assert.equal(lease.image,null);
});
