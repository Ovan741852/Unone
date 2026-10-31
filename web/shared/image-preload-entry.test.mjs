import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as images from './asset-encoding.js';
import {startupCancelled} from './startup-presentation.mjs';

const encoder=new TextEncoder(),MAX=1024*1024;
const ID='texture://shared',URL_TEXT='https://player.invalid/releases/'+'a'.repeat(64)+'/content/image-assets.json';
const plan=()=>({version:1,groups:{boot:[ID]},startup:['boot']});
const catalog=()=>images.createAssetCatalog({assets:[{id:ID,kind:'texture2d',source:'shared.png',encoding:{decoder:'image',format:'png',mime:'image/png'}}]});
const meta=content=>({content,getAttribute:name=>name==='content'?content:null});
const main=()=>fs.readFileSync(new URL('../player/main.js',import.meta.url),'utf8');
function actualFunction(name){
  const source=main(),match=new RegExp('^(?:async )?function '+name+'\\(','m').exec(source),begin=match?.index??-1;assert(begin>=0,'actual '+name+' must exist');
  const tail=source.slice(begin),next=tail.search(/\n(?:async )?function /);
  return next<0?tail:tail.slice(0,next);
}
function response(chunks,{status=200,failRead=null,onRead=()=>{}}={}){
  const counts={reads:0,cancels:0,releases:0,bodyCancels:0},queue=[...chunks];
  const reader={async read(){counts.reads++;onRead(counts.reads);if(failRead&&counts.reads===failRead.at)throw failRead.error;return queue.length?{done:false,value:queue.shift()}:{done:true};},async cancel(){counts.cancels++;},releaseLock(){counts.releases++;}};
  return {counts,value:{ok:status>=200&&status<300,status,headers:{get:()=>null},body:{getReader:()=>reader,async cancel(){counts.bodyCancels++;}}}};
}
function host({metas=[meta('content/image-assets.json')],reply=response([encoder.encode(JSON.stringify(plan()))]),preparation}={}){
  const fetches=[],counts={catalogs:0,brokers:0,preparations:0,backends:0,ready:0};
  const context={...images,JSON,URL,URLSearchParams,TextDecoder,Uint8Array,AbortController,startupCancelled,startupAbort:new AbortController(),
    document:{baseURI:'https://player.invalid/releases/'+'a'.repeat(64)+'/',
      querySelectorAll:selector=>selector.includes('unone-image-assets')?metas:selector.includes('unone-image-preload-version')?[meta('1')]:[],
      querySelector:()=>({content:'https://player.invalid/runtime.js'})},
    fetch:async(url,options)=>{fetches.push({url:String(url),options});return typeof reply==='function'?reply(context):reply.value;},
    playerProfileOptions:()=>null,location:{search:''},profiler:null,projectPayload:null,uiAssetManifest:null,withCatalog:project=>project,imageAssets:null,imagePreloadPlan:null,
    dataAssets:async()=>[],
    json:async url=>url==='content/project.json'?{config:{name:'preload-entry'},scene:{entities:[]}}:url==='content/assets.json'?{assets:[{id:ID,kind:'texture2d',source:'shared.png'}]}:{},
    createAssetCatalog:value=>{counts.catalogs++;return images.createAssetCatalog(value);},
    createImageAssetBroker(){counts.brokers++;return {async prepareScene(){counts.preparations++;return preparation;}};},
    async createRuntimeBackend(){counts.backends++;throw Error('Core must not be constructed for a rejected preload plan');},
    configurePhysical(){},loadPresentationFonts:async()=>{},async finishStartup(){counts.ready++;},
  };
  vm.createContext(context);vm.runInContext(actualFunction('readImagePreloadPlan'),context);
  if(main().includes('function assertRequiredImagePreparation('))vm.runInContext(actualFunction('assertRequiredImagePreparation'),context);
  return {context,fetches,counts,reply,read:()=>context.readImagePreloadPlan(catalog()),start(){vm.runInContext(actualFunction('start'),context);return context.start();}};
}

test('absent image-preload meta returns null without making a request',async()=>{
  const h=host({metas:[]});assert.equal(await h.read(),null);assert.equal(h.fetches.length,0);
});

test('one exact meta streams, validates and freezes the complete plan before use',async()=>{
  const value={version:1,groups:{'啟動':[ID]},startup:['啟動']},bytes=encoder.encode(JSON.stringify(value));
  const split=bytes.findIndex(byte=>byte>=128)+1;
  const wire=response([bytes.subarray(0,split),bytes.subarray(split,split+1),bytes.subarray(split+1)]),h=host({reply:wire});
  const result=await h.read();assert.deepEqual(result,images.validateImagePreloadPlan(value,catalog()));
  assert(Object.isFrozen(result)&&Object.isFrozen(result.groups)&&Object.isFrozen(result.groups['啟動']));
  assert.equal(h.fetches.length,1);assert.equal(h.fetches[0].url,URL_TEXT);assert.equal(h.fetches[0].options.signal,h.context.startupAbort.signal);
  assert.equal(wire.counts.reads,4);assert.equal(wire.counts.cancels,0);assert.equal(wire.counts.releases,1);
});

test('duplicate, missing and nonliteral preload meta fail before any request',async()=>{
  for(const metas of [[meta('content/image-assets.json'),meta('content/image-assets.json')],[meta(null)],[meta('')],
    [meta('/content/image-assets.json')],[meta('../image-assets.json')],[meta('content/image-assets.json?x=1')],[meta(' https://elsewhere.invalid/plan.json')]]){
    const h=host({metas});await assert.rejects(h.read());assert.equal(h.fetches.length,0);
  }
});

test('malformed JSON, invalid UTF-8 and unknown plan data are not silently ignored',async()=>{
  for(const bytes of [encoder.encode('{'),new Uint8Array([0xc0,0x80]),
    encoder.encode(JSON.stringify({...plan(),unknown:true})),
    encoder.encode(JSON.stringify({version:1,groups:{boot:['texture://undeclared']},startup:['boot']}))]){
    const wire=response([bytes]),h=host({reply:wire});await assert.rejects(h.read());
    assert.equal(wire.counts.releases,1);assert.equal(h.fetches.length,1);
  }
});

test('the raw one-MiB limit admits its exact boundary and cancels an oversized stream',async()=>{
  const prefix=encoder.encode(JSON.stringify(plan())),exact=new Uint8Array(MAX).fill(32);exact.set(prefix);
  const accepted=response([exact]),a=host({reply:accepted});assert.equal((await a.read()).version,1);
  assert.equal(accepted.counts.cancels,0);assert.equal(accepted.counts.releases,1);
  const rejected=response([exact,new Uint8Array([32])]),b=host({reply:rejected});await assert.rejects(b.read());
  assert.equal(rejected.counts.cancels,1);assert.equal(rejected.counts.releases,1);
});

test('fine-grained stream delivery does not create a retained typed-array copy per byte',async()=>{
  const allocations={owned:0,chunkCopies:0},raw=new Uint8Array(1024).fill(32);raw.set(encoder.encode(JSON.stringify(plan())));
  class Chunk extends Uint8Array {slice(...args){allocations.chunkCopies++;return super.slice(...args);}}
  const wire=response(Array.from(raw,byte=>new Chunk([byte]))),h=host({reply:wire});
  h.context.Uint8Array=new Proxy(Uint8Array,{construct(target,args){allocations.owned++;return Reflect.construct(target,args);}});
  assert.equal((await h.read()).version,1);assert.equal(wire.counts.reads,raw.length+1);
  // This allows fixed or geometrically grown bounded storage. It rejects the
  // demonstrated per-chunk clone list without depending on a source string.
  assert(allocations.owned+allocations.chunkCopies<=32,'fragmentation must not manufacture one retained array allocation per chunk');
  assert.equal(wire.counts.cancels,0);assert.equal(wire.counts.releases,1);
});

test('HTTP failure and a failed body read remain failures and release acquired readers',async()=>{
  const unavailable=response([],{status:404}),http=host({reply:unavailable});await assert.rejects(http.read());
  assert.equal(unavailable.counts.reads,0);
  const error=Error('preload-stream-failed'),wire=response([encoder.encode(JSON.stringify(plan()))],{failRead:{at:2,error}}),h=host({reply:wire});
  await assert.rejects(h.read(),/preload-stream-failed/);assert.equal(wire.counts.cancels,1);assert.equal(wire.counts.releases,1);
});

test('actual start rejects malformed, unknown and oversized plans before broker or Core construction',async()=>{
  for(const bytes of [encoder.encode('{'),encoder.encode(JSON.stringify({version:1,groups:{boot:['texture://missing']},startup:['boot']})),new Uint8Array(MAX+1).fill(32)]){
    const wire=response([bytes]),h=host({reply:wire});await assert.rejects(h.start());
    assert.deepEqual(h.counts,{catalogs:1,brokers:0,preparations:0,backends:0,ready:0});assert.equal(h.fetches.length,1);
  }
});

test('actual start cancels a pending plan read without constructing broker or Core',async()=>{
  let h;const wire=response([],{onRead(){h.context.startupAbort.abort();},failRead:{at:1,error:startupCancelled()}});
  h=host({reply:wire});await assert.rejects(h.start(),{name:'AbortError'});
  assert.deepEqual(h.counts,{catalogs:1,brokers:0,preparations:0,backends:0,ready:0});
  assert.equal(wire.counts.cancels,1);assert.equal(wire.counts.releases,1);
});

test('actual start rejects a partial or cancelled required startup group before Core construction',async()=>{
  for(const field of ['unsupported','budget_skipped','errors']){
    const preparation={cancelled:false,partial:true,required_entries:1,required_ready_entries:0,unsupported:[],budget_skipped:[],errors:[],[field]:[{id:ID,reason:'not-ready',message:'decode-failed'}]};
    const h=host({preparation});await assert.rejects(h.start(),/IMAGE_PRELOAD_REQUIRED_NOT_READY/);
    assert.deepEqual(h.counts,{catalogs:1,brokers:1,preparations:1,backends:0,ready:0});
  }
  const cancelled=host({preparation:{cancelled:true,required_entries:1,required_ready_entries:0}});
  await assert.rejects(cancelled.start(),{name:'AbortError'});assert.equal(cancelled.counts.backends,0);assert.equal(cancelled.counts.ready,0);
});

test('scene-only partial preparation remains best effort and can reach Core creation',async()=>{
  for(const metas of [[],[meta('content/image-assets.json')]]){
    const empty={version:1,groups:{},startup:[]},wire=response([encoder.encode(JSON.stringify(empty))]);
    const h=host({metas,reply:wire,preparation:{cancelled:false,partial:true,required_entries:0,required_ready_entries:0,unsupported:[{id:ID}],budget_skipped:[],errors:[]}});
    h.context.createRuntimeBackend=async()=>{h.counts.backends++;throw Error('expected-core-boundary');};
    await assert.rejects(h.start(),/expected-core-boundary/);
    assert.deepEqual(h.counts,{catalogs:1,brokers:1,preparations:1,backends:1,ready:0});
  }
});
