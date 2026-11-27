import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssetCatalog,createImageAssetBroker,installPlayerAssetGroups} from './asset-encoding.js';
import {createImageGroupHost} from './image-group-host.mjs';
import {createRuntimeCore} from './runtime-core.mjs';

// The real broker and group manager the official player uses, with fake decoding.
function fixture({budget={max_bytes:48,max_entries:3},load}={}){
 const assets=['a','b','c'].map(id=>({id,source:id+'.png',kind:'texture2d',encoding:{decoder:'image',format:'png',mime:'image/png'}}));
 const plan={version:1,groups:{town:['a','b'],map:['b','c']},startup:[],dimensions:Object.fromEntries(assets.map(a=>[a.id,{format:'png',width:2,height:2}])),budget};
 const images=new Map();
 const broker=createImageAssetBroker(createAssetCatalog({assets}),{preloadPlan:plan,resolveAssetUrl:a=>a.source,inspectImage:async()=>({format:'png',width:2,height:2}),
  loadImage:async(url,opts)=>{if(load)return load(url,opts);const image={width:2,height:2,closed:0,close(){this.closed++;}};images.set(opts.asset.id,image);return image;}});
 return{broker,images,host:createImageGroupHost({getGroups:()=>broker.groups})};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
const plan=(revision,groups)=>({world:{frame:revision},image_group_plan:{revision,groups}});
// One round trip: lease the frame, "tick", commit, as the player loop does.
function exchange(host,frame={actions:{}}){const leased=host.leaseInput(frame);host.commitInput(leased.token);return leased.frame.presentation_resources?.image_groups;}

test('game requests reach the broker and each change is reported once',async()=>{
 const f=fixture();
 f.host.acceptSnapshot(plan(1,{town:'preload'}));
 assert.deepEqual(exchange(f.host),[{name:'town',state:'loading',total:2,ready:0,bytes:0}],'bytes are reserved after the metadata check');
 assert.equal(exchange(f.host),undefined,'an unchanged state is not reported again');
 await settle();
 assert.deepEqual(exchange(f.host),[{name:'town',state:'ready',total:2,ready:2,bytes:32}]);
 f.host.acceptSnapshot(plan(2,{town:'load'}));
 assert.equal(f.broker.groups.status('town').mode,'load','load promotes the preload without decoding again');
 assert.equal(exchange(f.host),undefined);
 f.host.acceptSnapshot(plan(3,{}));
 assert.deepEqual(exchange(f.host),[{name:'town',state:'unloaded',total:2,ready:0,bytes:0}]);
 assert.equal(f.images.get('a').closed,1,'unload released pixels nobody else holds');
 f.broker.dispose();
});

test('the plan budget and its error reach the game; stale or repeated plans change nothing',async()=>{
 const f=fixture({budget:{max_bytes:32,max_entries:2}});
 f.host.acceptSnapshot(plan(1,{town:'load'}));await settle();
 f.host.acceptSnapshot(plan(2,{town:'load',map:'preload'}));await settle();
 const rows=exchange(f.host);
 assert.deepEqual(rows.map(r=>[r.name,r.state]),[['town','ready'],['map','error']]);
 assert.match(rows[1].error,/IMAGE_ASSET_GROUP_BUDGET/);
 f.host.acceptSnapshot(plan(1,{}));
 assert.equal(f.broker.groups.status('town').state,'ready','an older revision is ignored');
 assert.throws(()=>f.host.acceptSnapshot(plan(4,{town:'hold'})),/IMAGE_GROUP_PLAN_INVALID/);
 f.broker.dispose();
});

test('a group missing from the published plan reports an error instead of throwing',()=>{
 const f=fixture();
 f.host.acceptSnapshot(plan(1,{elsewhere:'load'}));
 const [row]=exchange(f.host);
 assert.equal(row.state,'error');assert.match(row.error,/IMAGE_ASSET_GROUP_MISSING/);
 f.broker.dispose();
});

test('an explicit retry recovers a held group without dropping overlapping ready pixels',async()=>{
 let fail=true;
 const loads=[];
 const f=fixture({load:async(_url,{asset})=>{
  loads.push(asset.id);
  if(fail&&asset.id==='a')throw Error('temporary');
  return {width:2,height:2,close(){}};
 }});
 f.host.acceptSnapshot(plan(1,{map:'load'}));await settle();
 f.host.acceptSnapshot(plan(2,{map:'load',town:'preload'}));await settle();
 assert.equal(exchange(f.host).find(r=>r.name==='town').state,'error');
 fail=false;
 const next=plan(3,{map:'load',town:'preload'});
 next.image_group_plan.retries=['town'];
 f.host.acceptSnapshot(next);await settle();
 assert.equal(exchange(f.host).find(r=>r.name==='town').state,'ready');
 assert.equal(f.broker.groups.status('map').state,'ready');
 assert.equal(loads.filter(id=>id==='b').length,1);
 assert.equal(loads.filter(id=>id==='a').length,2);
 f.host.acceptSnapshot(next);assert.equal(exchange(f.host),undefined);
 f.broker.dispose();
});

test('page holds stay; reset drops only what the game asked for; manual input is not touched',async()=>{
 const f=fixture(),target={};
 const remove=installPlayerAssetGroups(target,()=>f.broker);
 await target.unonePlayerAssets.load('map');
 f.host.acceptSnapshot(plan(1,{town:'load'}));await settle();
 assert.equal(f.host.leaseInput({actions:{}},{live:false}).token,null,'replayed or manual frames stay authoritative');
 assert.throws(()=>f.host.leaseInput({presentation_resources:{image_groups:[]}}),/IMAGE_GROUP_INPUT_OWNERSHIP/);
 const merged=f.host.leaseInput({presentation_resources:{resources:[{id:'1'}]}}).frame.presentation_resources;
 assert.deepEqual(Object.keys(merged),['resources','image_groups'],'sprite receipts in the same frame are kept');
 f.host.reset();
 assert.equal(f.broker.groups.status('town').state,'unloaded');
 assert.equal(f.broker.groups.status('map').state,'ready','a hold made through window.unonePlayerAssets is not the game\'s to drop');
 f.host.acceptSnapshot(plan(1,{town:'preload'}));
 assert.equal(f.broker.groups.status('town').state,'loading','a new session starts its revisions over');
 remove();f.host.close();f.broker.dispose();
});

test('runtime core attaches the image group plan beside the world only when it changes',async()=>{
 const encoder=new TextEncoder(),decoder=new TextDecoder();let length=0,inputLength=0,frame=0,revision=1;
 const requests=[],module={HEAPU8:new Uint8Array(65536),_unone_web_alloc:n=>{inputLength=n;return 0;},_unone_web_observation_ptr:()=>4096,_unone_web_observation_len:()=>length};
 const publish=value=>{const bytes=encoder.encode(JSON.stringify(value));module.HEAPU8.set(bytes,4096);length=bytes.length;return 0;};
 const world=()=>publish({world:{frame,instances3d:{}},observation_digest:'sha256:untouched'});
 module._unone_web_load_project=world;module._unone_web_set_instance_transport=world;module._unone_web_set_input_frame=()=>0;
 module._unone_web_tick=()=>{frame++;return world();};
 module._unone_web_image_groups_request=()=>{const request=JSON.parse(decoder.decode(module.HEAPU8.subarray(0,inputLength)));requests.push(request);return publish(request.after===revision?{revision}:{revision,groups:{town:'preload'}});};
 const core=createRuntimeCore(module);
 const first=await core.execute({kind:'load',payload:{config:{}}});
 assert.deepEqual(first.image_group_plan,{revision:1,groups:{town:'preload'}});
 assert.equal(first.world.image_group_plan,undefined);assert.equal(first.observation_digest,'sha256:untouched');
 const second=await core.execute({kind:'tick',input:{actions:{}}});
 assert.equal(second.image_group_plan,undefined);
 revision=2;const third=await core.execute({kind:'tick',input:{actions:{}}});
 assert.equal(third.image_group_plan.revision,2);
 assert.deepEqual(requests,[{kind:'plan',after:null},{kind:'plan',after:1},{kind:'plan',after:1}]);
 core.close();
});

test('page and game claims of one group share pixels; each releases independently',async()=>{
 const f=fixture(),target={};const remove=installPlayerAssetGroups(target,()=>f.broker);
 const page=target.unonePlayerAssets;
 try {
  await page.preload('town');f.host.acceptSnapshot(plan(1,{town:'load'}));await settle();exchange(f.host);
  assert.equal(page.status('town').mode,'load');
  assert.equal(page.status().held_bytes_estimate,32);assert.equal(page.status().broker.loads,2);
  f.host.acceptSnapshot(plan(2,{}));
  assert.deepEqual(exchange(f.host),[{name:'town',state:'unloaded',total:2,ready:0,bytes:0}]);
  assert.equal(page.status('town').state,'ready');assert.equal(page.status('town').mode,'preload');
  assert.equal(f.images.get('a').closed,0);
  f.host.acceptSnapshot(plan(3,{town:'load'}));exchange(f.host);
  page.unload('town');assert.equal(page.status('town').state,'ready');
  assert.equal(exchange(f.host),undefined,'the external release cannot alter the recorded game state');
  assert.equal(page.status().broker.loads,2);
  await page.load('town');f.host.reset();assert.equal(page.status('town').held,2);
  page.unload('town');assert.equal(f.images.get('a').closed,1);assert.equal(f.images.get('b').closed,1);
  assert.equal(page.status().held_bytes_estimate,0);
 } finally {remove();f.host.close();f.broker.dispose();}
});

test('dropping one pending claim cancels just its waiter, including across reset and reentry',async()=>{
 const waiting=[];
 const f=fixture({load:(url,{signal})=>new Promise((resolve,reject)=>{
   signal.addEventListener('abort',()=>reject(Error('unexpected physical cancellation')),{once:true});waiting.push(resolve);
 })});
 const target={};const remove=installPlayerAssetGroups(target,()=>f.broker);const page=target.unonePlayerAssets;
 try {
  const first=page.load('town');f.host.acceptSnapshot(plan(1,{town:'preload'}));await settle();
  assert.equal(waiting.length,2);page.unload('town');
  await assert.rejects(first,/IMAGE_ASSET_CANCELLED/);assert.equal(page.status('town').state,'loading');
  const second=page.preload('town');f.host.reset();
  for(const done of waiting)done({width:2,height:2,close(){}});
  assert.equal((await second).state,'ready');assert.equal(page.status().broker.loads,2);
  f.host.acceptSnapshot(plan(1,{town:'preload'}));
  assert.equal(exchange(f.host)[0].state,'ready');
  page.unload('town');assert.equal(page.status('town').held,2);
  f.host.close();assert.equal(page.status('town').held,0);
 } finally {remove();f.host.close();f.broker.dispose();}
});

test('either holder can retry the same failed group and the other holder keeps the recovered images',async()=>{
 for(const retryBy of ['game','page']){
  let failed=true;const f=fixture({load:async()=>{if(failed)throw Error('temporary');return {width:2,height:2,close(){}};}});
  const target={};const remove=installPlayerAssetGroups(target,()=>f.broker);const page=target.unonePlayerAssets;
  try {
   const pending=page.load('town');f.host.acceptSnapshot(plan(1,{town:'preload'}));
   await assert.rejects(pending,/temporary/);assert.equal(exchange(f.host)[0].state,'error');
   failed=false;
   if(retryBy==='game'){
    const again=plan(2,{town:'preload'});again.image_group_plan.retries=['town'];f.host.acceptSnapshot(again);
   } else await page.load('town');
   await settle();assert.equal(exchange(f.host)[0].state,'ready');
   f.host.reset();assert.equal(page.status('town').state,'ready');assert.equal(page.status('town').held,2);
   page.unload('town');assert.equal(page.status().held_entries,0);
  } finally {remove();f.host.close();f.broker.dispose();}
 }
});

test('100 historical groups stop polling after the release receipt commits; abandoned and stale tokens are harmless',()=>{
 let calls=0;
 const active=new Set(),groups={
  load(n){active.add(n);},unload(n){active.delete(n);return {total:1};},
  status(n){calls++;return {state:active.has(n)?'ready':'unloaded',total:1,ready:1,held:1,reserved_bytes_estimate:8};},
 };
 const host=createImageGroupHost({getGroups:()=>groups});
 const many=Object.fromEntries(Array.from({length:100},(_,i)=>['g'+i,'load']));
 host.acceptSnapshot(plan(1,many));assert.equal(exchange(host).length,100);
 host.acceptSnapshot(plan(2,{}));const unsent=host.leaseInput({});
 assert.equal(unsent.token.length,100);assert.deepEqual(host.leaseInput({}).frame,unsent.frame);
 host.acceptSnapshot(plan(3,{g0:'load'}));host.commitInput(unsent.token);
 assert.equal(host.report().reported,1);host.acceptSnapshot(plan(4,{}));assert.equal(exchange(host).length,1);
 calls=0;for(let i=0;i<120;i++)assert.equal(exchange(host),undefined);
 assert.equal(calls,0);assert.equal(host.report().reported,0);
 host.acceptSnapshot(plan(5,{g0:'load'}));const previous=host.leaseInput({});host.reset();
 host.acceptSnapshot(plan(1,{g0:'load'}));host.commitInput(previous.token);
 assert.equal(exchange(host)[0].state,'ready','a prior session cannot acknowledge the new one');host.close();
});
