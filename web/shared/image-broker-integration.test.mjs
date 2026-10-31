import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createAssetCatalog,createImageAssetBroker} from './asset-encoding.js';
import {createCanvasUi} from './canvas-ui.mjs';
import {createUiCursorHost} from './ui-cursor.mjs';
import {completeStartupPresentation,startupCancelled} from './startup-presentation.mjs';
import {DRAW_COMPLETED,DRAW_SKIPPED} from './player-completion.mjs';

const ID='texture://shared';
const flush=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
const snapshot=(visible=true)=>({world:{ui:{kind:'screen',id:'screen',node:'world',children:visible?
  [{kind:'image',id:'art',asset:ID,rect:{x:0,y:0,width:100,height:100}}]:[]}}});
const scene={entities:[{id:'hidden-one',sprite:{asset:ID,visible:false}},{id:'hidden-two',sprite:{asset:ID,visible:false}}]};

function controlledBroker(){
  const pending=new Map(),calls=[];let closes=0;
  const catalog=createAssetCatalog({assets:[{id:ID,kind:'texture2d',source:'shared.png',
    encoding:{decoder:'image',format:'png',mime:'image/png'}}]});
  const broker=createImageAssetBroker(catalog,{
    resolveAssetUrl:asset=>asset.source,
    inspectImage:async()=>({format:'png',width:16,height:16}),
    loadImage:url=>{calls.push(url);return new Promise((resolve,reject)=>pending.set(url,{resolve,reject}));},
  });
  const image={naturalWidth:16,naturalHeight:16,width:16,height:16,close(){closes++;}};
  return {broker,calls,image,closes:()=>closes,resolve(){assert(pending.has('shared.png'),'an actual image request must exist');pending.get('shared.png').resolve(image);}};
}

function canvasHost(broker){
  const painted=[],context={setTransform(){},clearRect(){},save(){},restore(){},beginPath(){},rect(){},clip(){},
    drawImage:image=>painted.push(image),fillText(){},measureText:()=>({width:1})};
  const canvas={width:100,height:100,getContext:()=>context};
  return {painted,ui:createCanvasUi(canvas,{acquireAsset:id=>broker.acquire(id)})};
}

function cursorHost(broker){
  const events=new Map(),painted=[],context={clearRect(){},drawImage:image=>painted.push(image)};
  const target={width:100,height:100,style:{cursor:'crosshair'},
    getBoundingClientRect:()=>({left:0,top:0,width:100,height:100}),
    addEventListener:(name,callback)=>events.set(name,callback),removeEventListener:name=>events.delete(name)};
  const layer={width:100,height:100,style:{},getContext:()=>context};
  const host=createUiCursorHost({target,layer,focus:null,getImageAssets:()=>broker,onError:error=>{throw error;}});
  return {host,painted,enter(){events.get('pointermove')({clientX:50,clientY:50,pointerType:'mouse'});}};
}

test('declared hidden artwork first enters Canvas and cursor synchronously from one decoded scene lease',async t=>{
  const images=controlledBroker(),canvas=canvasHost(images.broker),cursor=cursorHost(images.broker);
  t.after(()=>{canvas.ui.dispose();cursor.host.dispose();images.broker.dispose();});
  const preparing=images.broker.prepareScene(scene);await flush();assert.equal(images.calls.length,1,'duplicate hidden declarations share one load');
  images.resolve();const report=await preparing;assert.equal(report.partial,false);assert.equal(report.ready_entries,1);
  assert.equal(canvas.ui.draw(snapshot(false)),DRAW_COMPLETED);
  assert.equal(canvas.ui.draw(snapshot()),DRAW_COMPLETED,'first appearance cannot wait for a Promise microtask');
  assert.equal(canvas.painted.at(-1),images.image);
  cursor.enter();assert.equal(cursor.host.update({kind:'image',asset:ID,width:16,height:16,hotspot_x:0,hotspot_y:0,filter:'linear'}),DRAW_COMPLETED);
  assert.equal(cursor.painted.at(-1),images.image);assert.equal(images.calls.length,1);
  assert.equal(canvas.ui.draw(snapshot(false)),DRAW_COMPLETED);assert.equal(images.closes(),0,'Canvas pruning must release, not close another owner image');
  images.broker.dispose();assert.equal(images.closes(),0,'cursor owns the image after scene/broker retirement');
  assert.equal(cursor.host.render(),DRAW_COMPLETED);assert.equal(cursor.painted.at(-1),images.image);
  cursor.host.dispose();assert.equal(images.closes(),1,'the final consumer closes the retired image once');
});

test('real Canvas readiness holds the startup barrier until decode completes without a fake completed frame',async t=>{
  const images=controlledBroker(),canvas=canvasHost(images.broker),frames=new Map();let nextId=0,last=null,draws=0,commits=0,settled=false;
  const abort=new AbortController();t.after(()=>{abort.abort();canvas.ui.dispose();images.broker.dispose();});
  const preparing=images.broker.prepareScene(scene);
  const draw=()=>{draws++;last=canvas.ui.draw(snapshot());};
  const starting=completeStartupPresentation({draw,signal:abort.signal,
    waitForAssets:()=>Promise.all([preparing,canvas.ui.ready()]),
    sample:()=>({state:last===DRAW_COMPLETED?'presented':'needs_draw'}),subscribe:()=>()=>{},
    nextFrame:callback=>{frames.set(++nextId,callback);return nextId;},cancelFrame:id=>frames.delete(id),
    commit(){draw();assert.equal(last,DRAW_COMPLETED);commits++;return true;},
  });
  starting.then(()=>settled=true,()=>settled=true);
  await flush();assert.equal(last,DRAW_SKIPPED.ui_assets_pending);assert.equal(draws,1);assert.equal(commits,0);assert.equal(settled,false);
  assert.equal(frames.size,0,'asset waits do not spin a RAF or start simulation');assert.equal(images.calls.length,1);
  images.resolve();await flush();assert.equal(last,DRAW_COMPLETED);assert.equal(commits,0);assert.equal(frames.size,1);
  const barrier=[...frames.values()];frames.clear();for(const callback of barrier)callback();await starting;
  assert.equal(commits,1);assert.equal(draws,3);assert.equal(images.calls.length,1);assert.equal(frames.size,0);
});

test('removing pending Canvas artwork cannot close or publish a late shared image still owned elsewhere',async t=>{
  const images=controlledBroker(),canvas=canvasHost(images.broker),other=images.broker.acquire(ID);
  t.after(()=>{canvas.ui.dispose();other.release();images.broker.dispose();});
  assert.equal(canvas.ui.draw(snapshot()),DRAW_SKIPPED.ui_assets_pending);
  assert.equal(canvas.ui.draw(snapshot(false)),DRAW_COMPLETED);await flush();assert.equal(images.calls.length,1);
  images.resolve();assert.equal(await other.promise,images.image);await flush();
  assert.equal(other.state,'ready');assert.equal(other.image,images.image);assert.equal(images.closes(),0);
  assert.deepEqual(canvas.ui.report().assets,[]);assert.deepEqual(canvas.ui.report().diagnostics,[]);
  assert.equal(canvas.ui.draw(snapshot(false)),DRAW_COMPLETED);assert.equal(canvas.painted.length,0);
  canvas.ui.dispose();assert.equal(images.closes(),0);images.broker.dispose();assert.equal(images.closes(),0);
  other.release();other.release();assert.equal(images.closes(),1,'stale callbacks and repeated release cannot double-close');
});

test('Canvas asset invalidation reacquires an admitted scene image synchronously without invalidating its owner',async t=>{
  const images=controlledBroker(),canvas=canvasHost(images.broker);
  t.after(()=>{canvas.ui.dispose();images.broker.dispose();});
  const preparing=images.broker.prepareScene(scene);await flush();images.resolve();await preparing;
  assert.equal(canvas.ui.draw(snapshot()),DRAW_COMPLETED);canvas.ui.invalidateAssets();
  assert.equal(canvas.ui.draw(snapshot()),DRAW_COMPLETED);assert.equal(canvas.painted.at(-1),images.image);
  assert.equal(images.calls.length,1);assert.equal(images.closes(),0);assert.equal(canvas.ui.report().assets[0].state,'ready');
});

test('actual player start cannot create a late image broker after pagehide while manifests are pending',async()=>{
  const pending=new Map(),counts={catalogs:0,brokers:0,preparations:0};
  const context={startupAbort:new AbortController(),startupCancelled,location:{search:''},
    playerProfileOptions:()=>null,projectPayload:null,uiAssetManifest:null,imageAssets:null,
    json:url=>new Promise(resolve=>pending.set(url,resolve)),
    createAssetCatalog(){counts.catalogs++;return {};},
    createImageAssetBroker(){counts.brokers++;return {async prepareScene(){counts.preparations++;}};},
  };
  const source=fs.readFileSync(new URL('../player/main.js',import.meta.url),'utf8');
  const begin=source.indexOf('async function start(){'),end=source.indexOf('\nfunction pointer(',begin);
  assert(begin>=0&&end>begin,'test the actual production start function');
  vm.createContext(context);vm.runInContext(source.slice(begin,end),context);
  const starting=context.start();assert.equal(pending.size,3);
  context.startupAbort.abort();
  pending.get('content/project.json')({config:{name:'test'},scene:{entities:[]}});
  pending.get('content/assets.json')({assets:[]});pending.get('content/presentation.json')({});
  await assert.rejects(starting,{name:'AbortError'});
  assert.deepEqual(counts,{catalogs:0,brokers:0,preparations:0});
});

test('actual failure cleanup accepts the exported UI-disabled stub and retires the broker/backend',()=>{
  const trace=[],retire=name=>({dispose:()=>trace.push(name)}),error=Error('intentional failure');
  const context={profiler:null,startupAbort:new AbortController(),cursorHost:retire('cursor'),textInputs:retire('text'),
    uiScroll:retire('scroll'),uiRenderer:null,orderedQueue:null,orderedRouter:null,publishPhysical:()=>trace.push('physical'),
    scheduler:{stop:()=>trace.push('scheduler')},resourceHost:{close:()=>trace.push('resources')},renderer:{},disposeRenderer:()=>trace.push('renderer'),
    imageAssets:retire('images'),audio:retire('audio'),backend:{close:()=>trace.push('backend')},
    status:{textContent:''},document:{body:{dataset:{}}},console:{error(){}}};
  const producer=fs.readFileSync(new URL('../../crates/unone-cli/src/export.rs',import.meta.url),'utf8');
  const line=producer.split(/\r?\n/).find(value=>value.includes('const disabledUiCompleted =')&&value.includes('const createCanvasUi ='));
  assert(line,'use the real exporter stub, not an invented disabled-host contract');
  const disabled=JSON.parse(line.trim().replace(/,$/,''));
  const source=fs.readFileSync(new URL('../player/main.js',import.meta.url),'utf8');
  const begin=source.indexOf('function fail('),end=source.indexOf('\nfunction publishPhysical(',begin);
  assert(begin>=0&&end>begin);vm.createContext(context);vm.runInContext(disabled+';uiRenderer=createCanvasUi();'+source.slice(begin,end),context);
  assert.doesNotThrow(()=>context.fail(error));assert.equal(context.startupAbort.signal.aborted,true);
  assert.deepEqual(trace,['cursor','text','scroll','physical','scheduler','resources','renderer','images','audio','backend']);
  assert.match(context.document.body.dataset.playerError,/intentional failure/);
});
