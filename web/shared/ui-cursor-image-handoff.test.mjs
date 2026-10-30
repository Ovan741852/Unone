import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssetCatalog,createImageAssetBroker} from './asset-encoding.js';
import {createUiCursorHost} from './ui-cursor.mjs';
import {DRAW_COMPLETED,DRAW_SKIPPED} from './player-completion.mjs';
const ids={a:'texture://cursor-handoff/a',b:'texture://cursor-handoff/b'};
const spec=name=>({kind:'image',asset:ids[name]??name,width:2,height:2,hotspot_x:0,hotspot_y:0,filter:'nearest'});
function fixture({unusedBytes=16,onError,loadImage}={}){
 const images=[],loads=new Map(),errors=[],handlers=new Map(),painted=[];
 const broker=createImageAssetBroker(createAssetCatalog({assets:Object.values(ids).map(id=>({id,kind:'texture2d',source:id+'.png'}))}),{
  resolveAssetUrl:asset=>asset.source,unusedMaxBytes:unusedBytes,unusedMaxEntries:2,inspectImage:async()=>({format:'png',width:2,height:2}),
  loadImage:async(url,options)=>{const {asset}=options;loads.set(asset.id,(loads.get(asset.id)??0)+1);if(loadImage)return loadImage(url,options);const image={id:asset.id,width:2,height:2,closed:0,close(){this.closed++;}};images.push(image);return image;},
 });
 const target={width:100,height:100,style:{cursor:'crosshair'},getBoundingClientRect:()=>({left:0,top:0,width:100,height:100}),addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name)};
 const layer={width:100,height:100,style:{},getContext:()=>({clearRect(){},drawImage:image=>painted.push(image)})};
 const host=createUiCursorHost({target,layer,focus:null,getImageAssets:()=>broker,onError:error=>{errors.push(error);onError?.(error);}});
 handlers.get('pointermove')({clientX:50,clientY:50,pointerType:'mouse'});
 return{host,broker,images,loads,errors,painted,target,dispose(){host.dispose();broker.dispose();}};
}
async function warm(f,name){const lease=f.broker.acquire(ids[name]);await lease.promise;lease.release();}

test('actual visible cursor and broker alternate100 times with two loads at one idle-image capacity',async t=>{
 const f=fixture();t.after(()=>f.dispose());assert.equal(f.host.update(spec('a')),DRAW_SKIPPED.cursor_assets_pending);await f.host.ready();await warm(f,'b');
 for(let step=0;step<100;step++){const name=step%2===0?'b':'a';assert.equal(f.host.update(spec(name)),DRAW_COMPLETED,'a cached incoming cursor must not manufacture an asynchronous pending draw');assert.equal(f.painted.at(-1).id,ids[name]);}
 assert.equal(f.broker.report().loads,2);assert.equal(f.broker.report().evictions,0);assert.equal(f.broker.report().active_entries,1);assert.equal(f.broker.report().unused_entries,1);assert.equal(f.host.report().shared_image_leases,1);assert(f.images.every(image=>image.closed===0));assert.deepEqual(f.errors,[]);
 f.dispose();f.dispose();assert.equal(f.images.length,2);assert(f.images.every(image=>image.closed===1));assert.equal(f.target.style.cursor,'crosshair');
});

test('invalid declaration preserves current ownership and incoming acquisition failure still reports onError',async t=>{
 const f=fixture({unusedBytes:0});t.after(()=>f.dispose());f.host.update(spec('a'));await f.host.ready();const original=f.images[0];
 assert.throws(()=>f.host.update({...spec('b'),width:0}),/UI_CURSOR_INVALID/);assert.equal(original.closed,0);assert.equal(f.host.render(),DRAW_COMPLETED);assert.equal(f.painted.at(-1),original);
 assert.equal(f.host.update(spec('texture://missing')),DRAW_SKIPPED.cursor_diagnostics);assert.equal(f.errors.length,1);assert.match(f.errors[0].message,/IMAGE_ASSET_MISSING/);await assert.rejects(f.host.ready(),/UI_CURSOR_ASSET_FAILED/);assert.equal(original.closed,1);assert.equal(f.broker.report().resident_entries,0);assert.equal(f.host.report().visible,false);f.dispose();assert.equal(original.closed,1);
});

test('an incoming error callback cannot retain the outgoing broker lease by throwing',async t=>{
 const f=fixture({unusedBytes:0,onError(){throw Error('error-handler-threw');}});t.after(()=>f.dispose());f.host.update(spec('a'));await f.host.ready();const original=f.images[0];
 assert.throws(()=>f.host.update(spec('texture://missing')),/error-handler-threw/);assert.equal(f.errors.length,1);assert.equal(original.closed,1);assert.equal(f.broker.report().active_entries,0);f.dispose();assert.equal(original.closed,1);
});

test('reentrant acquisition-error recovery retains the newer cursor rather than retiring its lease',async t=>{
 let f;f=fixture({unusedBytes:0,onError(){f.host.update(spec('b'));}});t.after(()=>f.dispose());await f.broker.prepareScene({entities:[{sprite:{asset:ids.b,visible:false}}]});f.host.update(spec('a'));await f.host.ready();
 assert.equal(f.host.update(spec('texture://missing')),DRAW_COMPLETED);assert.equal(f.errors.length,1);assert.equal(f.host.report().asset,ids.b);assert.equal(f.painted.at(-1).id,ids.b);assert.equal(f.host.report().shared_image_leases,1);assert.equal(f.broker.report().active_entries,1);assert.equal(f.images.find(image=>image.id===ids.a).closed,1);
});
