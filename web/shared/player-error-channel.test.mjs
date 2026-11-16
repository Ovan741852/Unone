import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {PLAYER_ERROR_EVENT,playerErrorDetail,createPlayerErrorChannel,createRecoveryReporter} from './player-errors.mjs';
const failure=()=>new Error(JSON.stringify({kind:'web_error',diagnostic:{code:'SCRIPT_ERROR_LIMIT',explanation:'Game.update failed repeatedly',facts:{last_error:{code:'LUAU_RUNTIME_ERROR',frame:6850,explanation:'runtime error: Transform2D scale must be positive\nstack traceback:\n [string "scripts/presentation.luau"]:91: in function update\n [string "scripts/controller.luau"]:707: in function update',facts:{physical_input:{token:'do-not-export'},save:{gold:999}}}}},physical_input:{private:'never'},save:{secret:'never'}}));
test('terminal Luau envelope becomes a small immutable technical event, without envelope facts/state',()=>{
 const event=playerErrorDetail(failure(),{phase:'runtime',backend:'worker'});assert.equal(event.code,'SCRIPT_ERROR_LIMIT');assert.equal(event.causeCode,'LUAU_RUNTIME_ERROR');assert.equal(event.frame,6850);assert.equal(event.file,'presentation.luau');assert.equal(event.line,91);assert.equal(event.stack,'    at presentation.luau:91\n    at controller.luau:707');assert.equal(event.backend,'worker');assert(Object.isFrozen(event));assert(!/do-not-export|gold|physical_input|secret|save|never/.test(JSON.stringify(event)));
});
test('standalone public channel publishes once, survives observers and resets for a new session',async()=>{
 const target=new EventTarget(),events=[];target.addEventListener(PLAYER_ERROR_EVENT,e=>events.push(e.detail));const channel=createPlayerErrorChannel({target,context:()=>({phase:'runtime',backend:'main'})});
 const got=[];channel.api.subscribe(()=>{throw Error('broken subscriber');});channel.api.subscribe(async()=>{throw Error('async subscriber');});const off=channel.api.subscribe(e=>got.push(e));
 const event=channel.fatal(failure());channel.fatal(failure());assert.equal(events.length,1);assert.equal(got.length,1);assert.equal(channel.api.last(),event);await new Promise(r=>setImmediate(r));off();channel.reset();assert.equal(channel.api.last(),null);channel.fatal(Error('second session'));assert.equal(events.length,2);assert.equal(got.length,1);channel.dispose();assert.equal(target.unonePlayerErrors,undefined);assert.equal(channel.fatal(Error('closed')),null);
});
test('nonterminal recoveries retain engine recovery policy and are throttled before host publication',()=>{
 const channel=createPlayerErrorChannel({target:new EventTarget()}),got=[];channel.api.subscribe(e=>got.push(e));const reporter=createRecoveryReporter({doc:null,log:{warn(){}},now:()=>0,onError:r=>channel.recovered(r),target:{dataset:{}}});
 for(let n=1;n<60;n++)reporter.accept({recovered_errors:{ui_rejections:0,script_errors:n,consecutive_script_errors:n,last_script_error:{frame:n,code:'LUAU_RUNTIME_ERROR',message:'nil access'}}});
 assert.equal(got.length,1);assert.equal(got[0].fatal,false);channel.fatal(failure());assert.equal(got.length,2);assert.equal(got[1].fatal,true);reporter.dispose();channel.dispose();
});
test('bounds, redaction, JS source positions and hostile thrown values do not break reporting',()=>{
 const error=new TypeError('token=private-token https://private.example/secret userId=hidden alice@example.com');error.stack='TypeError\n    at fail (https://example.test/game.js:25:8)';let event=playerErrorDetail(error);assert.equal(event.file,'game.js');assert.equal(event.line,25);assert(!/private-token|example.com|hidden|https:/.test(event.message));
 const hostile=new Proxy({},{get(){throw Error('getter');}});assert.doesNotThrow(()=>playerErrorDetail(hostile));event=playerErrorDetail('x'.repeat(100000));assert(event.message.length<=512);assert(JSON.stringify(event).length<4096);
});
test('actual official player fail emits before cleanup, and any cleanup failure cannot erase the event',()=>{
 const source=fs.readFileSync(new URL('../player/main.js',import.meta.url),'utf8');const fail=source.split('\n').find(l=>l.startsWith('function fail(error){'));const channel=createPlayerErrorChannel({target:new EventTarget()}),got=[];channel.api.subscribe(e=>got.push(e));const context={errors:channel,profiler:{publish(){throw Error('cleanup failure');}}};vm.runInNewContext(fail+';globalThis.fail=fail;',context);assert.throws(()=>context.fail(failure()),/cleanup failure/);assert.equal(got.length,1);assert.equal(got[0].code,'SCRIPT_ERROR_LIMIT');
 assert(source.includes('onError:record=>errors.recovered(record)'));assert(source.includes('playerPhase=\'runtime\';scheduler.start()'));
});
