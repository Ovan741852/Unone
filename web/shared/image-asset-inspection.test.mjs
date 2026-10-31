import test from 'node:test';import assert from 'node:assert/strict';
import {createAssetCatalog,createImageAssetBroker} from './asset-encoding.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(inspectImage){let loads=0;const catalog=createAssetCatalog({assets:[{id:'a',kind:'texture2d',source:'a.png'}]});const broker=createImageAssetBroker(catalog,{resolveAssetUrl:a=>a.id,inspectImage,loadImage:async()=>{loads++;return {width:2,height:3};}});return {broker,loads:()=>loads};}
test('shared inspection owns no decoded pixels and one cancelled owner cannot abort another',async()=>{
 const wait=deferred();let calls=0,signal;const f=fixture(async(_url,options)=>{calls++;signal=options.signal;return wait.promise;});
 const a=new AbortController(),b=new AbortController(),first=f.broker.inspect('a',{signal:a.signal}),second=f.broker.inspect('a',{signal:b.signal});await flush();a.abort();await assert.rejects(first);assert.equal(signal.aborted,false);wait.resolve({format:'png',width:2,height:3});assert.deepEqual(await second,{format:'png',width:2,height:3,bytes:24});assert.equal(calls,1);assert.equal(f.loads(),0);f.broker.dispose();
});
test('final inspection cancellation and disposal fence late metadata without starting decode',async()=>{
 const wait=deferred();let signal;const f=fixture(async(_url,options)=>{signal=options.signal;return wait.promise;});const controller=new AbortController(),pending=f.broker.inspect('a',{signal:controller.signal});await flush();controller.abort();await assert.rejects(pending);assert(signal.aborted);wait.resolve({format:'png',width:2,height:3});await flush();assert.equal(f.loads(),0);f.broker.dispose();assert.throws(()=>f.broker.inspect('a'),/DISPOSED/);
});
test('an already decoded image supplies actual dimensions without header request',async()=>{
 let inspections=0;const f=fixture(async()=>{inspections++;return null;});const lease=f.broker.acquire('a');await lease.promise;const metadata=await f.broker.inspect('a');assert.equal(metadata.bytes,24);assert.equal(inspections,0);lease.release();f.broker.dispose();
});
test('unknown dimensions reject only speculative preparation and preserve lazy acquisition',async()=>{
 const f=fixture(async()=>null);await assert.rejects(f.broker.inspect('a'),/DIMENSIONS_UNAVAILABLE/);assert.equal(f.loads(),0);const lease=f.broker.acquire('a');await lease.promise;assert.equal(lease.state,'ready');lease.release();f.broker.dispose();
});

test('default JPEG inspection retains a bounded prefix, drains ignored Range and never decodes',async()=>{
 const original=globalThis.fetch,header=Uint8Array.from([255,216,255,192,0,11,8,0,3,0,2,1,1,17,0]);
 const chunks=[header,new Uint8Array(100000)];let range,reads=0,cancels=0,releases=0,loads=0;
 globalThis.fetch=async(_url,options)=>{range=options.headers.Range;return {ok:true,body:{getReader(){let i=0;return {async read(){reads++;return i<chunks.length?{value:chunks[i++],done:false}:{done:true};},async cancel(){cancels++;},releaseLock(){releases++;}};}}};};
 const catalog=createAssetCatalog({assets:[{id:'a',kind:'texture2d',source:'a.jpg',encoding:{decoder:'image',format:'jpeg',mime:'image/jpeg'}}]});
 const broker=createImageAssetBroker(catalog,{resolveAssetUrl:()=>'/a.jpg',loadImage:async()=>{loads++;throw Error('must not decode');}});
 try{assert.deepEqual(await broker.inspect('a'),{format:'jpeg',width:2,height:3,bytes:24});assert.equal(range,'bytes=0-65535');assert.equal(reads,3);assert.equal(cancels,0);assert.equal(releases,1);assert.equal(loads,0);}
 finally{broker.dispose();globalThis.fetch=original;}
});

test('default PNG metadata keeps the24B fastpath while unsupported SVG performs no header fetch',async()=>{
 const original=globalThis.fetch,header=new Uint8Array(24);header.set([137,80,78,71,13,10,26,10]);const view=new DataView(header.buffer);view.setUint32(8,13);view.setUint32(12,0x49484452);view.setUint32(16,2);view.setUint32(20,3);let requests=0;
 globalThis.fetch=async(_url,options)=>{requests++;assert.equal(options.headers.Range,'bytes=0-23');return {ok:true,body:{getReader(){let read=false;return {async read(){if(read)return {done:true};read=true;return {value:header,done:false};},releaseLock(){},async cancel(){assert.fail('healthy header must drain');}};}}};};
 const catalog=createAssetCatalog({assets:[{id:'a',kind:'texture2d',source:'a.png',encoding:{decoder:'image',format:'png',mime:'image/png'}},{id:'b',kind:'texture2d',source:'b.svg',encoding:{decoder:'image',format:'svg',mime:'image/svg+xml'}}]});
 const broker=createImageAssetBroker(catalog,{resolveAssetUrl:a=>a.source});
 try{assert.equal((await broker.inspect('a')).bytes,24);await assert.rejects(broker.inspect('b'),/DIMENSIONS_UNAVAILABLE/);assert.equal(requests,1);}
 finally{broker.dispose();globalThis.fetch=original;}
});
