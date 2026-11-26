import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {createDeferredDataHost} from './deferred-data-host.mjs';
import {createRuntimeCore} from './runtime-core.mjs';
import {createRuntimeBackend} from './runtime-backend.mjs';
import {fetchProjectData} from './load-project.js';

const payload={config:{},data_assets:[
  {id:'config',source:'config.dat',loader:'bytes'},
  {id:'movie',source:'cutscene.smk',loader:'bytes',on_demand:true},
  {id:'also_movie',source:'cutscene.smk',loader:'bytes',on_demand:true},
]};
const bytes=Uint8Array.of(3,4,5);
const sha256=createHash('sha256').update(bytes).digest('hex');
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture(){
  let session=1,revision=1,requests=[],length=0,frame=0;
  const enc=new TextEncoder(),dec=new TextDecoder(),heap=new Uint8Array(65536),reserves=[],inputs=[];
  function publish(value){const bytes=enc.encode(JSON.stringify(value));length=bytes.length;heap.set(bytes,8192);return 0;}
  function world(){return publish({world:{frame,instances3d:{},receipts:inputs.at(-1)?.data_assets??[]}});}
  const module={HEAPU8:heap,_unone_web_alloc:()=>64,_unone_web_observation_ptr:()=>8192,_unone_web_observation_len:()=>length,
    _unone_web_load_project:()=>{frame=0;return world();},_unone_web_set_instance_transport:world,
    _unone_web_set_input_frame:(ptr,len)=>{inputs.push(JSON.parse(dec.decode(heap.subarray(ptr,ptr+len))));return 0;},
    _unone_web_tick:()=>{frame++;return world();},
    _unone_web_data_requests:after=>after===revision?1:publish({session,revision,requests}),
    _unone_web_deferred_reserve:(generation,token,length)=>{
      if(generation!==session||!requests.some(row=>row.request===token))return 0;
      const at=16384+reserves.length*64;reserves.push({generation,token,at,length});return at;
    },
  };
  return {module,inputs,reserves,plan(rows){revision++;requests=rows;},restart(){session++;revision=1;requests=[];}};
}
const movie={id:'movie',request:1},alias={id:'also_movie',request:2};
const ready=row=>({...row,state:'ready',sha256});

test('boot and restart fetch only eager data; script bytecode remains an eager dependency',async t=>{
  const requests=[],progress=[];
  t.mock.method(globalThis,'fetch',async url=>{requests.push(url.pathname);return new Response(bytes);});
  const p={...payload,script_bytecode:{source:'entry.luauc'}};
  for(let i=0;i<2;i++)assert.deepEqual((await fetchProjectData(p,'https://test.invalid/build/',(n,total)=>progress.push([n,total]))).map(x=>x.id),
    ['config','unone:script-bytecode']);
  assert.deepEqual(requests,['/build/content/config.dat','/build/content/entry.luauc','/build/content/config.dat','/build/content/entry.luauc']);
  assert.deepEqual(progress,[[1,2],[2,2],[1,2],[2,2]]);
});

test('concurrent aliases share one response and digest, preserving IDs and bytes until the recorded tick',async()=>{
  const f=fixture(),body=deferred(),calls=[];
  const host=createDeferredDataHost(f.module,payload,{readSource:(src,signal)=>{calls.push({src,signal});return body.promise;}});
  host.refresh();assert.equal(calls.length,0);f.plan([movie,alias]);host.refresh();host.refresh();
  assert.deepEqual(calls.map(x=>x.src),['cutscene.smk']);
  assert.deepEqual(await host.input({actions:{}}),{actions:{},data_assets:[]});
  const tape={actions:{},data_assets:[ready(alias),ready(movie)]};
  const replay=host.input(tape);assert.equal(f.reserves.length,0);
  body.resolve(bytes);assert.strictEqual(await replay,tape);
  assert.deepEqual(f.reserves.map(r=>r.token),[2,1]);
  for(const {at,length} of f.reserves)assert.deepEqual(f.module.HEAPU8.slice(at,at+length),bytes);
  assert.deepEqual(await host.input({}),{data_assets:[ready(movie),ready(alias)]});
  f.plan([]);host.refresh();assert.equal(calls[0].signal.aborted,true);host.close();
});

test('release plus retry in one game tick and a new runtime load discard stale fetches',async()=>{
  const f=fixture(),bodies=[];
  const core=createRuntimeCore(f.module,{readDeferredSource:(src,signal)=>{const body=deferred();bodies.push({...body,signal});return body.promise;}});
  try{
    await core.execute({kind:'load',payload});f.plan([movie]);
    await core.execute({kind:'tick',input:{}});assert.deepEqual(f.inputs.at(-1).data_assets,[]);
    f.plan([{id:'movie',request:3}]);await core.execute({kind:'tick',input:{}});
    assert.equal(bodies[0].signal.aborted,true);
    bodies[0].resolve(bytes);
    f.restart();await core.execute({kind:'load',payload});
    assert.equal(bodies[1].signal.aborted,true);
    bodies[1].resolve(bytes);
    await core.execute({kind:'tick',input:{}});assert.equal(f.reserves.length,0);assert.deepEqual(f.inputs.at(-1).data_assets,[]);
    f.plan([movie]);await core.execute({kind:'tick',input:{}});
    const final=core.execute({kind:'tick',input:{data_assets:[ready(movie)]}});
    bodies[2].resolve(bytes);await final;
    assert.deepEqual(f.reserves.map(x=>[x.generation,x.token]),[[2,1]]);
  }finally{core.close();}
});

test('failed HTTP bodies yield a stable failure; a second play retries the same URL and a corrupt replay is rejected',async t=>{
  const f=fixture(),urls=[],calls=[];
  t.mock.method(globalThis,'fetch',async(url,{signal})=>{
    urls.push(url.href);calls.push(signal);
    return urls.length===1?new Response(null,{status:404}):new Response(bytes);
  });
  const host=createDeferredDataHost(f.module,payload,{baseURL:'https://test.invalid/release/content/'});
  try{
    f.plan([movie]);host.refresh();await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(await host.input({}),{data_assets:[{...movie,state:'failed'}]});
    const retry={...movie,request:3};f.plan([retry]);host.refresh();
    await assert.rejects(host.input({data_assets:[{...ready(retry),sha256:'0'.repeat(64)}]}),/DEFERRED_DATA_REPLAY_MISMATCH/);
    assert.equal(f.reserves.length,0);await host.input({data_assets:[ready(retry)]});
    f.plan([]);host.refresh();f.plan([{...movie,request:4}]);host.refresh();
    await host.input({data_assets:[ready({...movie,request:4})]});
    assert.equal(urls.length,3);
    assert.ok(urls.every(url=>url==='https://test.invalid/release/content/cutscene.smk'));
  }finally{host.close();}
});

test('unsupported ABI and undeclared requests cannot fetch arbitrary sources',()=>{
  const f=fixture(),calls=[];
  assert.equal(createDeferredDataHost({},{}),null);
  assert.throws(()=>createDeferredDataHost({},payload),/DEFERRED_DATA_ABI_UNAVAILABLE/);
  const host=createDeferredDataHost(f.module,payload,{readSource:src=>calls.push(src)});
  f.plan([{id:'https://outside.invalid/file',request:1}]);
  assert.throws(host.refresh,/DEFERRED_DATA_PLAN_INVALID/);
  assert.deepEqual(calls,[]);host.close();
});

test('a new alias can retry while a recorded frame still withholds an older failed receipt',async()=>{
  const f=fixture();let calls=0;
  const host=createDeferredDataHost(f.module,payload,{readSource:async()=>{if(++calls===1)throw Error('network');return bytes;}});
  try{
    f.plan([movie]);host.refresh();await new Promise(resolve=>setImmediate(resolve));
    f.plan([movie,alias]);host.refresh();
    await host.input({data_assets:[ready(alias)]});
    assert.deepEqual((await host.input({})).data_assets,[{...movie,state:'failed'},ready(alias)]);
    assert.equal(calls,2);
  }finally{host.close();}
});

test('the production worker entry fetches directly in its own realm and returns the recorded receipt',async()=>{
  const workerBody=`
    const {parentPort,workerData}=require('node:worker_threads');
    const fixture=${fixture.toString()};
    globalThis.onmessage=null;
    globalThis.location=new URL('https://test.invalid/runtime-worker.js');
    globalThis.postMessage=(message,transfers)=>parentPort.postMessage(message,transfers);
    globalThis.importScripts=()=>{
      const f=fixture();
      f.plan([{id:'movie',request:1}]);
      Object.assign(globalThis.Module,f.module);
      globalThis.Module.onRuntimeInitialized();
    };
    globalThis.fetch=async url=>{
      if(url.href!=='https://test.invalid/exports/content/cutscene.smk')throw Error('worker content URL');
      return new Response(Uint8Array.of(1,8,4));
    };
    import(workerData.script).then(()=>parentPort.on('message',data=>globalThis.onmessage({data})));
  `;
  class BrowserWorker {
    constructor(script){
      this.worker=new Worker(workerBody,{eval:true,workerData:{script:script.href}});
      this.worker.on('message',data=>this.onmessage?.({data}));
      this.worker.on('error',error=>this.onerror?.(error));
    }
    postMessage(value,transfers){this.worker.postMessage(value,transfers);}
    terminate(){this.worker.terminate();}
  }
  const backend=await createRuntimeBackend({kind:'worker',url:'https://test.invalid/runtime.js',WorkerClass:BrowserWorker});
  try{
    await backend.request({kind:'load',payload,contentBaseURL:'https://test.invalid/exports/content/',data:[]});
    const receipt={...movie,state:'ready',sha256:createHash('sha256').update(Uint8Array.of(1,8,4)).digest('hex')};
    const snapshot=await backend.request({kind:'tick',input:{data_assets:[receipt]}});
    assert.deepEqual(snapshot.world.receipts,[receipt]);
  }finally{backend.close();}
});
