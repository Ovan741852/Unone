import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssetCatalog,createImageAssetBroker} from './asset-encoding.js';
import {createCanvasUi} from './canvas-ui.mjs';
import {DRAW_COMPLETED,DRAW_SKIPPED} from './player-completion.mjs';

const ids={a:'texture://handoff/a',b:'texture://handoff/b',c:'texture://handoff/c'};
const snapshot=names=>({world:{ui:{kind:'screen',id:'screen',node:'stage',children:names.map((name,index)=>({kind:'image',id:'art-'+name,asset:ids[name]??name,rect:{x:index*100/names.length,y:0,width:100/names.length,height:100}}))}}});
function host({sizes={},unusedBytes=16}={}){
 const trace=[],loads=new Map(),images=[];
 const catalog=createAssetCatalog({assets:Object.values(ids).map(id=>({id,kind:'texture2d',source:id.split('/').at(-1)+'.png'}))});
 const broker=createImageAssetBroker(catalog,{resolveAssetUrl:asset=>asset.source,unusedMaxBytes:unusedBytes,unusedMaxEntries:3,
  inspectImage:async(url,{asset})=>({format:'png',width:(sizes[asset.id]??[2,2])[0],height:(sizes[asset.id]??[2,2])[1]}),
  loadImage:async(url,{asset})=>{loads.set(asset.id,(loads.get(asset.id)??0)+1);const [width,height]=sizes[asset.id]??[2,2];const image={id:asset.id,naturalWidth:width,naturalHeight:height,width,height,closed:0,close(){this.closed++;trace.push('close:'+this.id);}};images.push(image);return image;}});
 const painted=[],context={setTransform(){},clearRect(){},save(){},restore(){},beginPath(){},rect(){},clip(){},drawImage:image=>painted.push(image),fillText(){},measureText:()=>({width:1})};
 const presenter={drawPrefix:()=>0,completion:()=>DRAW_COMPLETED,clear:()=>trace.push('gpu.clear')};
 const ui=createCanvasUi({width:100,height:100,getContext:()=>context},{acquireAsset:id=>{trace.push('acquire:'+id);return broker.acquire(id);},getImageBatchPresenter:()=>presenter});
 return{ui,broker,images,loads,painted,trace,dispose(){ui.dispose();broker.dispose();}};
}
async function showFirst(h,names){assert.equal(h.ui.draw(snapshot(names)),DRAW_SKIPPED.ui_assets_pending);await h.ui.ready();assert.equal(h.ui.draw(snapshot(names)),DRAW_COMPLETED);}
async function warm(h,name){const lease=h.broker.acquire(ids[name]);await lease.promise;lease.release();}

test('actual Canvas and broker preserve ready image handoffs for100 alternating views at one idle-image capacity',async t=>{
 const h=host();t.after(()=>h.dispose());await showFirst(h,['a']);await warm(h,'b');
 assert.equal(h.broker.report().unused_bytes_estimate,16);assert.equal(h.loads.get(ids.a),1);assert.equal(h.loads.get(ids.b),1);
 for(let step=0;step<100;step++){const name=step%2===0?'b':'a';assert.equal(h.ui.draw(snapshot([name])),DRAW_COMPLETED,'cached incoming pixels must be usable in this draw');assert.equal(h.painted.at(-1).id,ids[name]);}
 assert.equal(h.broker.report().loads,2);assert.equal(h.broker.report().evictions,0);assert.equal(h.broker.report().active_entries,1);assert.equal(h.broker.report().unused_entries,1);assert(h.images.every(image=>image.closed===0));
 h.dispose();h.dispose();assert.equal(h.images.length,2);assert(h.images.every(image=>image.closed===1),'last ownership retires each image exactly once');
});

test('all incoming cached images are pinned before retiring any outgoing image',async t=>{
 const h=host({sizes:{[ids.a]:[4,2]},unusedBytes:32});t.after(()=>h.dispose());await showFirst(h,['a']);await warm(h,'b');await warm(h,'c');
 assert.equal(h.broker.report().unused_bytes_estimate,32);h.trace.length=0;
 assert.equal(h.ui.draw(snapshot(['b','c'])),DRAW_COMPLETED,'pinning only the first incoming image would still lose the second');assert.deepEqual(h.painted.slice(-2).map(image=>image.id),[ids.b,ids.c]);assert.equal(h.broker.report().loads,3);assert.equal(h.broker.report().evictions,0);
 assert(h.trace.indexOf('acquire:'+ids.b)<h.trace.indexOf('gpu.clear'));assert(h.trace.indexOf('acquire:'+ids.c)<h.trace.indexOf('gpu.clear'));assert(h.images.every(image=>image.closed===0));
});

test('GPU retirement precedes final outgoing pixel release even when incoming acquisition fails',async t=>{
 const h=host({unusedBytes:0});t.after(()=>h.dispose());await showFirst(h,['a']);h.trace.length=0;
 assert.equal(h.ui.draw(snapshot(['texture://undeclared'])),DRAW_SKIPPED.ui_diagnostics);await assert.rejects(h.ui.ready(),/UI_ASSET_FAILED/);const old=h.images.find(image=>image.id===ids.a);assert.equal(old.closed,1);
 assert(h.trace.indexOf('gpu.clear')>=0);assert(h.trace.indexOf('gpu.clear')<h.trace.indexOf('close:'+ids.a));assert.equal(h.broker.report().resident_entries,0);assert.equal(h.ui.report().assets.length,1);h.dispose();assert.equal(old.closed,1);assert.throws(()=>h.ui.draw(snapshot(['b'])),/UI_DISPOSED/);
});
