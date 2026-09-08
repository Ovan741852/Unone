import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseJobWorkers,createJobPool} from './job-pool.mjs';
test('device policy caps resources, supports inline, and rejects typos',()=>{
 assert.equal(chooseJobWorkers({}, {cores:1,memoryGB:8}).workers,0);
 assert.equal(chooseJobWorkers({}, {cores:16,memoryGB:8}).workers,2);
 assert.equal(chooseJobWorkers({max_workers:4},{cores:16,memoryGB:1}).workers,2);
 assert.equal(chooseJobWorkers({}, {cores:16,heapBytes:256*1024**2}).workers,0);
 assert.equal(chooseJobWorkers({mode:'inline'}, {cores:32}).workers,0);
 assert.equal(chooseJobWorkers({}, {cores:16,workerAvailable:false}).workers,0);
 assert.throws(()=>chooseJobWorkers({typo:2}));assert.throws(()=>chooseJobWorkers({max_workers:5}));
});
class FakeWorker {
 static created=[];
 constructor(){FakeWorker.created.push(this);}
 postMessage(data,transfer){if(data.kind==='init')queueMicrotask(()=>this.onmessage({data:{kind:'ready'}}));else{assert.deepEqual(transfer,[data.work.input]);this.message=structuredClone(data,{transfer});}}
 complete(){const m=this.message;this.message=null;this.onmessage({data:{id:m.id,ok:true,result:{kind:'complete',id:m.work.id,run_ms:1,output:new Uint8Array([1]).buffer,error:null}}});}
 terminate(){this.terminated=true;}
}
test('two slots run concurrently; queue stays bounded and closes cleanly',async()=>{
 FakeWorker.created=[];const p=createJobPool({url:'http://example.test/a.js',workers:2,WorkerClass:FakeWorker});
 const jobs=Array.from({length:16},(_,i)=>p.submit({id:String(i),source:'copy',input:new Uint8Array([1]).buffer}));
 await assert.rejects(p.submit({id:'overflow'}),/JOB_QUEUE_FULL/);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(p.report().active,2);assert.equal(FakeWorker.created.length,2);
 // Deliberately complete the second slot first.
 FakeWorker.created[1].complete();FakeWorker.created[0].complete();
 for(let i=2;i<16;i++)FakeWorker.created.find(w=>w.message&&p.report().active).complete();
 const results=await Promise.all(jobs);assert.deepEqual(results.map(r=>r.id),Array.from({length:16},(_,i)=>String(i)));
 p.close();assert.ok(FakeWorker.created.every(w=>w.terminated));
});
test('shutdown rejects active and queued jobs; no orphan promises',async()=>{
 FakeWorker.created=[];const p=createJobPool({url:'a',workers:1,WorkerClass:FakeWorker});
 const results=Promise.allSettled([p.submit({id:'a',source:'a',input:new ArrayBuffer(0)}),p.submit({id:'b',source:'a',input:new ArrayBuffer(0)})]);
 await new Promise(resolve=>setImmediate(resolve));p.close();assert.ok((await results).every(r=>r.status==='rejected'));
});
