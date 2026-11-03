import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createPlayerProfiler} from './raster-diagnostics.mjs';
import {createAssetCatalog,createImageAssetBroker} from './asset-encoding.js';
import {InstanceTransfer,InstanceReceiver} from './instance-transfer.mjs';
import {createUiTreePublication} from './ui-tree-publication.mjs';

// The optional RED source changes import locations only; its actual module body
// remains the captured pre-implementation source, with no diagnostic shim.
let moduleUrl=new URL('./canvas-ui.mjs',import.meta.url);
if(process.env.UNONE_UI_ASSET_BASELINE_SOURCE){
 const original=fs.readFileSync(process.env.UNONE_UI_ASSET_BASELINE_SOURCE,'utf8');
 const relocated=original.replace(/from '(\.\/[^']+)'/g,(_all,path)=>`from '${new URL(path,moduleUrl).href}'`);
 moduleUrl=new URL('data:text/javascript;base64,'+Buffer.from(relocated).toString('base64'));
}
const {createCanvasUi}=await import(moduleUrl.href);
const A='texture://a',B='texture://b',rect={x:0,y:0,width:10,height:10};
const image=(asset=A,extra={})=>({kind:'image',id:asset,asset,rect:{...rect},...extra});
const screen=children=>({children});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function lease(pending=false){const wait=deferred(),value={width:2,height:2};let releases=0;return {get state(){return pending?'loading':'ready';},image:value,promise:pending?wait.promise:Promise.resolve(value),release(){releases++;},resolve(){wait.resolve(value);},reject:wait.reject,get releases(){return releases;}};}
function fixture({acquire=()=>lease(),onDiagnostic=()=>{},requestRender=()=>{}}={}){
 const calls=[],presenter={target:()=>({width:100,height:100,scale:1}),draw:()=>({skipped:false,regions:1}),metrics:()=>({})};
 const ui=createCanvasUi(null,{getPresenter:()=>presenter,acquireAsset:id=>{calls.push(id);return acquire(id);},onDiagnostic,requestRender});
 return {ui,calls,draw:(tree,frame=1)=>ui.draw({world:{frame,ui:tree}})};
}

test('actual loading/ready/release work is observable, not only the presence of a new setter',async()=>{
 const pending=lease(true),f=fixture({acquire:()=>pending}),events=[];try{
  // The RED module has no observer interface, but still executes the original
  // asset lifecycle below. No substitute method or synthetic event is injected.
  f.ui.setAssetObserver?.(e=>events.push(e));assert.equal(f.draw(screen([image()]),1).reason,'ui_assets_pending');
  const ready=f.ui.ready();pending.resolve();await ready;assert.equal(f.draw(screen([]),2).status,'completed');assert.equal(pending.releases,1);
  assert.deepEqual(events.map(e=>e.transition),['loading','ready','release']);
 }finally{f.ui.dispose();}
});

test('OFF observer stays null without diagnostic clock reads or emitted packets',()=>{
 const f=fixture();try{
  assert.equal(f.ui.assetDiagnostics(),null);f.ui.setAssetObserver(null);
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'performance');
  try{Object.defineProperty(globalThis,'performance',{configurable:true,value:{now(){throw Error('UNEXPECTED_DIAGNOSTIC_CLOCK');}}});f.draw(screen([image()]));f.draw(screen([]),2);}
  finally{Object.defineProperty(globalThis,'performance',descriptor);}
  assert.equal(f.ui.assetDiagnostics(),null);assert.deepEqual(f.calls,[A]);
 }finally{f.ui.dispose();}
});

test('real broker synchronous ready hit emits acquire_ready and never manufactures pending/loading',async()=>{
 const catalog=createAssetCatalog({assets:[{id:A,kind:'texture2d',source:'a.png'}]});
 const broker=createImageAssetBroker(catalog,{resolveAssetUrl:a=>a.source,loadImage:async()=>({width:2,height:2})}),pin=broker.acquire(A);await pin.promise;
 const f=fixture({acquire:id=>broker.acquire(id)}),events=[];try{
  f.ui.setAssetObserver(e=>events.push(e));assert.equal(f.draw(screen([image()]),10).status,'completed');
  assert.deepEqual(events.map(e=>e.transition),['acquire_ready']);assert.equal(events[0].asynchronous,false);assert.equal(f.ui.assetDiagnostics().ui_loading_count,0);
  assert.equal(events[0].origin_composition,1);assert.equal(events[0].origin_ui_frame,10);
 }finally{f.ui.dispose();pin.release();broker.dispose();}
});

test('async success retains origin composition and distinguishes the latest UI observation frame',async()=>{
 const pending=lease(true),f=fixture({acquire:id=>id===A?pending:lease()}),events=[];try{
  f.ui.setAssetObserver(e=>events.push(e));assert.equal(f.draw(screen([image()]),10).reason,'ui_assets_pending');
  f.draw(screen([image(),image(B)]),11);const ready=f.ui.ready();pending.resolve();await ready;await flush();
  const event=events.find(e=>e.transition==='ready');assert.equal(event.origin_composition,1);assert.equal(event.ui_composition,2);assert.equal(event.origin_ui_frame,10);assert.equal(event.last_ui_frame,11);
  assert.equal(event.current_required,true);assert.equal(event.current_entry,true);assert.equal(event.asynchronous,true);assert.equal(f.ui.assetDiagnostics().ui_loading_count,0);
 }finally{f.ui.dispose();}
});

test('invalidated old completion cannot be attributed to a new entry for the same required asset',async()=>{
 const first=lease(true),second=lease(true),pending=[first,second],f=fixture({acquire:()=>pending.shift()}),events=[];try{
  f.ui.setAssetObserver(e=>events.push(e));f.draw(screen([image()]),20);f.ui.invalidateAssets();first.resolve();await flush();
  const stale=events.find(e=>e.transition==='stale_result');assert.equal(stale.current_required,true);assert.equal(stale.current_entry,false);assert.equal(stale.origin_asset_generation,0);assert.equal(stale.asset_generation,1);assert.equal(stale.asynchronous,true);
  const loading=events.filter(e=>e.transition==='loading');assert.notEqual(loading[0].entry_token,loading[1].entry_token);assert.equal(f.ui.assetDiagnostics().ui_loading_count,1);
  assert(events.some(e=>e.transition==='release'&&e.release_reason==='invalidate'));second.resolve();await f.ui.ready();
 }finally{f.ui.dispose();}
});

test('composition removal records release and stale result without changing required-asset behavior',async()=>{
 const pending=lease(true),f=fixture({acquire:()=>pending}),events=[];try{
  f.ui.setAssetObserver(e=>events.push(e));f.draw(screen([image()]),30);assert.equal(f.draw(screen([]),31).status,'completed');pending.resolve();await flush();
  const released=events.find(e=>e.transition==='release');assert.equal(released.release_reason,'composition');assert.equal(released.current_required,false);
  const stale=events.find(e=>e.transition==='stale_result');assert.equal(stale.origin_ui_frame,30);assert.equal(stale.last_ui_frame,31);assert.equal(stale.current_required,false);assert.equal(stale.current_entry,false);
 }finally{f.ui.dispose();}
});

test('shared ordinary/batch references aggregate geometry facts without claiming batch visibility',()=>{
 const f=fixture(),events=[];try{
  f.ui.setAssetObserver(e=>events.push(e));const batch={kind:'image_batch',id:'batch',rect:{x:0,y:0,width:20,height:20},quads:[{asset:A,rect:{x:0,y:0,width:10,height:10}},{asset:A,rect:{x:10,y:0,width:10,height:10}}]};
  f.draw(screen([image(A,{id:'visible'}),image(A,{id:'zero',style:{opacity:0}}),image(A,{id:'outside',rect:{x:80,y:80,width:10,height:10},clip:{x:0,y:0,width:20,height:20}}),batch]));
  assert.deepEqual(f.calls,[A]);const e=events[0];assert.equal(e.ordinary_refs,3);assert.equal(e.batch_list_refs,1,'One unique asset reference per batch instance, not a quad count');
  assert.equal(e.opacity_zero_refs,1);assert.equal(e.rect_clip_candidate_refs,2);assert.equal(e.rect_clip_outside_refs,1);assert.equal(e.batch_visibility_tested,false);
 }finally{f.ui.dispose();}
});

test('metadata/event limits and long IDs remain explicit primitives without profiler dropped_attrs',()=>{
 const f=fixture(),p=createPlayerProfiler({limit:16,now:()=>0}),long='texture://'+('x'.repeat(200)),ids=[long,...Array.from({length:299},(_,i)=>'texture://asset-'+i)];try{
  f.ui.setAssetObserver(e=>p.record('ui_asset','ok',e));f.draw(screen(ids.map(asset=>image(asset))));
  const d=f.ui.assetDiagnostics();assert.equal(d.ui_asset_metadata,256);assert.equal(d.ui_asset_metadata_overflow,44);assert.equal(d.ui_asset_events,128);assert.equal(d.ui_asset_event_overflow,128);
  const report=p.report();assert.equal(report.events.length,16);assert.equal(report.counts.dropped_attrs,0);assert(report.events.every(e=>Object.values(e.attrs).every(v=>v===null||typeof v==='string'||typeof v==='number'||typeof v==='boolean')));
  // Capture the long-id event separately; the small ring above intentionally overwrote it.
  const events=[];f.ui.setAssetObserver(e=>events.push(e));f.draw(screen([]));f.draw(screen([image(long)]));const e=events.find(e=>e.transition==='acquire_ready');
  assert.equal(e.asset.length,128);assert.equal(e.asset_chars,long.length);assert.equal(e.asset_truncated,true);assert(e.entry_token>0);assert.notEqual(e.asset,long);
 }finally{f.ui.dispose();}
});

test('observer throws cannot alter readiness, requestRender, original diagnostics or release',async()=>{
 const pending=lease(true);let renders=0;const f=fixture({acquire:()=>pending,requestRender:()=>renders++});try{
  f.ui.setAssetObserver(()=>{throw Error('OBSERVER_FAILED');});f.draw(screen([image()]));const ready=f.ui.ready();pending.resolve();await ready;assert.equal(renders,1);assert.equal(f.ui.assetDiagnostics().ui_loading_count,0);assert.equal(f.ui.assetDiagnostics().ui_asset_observer_failures,2);
  f.draw(screen([]));assert.equal(pending.releases,1);assert.equal(f.ui.assetDiagnostics().ui_asset_observer_failures,3);
 }finally{f.ui.dispose();}
 const original=Error('ORIGINAL_DIAGNOSTIC');const failed=fixture({acquire(){throw Error('ASSET_FAILED');},onDiagnostic(){throw original;}});
 try{failed.ui.setAssetObserver(()=>{throw Error('OBSERVER_FAILED');});assert.throws(()=>failed.draw(screen([image()])),error=>error===original);}finally{failed.ui.dispose();}
});

test('an old pending entry marks current reference counts unknown when the later composition exceeds metadata capacity',async()=>{
 const pending=lease(true),f=fixture({acquire:id=>id===A?pending:lease()}),events=[];try{
  f.ui.setAssetObserver(e=>events.push(e));const others=Array.from({length:256},(_,i)=>image('texture://other-'+i));
  f.draw(screen([image(),...others]),50);f.draw(screen([...others,image()]),51);pending.resolve();await f.ui.ready();
  const ready=events.find(e=>e.transition==='ready');assert(ready);assert.equal(ready.current_required,true);assert.equal(ready.current_entry,true);
  assert.equal(ready.current_refs_known,false);assert.equal(ready.origin_ordinary_refs,1);assert.equal(ready.origin_composition,1);assert.equal(ready.ui_composition,2);assert(f.ui.assetDiagnostics().ui_asset_metadata_overflow>0);
 }finally{f.ui.dispose();}
});

test('dispose disconnects its observer even while a late load completes',async()=>{
 const pending=lease(true),f=fixture({acquire:()=>pending}),events=[];
 f.ui.setAssetObserver(e=>events.push(e));f.draw(screen([image()]));f.ui.dispose();assert.equal(f.ui.assetDiagnostics(),null);
 const after=events.length;pending.resolve();await flush();assert.equal(events.length,after);assert(events.some(e=>e.transition==='release'&&e.release_reason==='dispose'));
 f.ui.setAssetObserver(()=>{throw Error('DISPOSED_OBSERVER');});assert.equal(f.ui.assetDiagnostics(),null);
});

test('main and actual worker receiver trees share passive asset semantics without Core calls',()=>{
 const owned=createUiTreePublication(JSON.stringify(screen([image()]))).value,snapshot={world:{frame:42,ui:owned}},sender=new InstanceTransfer(),receiver=new InstanceReceiver();
 const worker=receiver.accept(structuredClone(sender.encode(snapshot,new ArrayBuffer(0)))),results=[];
 for(const value of [snapshot,worker]){const f=fixture(),events=[];try{f.ui.setAssetObserver(e=>events.push(e));f.ui.draw(value);results.push(events);}finally{f.ui.dispose();}}
 assert.deepEqual(results[0],results[1]);assert.equal(results[0][0].origin_ui_frame,42);receiver.clear();
});
