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
