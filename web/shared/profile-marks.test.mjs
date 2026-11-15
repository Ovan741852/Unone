// api.profile.mark milestones: read beside the world only when the game made one,
// carried through either backend, and stamped by the main host on acceptance and
// on the first completed submission that shows the mark's frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeCore} from './runtime-core.mjs';
import {createPlayerCompletionMetrics} from './player-completion.mjs';
import {InstanceTransfer,InstanceReceiver} from './instance-transfer.mjs';

function fakeRuntime(){
 const encoder=new TextEncoder(),decoder=new TextDecoder();let length=0,inputLength=0,frame=0;
 const state={revision:0,marks:[],requests:[],revisionReads:0};
 const module={HEAPU8:new Uint8Array(65536),_unone_web_alloc:n=>{inputLength=n;return 0;},_unone_web_observation_ptr:()=>4096,_unone_web_observation_len:()=>length};
 const publish=value=>{const bytes=encoder.encode(JSON.stringify(value));module.HEAPU8.set(bytes,4096);length=bytes.length;return 0;};
 const world=()=>publish({world:{frame,instances3d:{}},observation_digest:'sha256:untouched'});
 module._unone_web_load_project=world;module._unone_web_set_instance_transport=world;module._unone_web_set_input_frame=()=>0;
 module._unone_web_tick=()=>{frame++;return world();};
 module._unone_web_profile_marks_revision=()=>{state.revisionReads++;return state.revision;};
 module._unone_web_profile_marks_request=()=>{const request=JSON.parse(decoder.decode(module.HEAPU8.subarray(0,inputLength)));state.requests.push(request);
  return publish({revision:state.revision,marks:state.marks.filter(mark=>mark.sequence>request.after),dropped:0});};
 return {module,state};
}

test('runtime core reads one integer per publication and the marks only when it changed',async()=>{
 const {module,state}=fakeRuntime();state.revision=1;state.marks=[{name:'boot',frame:0,sequence:1}];
 const core=createRuntimeCore(module);
 const loaded=await core.execute({kind:'load',payload:{config:{}}});
 assert.deepEqual(loaded.profile_marks,{marks:[{name:'boot',frame:0,sequence:1}],dropped:0});
 assert.equal(loaded.world.profile_marks,undefined,'never inside the world');assert.equal(loaded.observation_digest,'sha256:untouched');
 const quiet=await core.execute({kind:'tick',input:{actions:{}}});
 assert.equal(quiet.profile_marks,undefined,'no new mark, no request');
 state.revision=2;state.marks.push({name:'city.interactive',frame:2,sequence:2});
 const marked=await core.execute({kind:'tick',input:{actions:{}}});
 assert.deepEqual(marked.profile_marks.marks,[{name:'city.interactive',frame:2,sequence:2}]);
 assert.deepEqual(state.requests,[{kind:'marks',after:0},{kind:'marks',after:1}]);
 assert.equal(state.revisionReads,3);
 // A new load is a new runtime: its marks start over.
 state.revision=1;state.marks=[{name:'boot',frame:0,sequence:1}];
 const reloaded=await core.execute({kind:'load',payload:{config:{}}});
 assert.equal(reloaded.profile_marks.marks[0].name,'boot');assert.deepEqual(state.requests.at(-1),{kind:'marks',after:0});
 core.close();
});

test('runtime core rejects a malformed or repeated mark instead of reporting it',async()=>{
 const {module,state}=fakeRuntime();state.revision=1;state.marks=[{name:'boot',frame:-1,sequence:1}];
 const core=createRuntimeCore(module);
 await assert.rejects(core.execute({kind:'load',payload:{config:{}}}),/PROFILE_MARKS_INVALID/);
});

test('a runtime without the marks ABI publishes exactly as before',async()=>{
 const {module}=fakeRuntime();delete module._unone_web_profile_marks_revision;delete module._unone_web_profile_marks_request;
 const core=createRuntimeCore(module);
 assert.equal(Object.hasOwn(await core.execute({kind:'load',payload:{config:{}}}),'profile_marks'),false);
});

test('the worker packet carries marks to the main host unchanged',()=>{
 const value={world:{frame:3,instances3d:{}},profile_marks:{marks:[{name:'city.interactive',frame:3,sequence:2}],dropped:0}};
 const packet=new InstanceTransfer().encode(value,new ArrayBuffer(16));
 assert.deepEqual(new InstanceReceiver().accept(packet).profile_marks,value.profile_marks);
});

test('the main host stamps acceptance and the first completed submission that shows the mark',()=>{
 const done=Object.freeze({status:'completed'}),pending=Object.freeze({status:'skipped',reason:'ui_assets_pending'});
 let clock=100;const m=createPlayerCompletionMetrics({now:()=>clock});
 m.accept({world:{frame:0},profile_marks:{marks:[{name:'boot',frame:0,sequence:1}],dropped:0}},true);
 clock=110;m.finish(pending,done,done,0,clock);
 let rows=m.snapshot().milestones.rows;assert.equal(rows[0].accepted_at_ms,100);assert.equal(rows[0].presented_at_ms,null,'a skipped draw presents nothing');
 clock=120;m.finish(done,done,done,0,clock);
 clock=130;m.accept({world:{frame:1}});m.finish(done,done,done,1,clock);
 clock=140;m.accept({world:{frame:2},profile_marks:{marks:[{name:'city.interactive',frame:2,sequence:2}],dropped:3}});
 clock=150;m.finish(done,done,done,1,clock);
 rows=m.snapshot().milestones.rows;assert.equal(rows[1].presented_at_ms,null,'an older presented frame does not show a newer mark');
 clock=160;m.finish(done,done,done,2,clock);
 const report=m.snapshot().milestones;
 assert.deepEqual(report.rows.map(({name,frame,accepted_at_ms,presented_at_ms,presented_frame})=>({name,frame,accepted_at_ms,presented_at_ms,presented_frame})),[
  {name:'boot',frame:0,accepted_at_ms:100,presented_at_ms:120,presented_frame:0},
  {name:'city.interactive',frame:2,accepted_at_ms:140,presented_at_ms:160,presented_frame:2}]);
 assert.equal(report.engine_dropped,3);assert.equal(report.recorded,2);
 assert.throws(()=>{report.rows[0].presented_at_ms=1;},TypeError);
 m.accept({world:{frame:0}},true);assert.equal(m.snapshot().milestones.recorded,0,'a restart is a new session');
});

test('host milestone storage is bounded',()=>{
 const m=createPlayerCompletionMetrics({now:()=>1});
 m.accept({world:{frame:0},profile_marks:{marks:Array.from({length:300},(_,i)=>({name:'m'+i,frame:0,sequence:i+1})),dropped:0}},true);
 const report=m.snapshot().milestones;assert.equal(report.recorded,256);assert.equal(report.host_dropped,44);
});

test('input latency runs from the earliest input a tick consumed to the first completed submission showing that tick',()=>{
 let clock=100;const m=createPlayerCompletionMetrics({now:()=>clock});const done={status:'completed'};
 m.accept({world:{frame:1}},true);
 assert.equal(m.acceptInput(90,2,93),true,'tick 2 consumed an input from t=90, delivered at 93');
 m.accept({world:{frame:2}});
 clock=110;m.finish(done,done,done,1,clock,'scheduler_raf',clock);
 assert.equal(m.snapshot().input_latency.pending,1,'a submission still showing frame 1 does not count');
 clock=125;m.finish({status:'skipped',reason:'world_assets_pending'},done,done,2,clock,'scheduler_raf',clock);
 assert.equal(m.snapshot().input_latency.presented,0,'a skipped draw does not present the input');
 clock=130;m.finish(done,done,done,2,clock,'scheduler_raf',clock);
 m.acceptInput(140,3);m.acceptInput(150,4);
 clock=170;m.finish(done,done,done,4,clock,'scheduler_raf',clock);
 const r=m.snapshot({windowMs:1000,includeRafSamples:true}).input_latency;
 assert.deepEqual([r.admitted,r.presented,r.pending,r.dropped],[3,3,0,0]);
 assert.deepEqual(r.samples.map(s=>[s.input_at_ms,s.delivered_at_ms,s.tick_frame,s.presented_at_ms,s.latency_ms,s.sequence]),[[90,93,2,130,40,1],[140,null,3,170,30,2],[150,null,4,170,20,3]]);
 assert.deepEqual([r.distribution.retained,r.distribution.max_ms,r.distribution.p50_ms],[3,40,30]);
 assert.equal(m.snapshot().input_latency.samples,undefined,'rows only on request');
 assert.equal(m.acceptInput(Number.NaN,5),false);assert.equal(m.acceptInput(5,-1),false);
 const rows=m.snapshot({windowMs:1000,includeRafSamples:true}).raf_diagnostics.samples;
 assert.deepEqual(rows.map(row=>row.sequence),[1,2,3,4],'draw rows carry their sequence so a reader can stitch windows');
});

test('pending inputs are bounded and a new session forgets them',()=>{
 let clock=0;const m=createPlayerCompletionMetrics({now:()=>clock});m.accept({world:{frame:0}},true);
 for(let i=0;i<300;i++)m.acceptInput(i,i+1);
 let r=m.snapshot().input_latency;assert.deepEqual([r.admitted,r.pending,r.dropped],[256,256,44]);
 m.accept({world:{frame:0}},true);r=m.snapshot().input_latency;
 assert.deepEqual([r.admitted,r.presented,r.pending,r.dropped],[0,0,0,0]);
});

test('the host notes the earliest unconsumed input and the next tick takes it once',()=>{
 const m=createPlayerCompletionMetrics({now:()=>0});
 assert.equal(m.takeInput(),null,'no input, nothing to time');
 m.noteInput(10,11);m.noteInput(12,13);m.noteInput(Number.NaN);
 assert.deepEqual(m.takeInput(),{at:10,delivered:11},'the earliest event since the last tick, with when the page got it');
 assert.equal(m.takeInput(),null,'taken once');
});
