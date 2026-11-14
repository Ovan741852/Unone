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
