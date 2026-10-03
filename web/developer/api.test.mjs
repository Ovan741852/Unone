import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeveloperAPI} from './api.js';
test('asset usages join cached source evidence with live nodes, aliases and nearest component without ticking',async()=>{
 let loads=0,ticks=0,core=0;
 const source={version:1,project_root:'fixture',assets:{'texture://button':'button.png','texture://alias':'button.png'},references:[{asset_ids:['texture://alias'],path:'ui/other.luau',line:7,kind:'literal',evidence:'other page'}],unresolved:[{path:'main.luau',line:9,kind:'dynamic_asset_expression'}],source_files:[],scope:{scan_complete:true,runtime_complete:false}};
 const snapshot={world:{frame:3,entities:[],ui:{id:'screen',kind:'screen',children:[{id:'outer',kind:'component',children:[{id:'button',kind:'component',component:'ui.button',children:[{id:'plate',kind:'image',asset:'texture://button'}]}]}]}}};
 const api=createDeveloperAPI({getAssetUsageIndex:async()=>{loads++;return source;},getSnapshot:()=>snapshot,tick:()=>ticks++,coreRequest:()=>core++},{});
 assert.equal((await api.request({method:'asset.usages',id:''})).ok,false);assert.equal(loads,0);
 const report=await api.request({method:'asset.usages',id:'texture://button'});
 assert.equal(report.ok,true);assert.deepEqual(report.effects,[]);assert.equal(report.value.live[0].component_id,'button');
 assert.equal(report.value.references[0].line,7);assert.equal(report.value.unresolved.length,1);
 assert.equal((await api.request({method:'asset.usages',id:'button.png'})).value.live.length,1);
 assert.equal((await api.request({method:'assets'})).value.assets.length,2);assert.equal(loads,1);assert.equal(ticks,0);assert.equal(core,0);
 snapshot.world.ui.children=[];
 assert.equal((await api.request({method:'asset.usages',id:'texture://button'})).value.live.length,0);
 assert.equal((await api.request({method:'journal'})).value.events.length,1); // invalid request only; reads are not journal mutations
});
test('missing or invalid source indexes preserve live evidence and retry rather than claiming zero usage',async()=>{
 let loads=0;
 const api=createDeveloperAPI({getSnapshot:()=>({world:{frame:0,ui:{id:'picture',asset:'texture://live'}}}),getAssetUsageIndex:async()=>{loads++;if(loads===1)throw Error('re-export required');return {version:2};}},{});
 const first=(await api.request({method:'asset.usages',id:'texture://live'})).value;
 assert.equal(first.live.length,1);assert.match(first.source_error,/re-export/);assert.equal(first.scope,null);
 const second=(await api.request({method:'assets'})).value;assert.equal(second.assets[0].id,'texture://live');assert.match(second.source_error,/格式/);assert.equal(loads,2);
});
test('memory collection is explicit, bounded labels and typed options reach Core',async()=>{
 const commands=[];const api=createDeveloperAPI({coreRequest:async request=>{commands.push(request);return {samples:[]};},getSnapshot:()=>({world:{frame:0}})},{});
 assert.equal((await api.request({method:'memory.sample',label:'idle',collect:'yes'})).ok,false);
 assert.equal((await api.request({method:'memory.sample',label:'中'.repeat(54)})).ok,false);
 assert.equal(commands.length,0);
 assert.equal((await api.request({method:'memory.sample',label:'idle'})).ok,true);
 assert.equal((await api.request({method:'memory.sample',label:'idle',collect:true,warmup:true})).ok,true);
 await api.request({method:'memory.report'});await api.request({method:'memory.reset'});
 assert.deepEqual(commands,[{method:'memory_sample',label:'idle',collect:false,warmup:false},{method:'memory_sample',label:'idle',collect:true,warmup:true},{method:'memory_report'},{method:'memory_reset'}]);
});
test('profile reads and controls use the lightweight ABI and validate sampling',async()=>{
 const commands=[];let bytes=new Uint8Array(8192),length=0;
 const module={HEAPU8:bytes,_unone_web_alloc:()=>0,_unone_web_observation_ptr:()=>4096,_unone_web_observation_len:()=>length,
  _unone_web_developer_request(p,n){const command=JSON.parse(new TextDecoder().decode(bytes.slice(p,p+n)));commands.push(command);const data=new TextEncoder().encode(JSON.stringify({ok:true,value:{performance:{frames:1},window:{active:command.method==='profile_start'},publication:{publications:3,hash_work:{reused_bytes:16384}}}}));bytes.set(data,4096);length=data.length;return 0;}};
 const calls=[];const api=createDeveloperAPI({module,getSnapshot:()=>({world:{frame:1}}),getStats:()=>null,getPaused:()=>true,profileWindow:{start:()=>calls.push('start'),stop:()=>calls.push('stop'),read:()=>({})}},{});
 assert.equal((await api.request({method:'profile.start',sampling:'yes'})).ok,false);assert.equal(commands.length,0);
 assert.equal((await api.request({method:'profile.start',sampling:true})).ok,true);
 assert.equal((await api.request({method:'profile'})).value.publication.hash_work.reused_bytes,16384);assert.equal((await api.request({method:'profile.stop'})).ok,true);
 assert.deepEqual(commands,[{method:'profile_start',sampling:true},{method:'profile'},{method:'profile_stop'}]);assert.deepEqual(calls,['start','stop']);
});
test('observations reads cached game state without a WASM call or packed scene snapshot',async()=>{
 const api=createDeveloperAPI({module:{},getSnapshot:()=>({world:{frame:9,observations:{alive:10000},entities:['excluded']}}),getStats:()=>({draw_calls:15}),getPaused:()=>true},{});
 const result=(await api.request({method:'observations'}));
 assert.equal(result.ok,true);assert.deepEqual(result.value,{frame:9,observations:{alive:10000},renderer:{draw_calls:15},paused:true});
 assert.equal((await api.request({method:'observations',typo:true})).ok,false);
});
function setup(){let paused=false,ticks=0,queued=null;const host={module:{},getSnapshot:()=>({world:{frame:ticks}}),getPaused:()=>paused,setPaused:value=>{paused=value;},releaseInput(){},tick(){ticks++;},draw(){},queueInput:value=>{queued=value;}};return {api:createDeveloperAPI(host,{}),ticks:()=>ticks,queued:()=>queued};}
test('step requires pause, validates bounds, and executes the exact requested count',async()=>{
 const {api,ticks}=setup();assert.equal((await api.request({method:'step'})).ok,false);assert.equal(ticks(),0);
 assert.equal((await api.request({method:'pause',paused:true})).ok,true);
 assert.equal((await api.request({method:'step',count:121})).ok,false);assert.equal(ticks(),0);
 assert.equal((await api.request({method:'step',count:3})).ok,true);assert.equal(ticks(),3);
});
test('unknown method/typo fails and injected input does not silently tick',async()=>{
 const {api,ticks,queued}=setup();assert.equal((await api.request({method:'pause',paused:true,typo:1})).ok,false);
 assert.equal((await api.request({method:'eval',source:'anything'})).ok,false);
 assert.equal((await api.request({method:'input',frame:{actions:{Fire:true}}})).ok,true);assert.equal(ticks(),0);assert.equal(queued().actions.Fire,true);
 assert.equal((await api.request({method:'journal'})).value.events.length,3);
});
test('screenshot validates dimensions before readback and never ticks',async()=>{
 let captures=0,ticks=0;
 const api=createDeveloperAPI({getSnapshot:()=>({world:{frame:7}}),capture:options=>{captures++;return {frame:7,...options};},tick:()=>ticks++},{});
 assert.equal((await api.request({method:'screenshot',max_width:9000})).ok,false);
 assert.equal((await api.request({method:'screenshot',width:640})).ok,false);
 assert.equal(captures,0);
 const result=(await api.request({method:'screenshot',max_width:640}));
 assert.equal(result.ok,true);assert.equal(result.value.max_height,720);
 assert.equal(result.value.frame,7);assert.equal(captures,1);assert.equal(ticks,0);assert.deepEqual(result.effects,[]);
});
