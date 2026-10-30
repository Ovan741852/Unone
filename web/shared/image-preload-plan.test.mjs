import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssetCatalog,createImageAssetBroker,validateImagePreloadPlan,IMAGE_PRELOAD_PLAN_VERSION,IMAGE_PRELOAD_PLAN_MAX_BYTES} from './asset-encoding.js';
const asset=id=>({id,kind:'texture2d',source:id+'.png'});
const catalog=(ids=['a','b','c'])=>createAssetCatalog({assets:ids.map(asset)});
const plan=()=>({version:1,groups:{boot:['a','b'],later:['c']},startup:['boot']});
const fake=id=>({id,width:2,height:2,closed:0,close(){this.closed++;}});
function broker(raw,options={}){const loaded=[],images=new Map();const result=createImageAssetBroker(catalog(),{resolveAssetUrl:a=>a.source,loadImage:async(url,{asset:a})=>{loaded.push(a.id);const image=fake(a.id);images.set(a.id,image);return image;},inspectImage:async()=>({format:'png',width:2,height:2}),preloadPlan:raw,...options});return{result,loaded,images};}

test('canonical preload plan is detached and deeply frozen with independent default budget fields',()=>{
 assert.equal(IMAGE_PRELOAD_PLAN_VERSION,1);assert.equal(IMAGE_PRELOAD_PLAN_MAX_BYTES,1048576);
 const authored=plan(),value=validateImagePreloadPlan(authored,catalog());assert.deepEqual(value,{...authored,budget:{max_bytes:67108864,max_entries:128}});
 for(const object of [value,value.groups,value.groups.boot,value.startup,value.budget])assert(Object.isFrozen(object));authored.groups.boot[0]='c';authored.startup.push('later');assert.deepEqual(value.groups.boot,['a','b']);assert.deepEqual(value.startup,['boot']);
 assert.equal(validateImagePreloadPlan({...plan(),budget:{max_entries:2}},catalog()).budget.max_bytes,67108864);assert.equal(validateImagePreloadPlan({...plan(),budget:{max_bytes:32}},catalog()).budget.max_entries,128);
 assert.deepEqual(validateImagePreloadPlan({version:1,groups:{},startup:[]},catalog()).startup,[]);
});

test('strict required shape, version and unknown fields reject instead of silently defaulting',()=>{
 for(const value of [null,[],{}, {groups:{},startup:[]},{version:2,groups:{},startup:[]},{version:1,groups:{}},{version:1,startup:[]},{...plan(),extra:true},{...plan(),budget:{max_bytes:32,extra:true}},{...plan(),budget:undefined},{...plan(),budget:null}])assert.throws(()=>validateImagePreloadPlan(value,catalog()),/IMAGE_PRELOAD_PLAN_INVALID/);
 assert.throws(()=>validateImagePreloadPlan(plan(),{assets:[]}),/ASSET_CATALOG_REQUIRED/);
});

test('plain JSON rejects accessors, symbol fields, custom prototypes, holes and array callbacks',()=>{
 let getterCalls=0;const accessor=plan();Object.defineProperty(accessor,'budget',{enumerable:true,get(){getterCalls++;return{};}});const symbol=plan();symbol[Symbol('bad')]=1;const custom=Object.assign(Object.create({inherited:true}),plan());
 const hole=plan();hole.groups.boot=new Array(1);const callback=plan();callback.groups.boot.toJSON=()=>['a'];const inherited=plan();inherited.groups=Object.create({boot:['a']});const hidden=plan();Object.defineProperty(hidden,'secret',{value:true});
 for(const value of [accessor,symbol,custom,hole,callback,inherited,hidden])assert.throws(()=>validateImagePreloadPlan(value,catalog()),/IMAGE_PRELOAD_PLAN_INVALID/);assert.equal(getterCalls,0);
});

test('closed-shape validation rejects cyclic direct JS inputs without recursive generic traversal',()=>{
 const rootCycle=plan();rootCycle.self=rootCycle;const groupCycle=plan();groupCycle.groups.loop=groupCycle.groups;const refsCycle=plan();refsCycle.groups.boot=[refsCycle];const startupCycle=plan();startupCycle.startup=[startupCycle.startup];const budgetCycle=plan();budgetCycle.budget={};budgetCycle.budget.max_bytes=budgetCycle.budget;
 for(const value of [rootCycle,groupCycle,refsCycle,startupCycle,budgetCycle])assert.throws(()=>validateImagePreloadPlan(value,catalog()),/IMAGE_PRELOAD_PLAN_INVALID/);
});

test('prototype-sensitive group names are own data and cannot alter canonical prototypes',()=>{
 const raw=JSON.parse('{"version":1,"groups":{"__proto__":["a"],"constructor":["b"],"toString":["c"]},"startup":["__proto__","constructor","toString"]}');
 const value=validateImagePreloadPlan(raw,catalog());assert.equal(Object.getPrototypeOf(value.groups),Object.prototype);assert.equal(Object.hasOwn(value.groups,'__proto__'),true);assert.deepEqual(value.groups.__proto__,['a']);assert.deepEqual(value.groups.constructor,['b']);assert.deepEqual(JSON.parse(JSON.stringify(value)),raw.budget?raw:{...raw,budget:{max_bytes:67108864,max_entries:128}});assert.equal({}.a,undefined);
 assert.throws(()=>validateImagePreloadPlan({version:1,groups:{__proto__:['a']},startup:['__proto__']},catalog()),/plain JSON/);
});

test('all group assets are validated even when their group is not in startup',()=>{
 for(const bad of ['missing',1,null,()=>{}]){const value=plan();value.groups.later=[bad];assert.throws(()=>validateImagePreloadPlan(value,catalog()),/IMAGE_PRELOAD_PLAN_INVALID/);}
 const audio=createAssetCatalog({assets:[asset('a'),{id:'sound',kind:'audio',source:'sound.wav'}]});assert.throws(()=>validateImagePreloadPlan({version:1,groups:{unused:['sound']},startup:[]},audio),/texture2d/);
 const wrong=createAssetCatalog({assets:[{...asset('a'),encoding:{decoder:'audio',format:'png',mime:'image/png'}}]});assert.throws(()=>validateImagePreloadPlan({version:1,groups:{unused:['a']},startup:[]},wrong),/HOST_ASSET_ENCODING_UNSUPPORTED/);
});

test('startup groups must exist and cannot repeat',()=>{
 assert.throws(()=>validateImagePreloadPlan({...plan(),startup:['missing']},catalog()),/startup groups/);assert.throws(()=>validateImagePreloadPlan({...plan(),startup:['boot','boot']},catalog()),/startup groups/);assert.throws(()=>validateImagePreloadPlan({...plan(),startup:'boot'},catalog()),/bounded JSON array/);
});

test('group and asset names use UTF8 byte bounds including Unicode',()=>{
 const group='é'.repeat(64),id='é'.repeat(1024),longCatalog=catalog([id]);const valid={version:1,groups:{[group]:[id]},startup:[group]};assert.equal(validateImagePreloadPlan(valid,longCatalog).groups[group][0],id);
 assert.throws(()=>validateImagePreloadPlan({version:1,groups:{['é'.repeat(65)]:[]},startup:[]},catalog()),/UTF-8/);
 const tooLong='é'.repeat(1024)+'a';assert.throws(()=>validateImagePreloadPlan({version:1,groups:{g:[tooLong]},startup:[]},catalog([tooLong])),/UTF-8/);
 assert.throws(()=>validateImagePreloadPlan({version:1,groups:{'':[]},startup:[]},catalog()),/UTF-8/);
 const emoji='😀'.repeat(32);assert.equal(validateImagePreloadPlan({version:1,groups:{[emoji]:[]},startup:[emoji]},catalog()).startup[0],emoji);
});

test('group and full-expanded reference limits charge every duplicate occurrence',()=>{
 const groups={};for(let i=0;i<128;i++)groups['g'+i]=[];assert.equal(Object.keys(validateImagePreloadPlan({version:1,groups,startup:[]},catalog()).groups).length,128);groups.excess=[];assert.throws(()=>validateImagePreloadPlan({version:1,groups,startup:[]},catalog()),/groups exceeds/);
 const refs=Array(4096).fill('a');assert.equal(validateImagePreloadPlan({version:1,groups:{g:refs},startup:[]},catalog()).groups.g.length,4096);assert.throws(()=>validateImagePreloadPlan({version:1,groups:{g:[...refs,'a']},startup:[]},catalog()),/bounded JSON array/);
 const four={a:refs,b:refs,c:refs,d:refs};assert.equal(validateImagePreloadPlan({version:1,groups:four,startup:[]},catalog()).groups.d.length,4096);assert.throws(()=>validateImagePreloadPlan({version:1,groups:{...four,extra:['a']},startup:[]},catalog()),/total references/);
});

test('plan budget is positive safe integer and bounded independently from unused/GPU policy',()=>{
 for(const budget of [{max_bytes:0},{max_entries:0},{max_bytes:1073741825},{max_entries:65537},{max_bytes:1.5},{max_entries:NaN},{max_bytes:null},{max_entries:undefined},{max_bytes:Infinity}])assert.throws(()=>validateImagePreloadPlan({...plan(),budget},catalog()),/positive bounded/);
 assert.deepEqual(validateImagePreloadPlan({...plan(),budget:{max_bytes:1073741824,max_entries:65536}},catalog()).budget,{max_bytes:1073741824,max_entries:65536});
});

test('actual escaped UTF8 canonical bytes must fit the one-MiB limit',()=>{
 const id='a'.repeat(2048),assets=catalog([id]),base={version:1,groups:{g:[]},startup:[]};const emptyBytes=Buffer.byteLength(JSON.stringify(validateImagePreloadPlan(base,assets))),perReference=Buffer.byteLength(JSON.stringify(id))+1;
 const count=Math.floor((IMAGE_PRELOAD_PLAN_MAX_BYTES-emptyBytes+1)/perReference),within={...base,groups:{g:Array(count).fill(id)}};const canonical=validateImagePreloadPlan(within,assets);assert(Buffer.byteLength(JSON.stringify(canonical))<=IMAGE_PRELOAD_PLAN_MAX_BYTES);assert.throws(()=>validateImagePreloadPlan({...base,groups:{g:Array(count+1).fill(id)}},assets),/encoded plan/);
 const escaped='\u0001'.repeat(2048);assert.throws(()=>validateImagePreloadPlan({...base,groups:{g:Array(100).fill(escaped)}},catalog([escaped])),/encoded plan/);
 for(const special of ['\b\t\n\f\r"\\','\ud800','\udc00','😀é']){const value=validateImagePreloadPlan({version:1,groups:{[special]:[special]},startup:[special]},catalog([special]));assert.deepEqual(JSON.parse(JSON.stringify(value)).groups[special],[special]);}
});

test('broker merges startup group order before unique scene sprites and validates once',async()=>{
 const raw={version:1,groups:{second:['b','a','b'],first:['c','b']},startup:['first','second'],budget:{max_bytes:64,max_entries:3}},f=broker(raw);raw.groups.first[0]='missing';raw.startup.length=0;
 const result=await f.result.prepareScene({entities:[{sprite:{asset:'a',visible:false}},{sprite:{asset:'c'}}]});assert.equal(result.partial,false);assert.equal(result.startup_entries,3);assert.equal(result.required_entries,3);assert.equal(result.required_ready_entries,3);assert.equal(result.scene_declared_entries,2);assert.equal(result.declared_entries,3);assert.equal(result.duplicate_references,4);assert.deepEqual(result.startup_groups,['first','second']);assert.deepEqual(f.loaded,['c','b','a']);assert.equal(f.result.report().limits.sceneMaxBytes,64);assert.equal(f.result.report().limits.unusedMaxBytes,16777216);assert.equal(f.result.report().preload_plan.groups,2);f.result.dispose();
});

test('merged budget gives startup declarations priority and reports partial scene admission',async()=>{
 const f=broker({version:1,groups:{boot:['b','b']},startup:['boot'],budget:{max_bytes:16,max_entries:1}});const result=await f.result.prepareScene({entities:[{sprite:{asset:'a'}}]});assert.deepEqual(f.loaded,['b']);assert.equal(result.partial,true);assert.equal(result.declared_entries,2);assert.equal(result.startup_entries,1);assert.equal(result.required_entries,1);assert.equal(result.required_ready_entries,1);assert.equal(result.reserved_bytes,16);assert.deepEqual(result.budget_skipped,[{id:'a',reason:'scene_entry_budget'}]);f.result.dispose();
});

test('required failures keep exact IDs and only actual ready required images count',async()=>{
 const cases=[{field:'budget_skipped',budget:{max_bytes:64,max_entries:1},groups:['b','c'],options:{}},{field:'unsupported',budget:{max_bytes:64,max_entries:3},groups:['b'],options:{inspectImage:async(url,{asset:a})=>a.id==='b'?null:{format:'png',width:2,height:2}}},{field:'errors',budget:{max_bytes:64,max_entries:3},groups:['b'],options:{loadImage:async(url,{asset:a})=>{if(a.id==='b')throw Error('required-decode-failed');return fake(a.id);}}}];
 for(const c of cases){const f=broker({version:1,groups:{boot:c.groups},startup:['boot'],budget:c.budget},c.options);const result=await f.result.prepareScene({entities:[{sprite:{asset:'a'}}]});assert.equal(result.partial,true);assert.equal(result.required_entries,c.groups.length);assert.equal(result.required_ready_entries,c.field==='budget_skipped'?1:0);assert.equal(result[c.field][0].id,c.field==='budget_skipped'?'c':'b');f.result.dispose();}
});

test('no preload plan preserves scene-only behavior while malformed plans fail at construction',async()=>{
 const f=broker(null);const result=await f.result.prepareScene({entities:[{sprite:{asset:'a'}}]});assert.deepEqual(f.loaded,['a']);assert.equal(result.startup_entries,0);assert.equal(result.required_entries,0);assert.equal(result.required_ready_entries,0);assert.deepEqual(result.startup_groups,[]);assert.equal(f.result.report().preload_plan,null);f.result.dispose();assert.throws(()=>broker({version:1,groups:{bad:['missing']},startup:[]}),/declared texture2d/);
});
