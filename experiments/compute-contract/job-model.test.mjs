import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {JobModel} from './job-model.mjs';

const b = (...values) => Uint8Array.from(values);
const throws = (fn,code) => assert.throws(fn,e=>e.code===code);

test('Buffer inputs/results own copies of bytes, not aliased Buffer slices',()=>{
  const m=new JobModel(),tickInput=Buffer.from([7]);m.requestTick(tickInput);
  const tickHash=m.inspect().input_hash;tickInput[0]=99;
  assert.equal(m.inspect().input_hash,tickHash);assert.deepEqual(m.enterTick().input,b(7));
  const jobInput=Buffer.from([8]),id=m.submit(jobInput,8);jobInput[0]=88;
  throws(()=>m.dispatchInput(id),'JOB_NOT_DISPATCHABLE');m.finishTick();
  const sent=m.dispatchInput(id);assert.deepEqual(sent,b(8));sent[0]=77;
  assert.deepEqual(m.dispatchInput(id),b(8));
  const output=Buffer.from([5]);m.complete(id,output);output[0]=9;
  m.requestTick(b());m.enterTick();const taken=m.take(id);assert.deepEqual(taken,b(5));
  assert.equal(taken.buffer.byteLength,1); // Does not retain a Buffer slab through a view.
  m.finishTick();
});
function queued(model=new JobModel(),count=1) {
  model.requestTick(b(1)); model.enterTick();
  const ids=Array.from({length:count},(_,i)=>model.submit(b(i),8));
  model.finishTick(); return {model,ids};
}
function permutations(a) {
  return a.length ? a.flatMap((n,i)=>permutations(a.filter((_,j)=>j!==i)).map(p=>[n,...p])) : [[]];
}

test('all completion permutations produce identical applied bytes, once, at N+1',()=>{
  const digests=[];
  for(const order of permutations([0,1,2,3])) {
    const {model:m,ids}=queued(new JobModel(),4);
    const input=b(9,8);assert.equal(m.requestTick(input),'pending');input[0]=0;
    const fixed=m.inspect().input_hash;
    for(const i of order) {
      const before=m.inspect().frame;
      m.complete(ids[i],b(i,10+i));
      assert.equal(m.complete(ids[i],b(i,10+i)),'duplicate');
      assert.equal(m.inspect().frame,before);assert.equal(m.inspect().input_hash,fixed);
    }
    const tick=m.enterTick();assert.deepEqual(tick.delivered,ids);assert.equal(tick.frame,2);
    assert.deepEqual(tick.input,b(9,8));
    const result=ids.flatMap(id=>[...m.take(id)]);
    throws(()=>m.take(ids[0]),'JOB_EXPIRED');m.finishTick();assert.equal(m.inspect().frame,2);
    digests.push(createHash('sha256').update(b(...result)).digest('hex'));
  }
  assert.equal(new Set(digests).size,1);
});

test('waiting never consumes another input or counts a completed tick',()=>{
  const {model:m,ids}=queued();m.requestTick(b(4));const before=m.inspect();
  for(let i=0;i<100;i++) {
    throws(()=>m.enterTick(),'BARRIER_PENDING');
    throws(()=>m.requestTick(b(99)),'TICK_ALREADY_REQUESTED');
    assert.deepEqual(m.inspect(),before);
  }
  throws(()=>m.finishTick(),'UPDATE_NOT_ENTERED');
  m.complete(ids[0],b(7));assert.equal(m.inspect().tick_status,'ready');
  assert.deepEqual(m.enterTick().input,b(4));m.take(ids[0]);m.finishTick();
});

test('pause during wait preserves frozen input; step awaits barrier and completes exactly once',()=>{
  const {model:m,ids}=queued();m.requestTick(b(9));m.setPaused(true);
  m.complete(ids[0],b(4));throws(()=>m.enterTick(),'TICK_PAUSED');assert.equal(m.inspect().frame,1);
  m.setPaused(false);assert.deepEqual(m.enterTick().input,b(9));m.take(ids[0]);m.finishTick();
  m.setPaused(true);throws(()=>m.requestTick(b()),'TICK_PAUSED');
  m.requestTick(b(3),'step');m.enterTick();const next=m.submit(b(),8);m.finishTick();
  m.requestTick(b(4),'step');throws(()=>m.enterTick(),'BARRIER_PENDING');
  m.complete(next,b(6));m.enterTick();m.take(next);m.finishTick();
  assert.equal(m.inspect().frame,4);assert.equal(m.inspect().paused,true);
  throws(()=>m.enterTick(),'NO_TICK_REQUEST');
});

test('cancel removes barrier and wins over any not-yet-taken completion',()=>{
  for(const completeFirst of [false,true]) {
    const {model:m,ids}=queued();m.requestTick(b(1));
    if(completeFirst)m.complete(ids[0],b(2));m.cancel(ids[0]);
    throws(()=>m.complete(ids[0],b(2)),'JOB_EXPIRED');
    assert.equal(m.inspect().tick_status,'ready');assert.deepEqual(m.enterTick().delivered,[]);
    m.finishTick();assert.equal(m.inspect().retained_bytes,0);
  }
});

test('game reset and successful reload invalidate results; failed reload preserves input/jobs',()=>{
  for(const action of ['reset','reload']) {
    const {model:m,ids}=queued();m.requestTick(b(5));const before=m.inspect();
    m.reload(false);assert.deepEqual(m.inspect(),before);
    if(action==='reset')m.reset();else m.reload(true);
    assert.equal(m.inspect().frame,1);assert.equal(m.inspect().retained_bytes,0);
    throws(()=>m.complete(ids[0],b(2)),'STALE_JOB');
    const fresh=queued(m);assert.notEqual(fresh.ids[0],ids[0]);
    throws(()=>m.complete(ids[0],b(2)),'STALE_JOB');
  }
});

test('closed/reopened sessions reject old completion even if local sequence matches',()=>{
  const first=queued();first.model.close();throws(()=>first.model.complete(first.ids[0],b()),'SESSION_CLOSED');
  const next=queued();throws(()=>next.model.complete(first.ids[0],b()),'STALE_JOB');
  assert.equal(next.model.inspect().jobs[0].state,'queued');
});

test('aggregate reservation bounds retained untaken results, input snapshots and job count',()=>{
  const m=new JobModel({retained_bytes:12});
  m.requestTick(b(1));m.enterTick();const id=m.submit(b(2),8);
  throws(()=>m.submit(b(3),8),'TOTAL_BYTES_EXCEEDED');assert.equal(m.inspect().jobs.length,1);
  m.finishTick();m.complete(id,b(7));m.requestTick(b(4));m.enterTick();
  throws(()=>m.submit(b(3),8),'TOTAL_BYTES_EXCEEDED');
  m.take(id);m.submit(b(3),8);m.finishTick();assert(m.inspect().retained_bytes<=12);
  const limited=new JobModel({jobs:1});const q=queued(limited);limited.complete(q.ids[0],b());
  limited.requestTick(b());limited.enterTick();throws(()=>limited.submit(b(),0),'JOB_LIMIT');
  const perTick=new JobModel({jobs_per_tick:1});perTick.requestTick(b());perTick.enterTick();
  perTick.submit(b(),0);throws(()=>perTick.submit(b(),0),'JOB_LIMIT');
});

test('malformed/oversize submissions fail before state mutation and input is copied',()=>{
  throws(()=>new JobModel({typo:1}),'UNKNOWN_LIMIT');throws(()=>new JobModel({jobs:0}),'INVALID_LIMIT');
  const m=new JobModel({input_bytes:2,output_bytes:2,tick_input_bytes:2});
  throws(()=>m.submit(b(),1),'SUBMIT_OUTSIDE_UPDATE');
  throws(()=>m.requestTick(b(1,2,3)),'TICK_INPUT_TOO_LARGE');
  m.requestTick(b());m.enterTick();const before=m.inspect();
  throws(()=>m.submit(b(1,2,3),1),'INPUT_TOO_LARGE');throws(()=>m.submit(b(),3),'OUTPUT_CAPACITY_INVALID');
  throws(()=>m.submit([],1),'BYTES_REQUIRED');assert.deepEqual(m.inspect(),before);
  const input=b(8),id=m.submit(input,2),digest=m.inspect().jobs[0].input_hash;input[0]=9;
  assert.equal(m.inspect().jobs[0].input_hash,digest);
  throws(()=>m.complete(id,b()),'JOB_NOT_DISPATCHABLE');
  throws(()=>m.reset(),'RESET_DURING_UPDATE');throws(()=>m.reload(true),'RELOAD_DURING_UPDATE');
});

test('conflicting or oversize completion faults whole barrier, never partially delivers',()=>{
  for(const conflict of [false,true]) {
    const {model:m,ids}=queued(new JobModel(),2);m.requestTick(b());
    m.complete(ids[0],b(1));
    if(conflict)m.complete(ids[0],b(2));else m.complete(ids[1],new Uint8Array(9));
    assert.equal(m.inspect().phase,'faulted');assert.equal(m.inspect().frame,1);
    assert.equal(m.inspect().retained_bytes,0);throws(()=>m.enterTick(),'SESSION_FAULTED');
  }
});

test('executor failure stages are terminal signals; script failure never dispatches staged jobs',()=>{
  for(const code of ['START_TIMEOUT','ALLOC_TRAP','COMPUTE_TIMEOUT','FREE_TRAP','MODULE_LOAD_FAILED']) {
    const {model:m,ids}=queued();m.fault(code,ids[0]);assert.equal(m.inspect().fault.code,code);
    throws(()=>m.requestTick(b()),'SESSION_FAULTED');
  }
  const m=new JobModel();m.requestTick(b());m.enterTick();m.submit(b(1),8);m.fault('SCRIPT_FAILED');
  assert.equal(m.inspect().frame,0);assert.deepEqual(m.inspect().jobs,[]);
});
