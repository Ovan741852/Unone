import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchProjectData} from './load-project.js';
import {createRuntimeBackend} from './runtime-backend.mjs';

const base='https://game.invalid/releases/build/';
const project={
  data_assets:[{id:'first',source:'shared.bin'},{id:'other',source:'other.bin'},{id:'third',source:'shared.bin'}],
  script_bytecode:{source:'shared.bin'}
};

test('a load fetches and decodes each source once, preserving every ID, its position and progress',async t=>{
  const calls=[],bodyReads=[],progress=[];
  t.mock.method(globalThis,'fetch',async url=>{
    calls.push(url.href);
    return {ok:true,async arrayBuffer(){bodyReads.push(url.href);return Uint8Array.of(4,5).buffer;}};
  });
  const load=()=>fetchProjectData(project,base,(done,total)=>progress.push([done,total]));
  const first=await load();
  assert.deepEqual(first.map(asset=>asset.id),['first','other','third','unone:script-bytecode']);
  assert.deepEqual(calls,[base+'content/shared.bin',base+'content/other.bin']);
  assert.deepEqual(bodyReads,calls);
  assert.deepEqual(progress,[[1,4],[2,4],[3,4],[4,4]]);
  assert.equal(first[0].bytes,first[2].bytes);
  assert.equal(first[0].bytes,first[3].bytes);
  assert.notEqual(first[0].bytes.buffer,first[1].bytes.buffer);
  const second=await load();
  assert.equal(calls.length,4);
  assert.notEqual(first[0].bytes.buffer,second[0].bytes.buffer);
});

test('aliases share a failing fetch, other sources progress and the next load retries',async t=>{
  const requests=[],progress=[];
  let missing=true;
  t.mock.method(globalThis,'fetch',async url=>{
    requests.push(url.href);
    return url.pathname.endsWith('/shared.bin')&&missing
      ? new Response(null,{status:404})
      : new Response(Uint8Array.of(7));
  });
  await assert.rejects(fetchProjectData(project,base,(done,total)=>progress.push([done,total])),/CONTENT_LOAD_FAILED: shared\.bin \(404\)/);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(requests,[base+'content/shared.bin',base+'content/other.bin']);
  assert.deepEqual(progress,[[1,4]]);
  missing=false;
  assert.equal((await fetchProjectData(project,base)).length,4);
  assert.equal(requests.length,4);
});

test('worker load transfers each backing once and preserves aliased views and their offsets',async()=>{
  let received;
  class Worker {
    postMessage(message,transfer){
      const {id,command}=structuredClone(message,{transfer});
      if(command.kind==='load') received=command.data;
      queueMicrotask(()=>this.onmessage({data:{id,ok:true,packet:{value:null,updates:[],removed:[]}}}));
    }
    terminate(){}
  }
  const backend=await createRuntimeBackend({kind:'worker',url:base+'runtime.js',WorkerClass:Worker});
  const shared=Uint8Array.of(2,3,4),other=Uint8Array.of(2,3,4);
  try{
    await backend.request({kind:'load',data:[
      {id:'whole',bytes:shared},{id:'tail',bytes:shared.subarray(1)},{id:'independent',bytes:other}
    ]});
    assert.equal(shared.byteLength,0);
    assert.equal(other.byteLength,0);
    assert.deepEqual(received.map(({id,bytes})=>[id,[...bytes]]),[
      ['whole',[2,3,4]],['tail',[3,4]],['independent',[2,3,4]]
    ]);
    assert.equal(received[0].bytes.buffer,received[1].bytes.buffer);
    assert.notEqual(received[0].bytes.buffer,received[2].bytes.buffer);
  }finally{backend.close();}
});
