import assert from 'node:assert/strict';
import {createGoldSaucerBridge} from '../game/presentation/goldsaucer.mjs';
import {createWagerNoticeController} from '../game/presentation/game-panels.mjs';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const emptyProfile={revision:0,preferences:{bet:1,weapon:'like'},stats:{spent:0},unlockedClipIds:[],watchedLargeClipIds:[],skipSeenLargeVideos:false,
  cards:{drawsAvailable:0,progress:0,drawsEarned:0,totalDraws:0,creditedSpend:0,ignoredSpend:0,counts:{},lastBatch:null}};

async function fixture({alert,preview=false}={}) {
  const actions=new Set(),calls={alert:[],buyIn:0,cashOut:0,insufficient:0},events=new Map();
  const sdk={init:async()=>({}),getUser:async()=>({}),getBalance:async()=>0,
    on(name,callback){const handlers=events.get(name)||new Set();handlers.add(callback);events.set(name,handlers);return()=>handlers.delete(callback);},
    server:{call:async name=>{assert.equal(name,'open');return {result:{session:1,sequence:0,rate:50,balance:0,demoBalance:10000,profiles:{paid:emptyProfile,demo:emptyProfile}},chips:0,...(preview?{preview:true}:{})};}},
    chips:{get:async()=>({chips:0,currency:{perDiamond:50}}),buyIn(){calls.buyIn++;throw Error('Unexpected money operation');},cashOut(){calls.cashOut++;throw Error('Unexpected money operation');},insufficient(){calls.insufficient++;throw Error('Unexpected money operation');}},
  };
  if(alert!==false)sdk.ui={alert:async(message,options)=>{calls.alert.push({message,options});return alert?alert(message,options):true;}};
  const bridge=createGoldSaucerBridge({sdk,setAction(name,down){if(down)actions.add(name);else actions.delete(name);}});
  await bridge.ready;
  const state={reservedWager:0,pendingWin:0,auto:false,platform:{paused:false,requests:[],packetAck:0,packetError:'',cardIds:Array.from({length:14},(_,i)=>`card${i}`),clipIds:['test-classic-large']}};
  const packetId=()=>Array.from({length:31},(_,bit)=>actions.has(`GSPacketIdBit${bit}`)?2**bit:0).reduce((a,b)=>a+b,0);
  state.platform.paused=true;bridge.sync(state);state.platform.packetAck=packetId();state.platform.paused=false;bridge.sync(state);state.platform.packetAck=packetId();bridge.sync(state);
  assert.equal(bridge.metadata().server.profileReady,true);
  return {bridge,state,calls};
}
const attempt=(serial,{auto=false,reason='insufficientFunds',available=0,cost=1,attemptCost=cost}={})=>({auto,
  wagerStatus:{blockReason:reason,attemptReason:reason,attemptSerial:serial,roundCost:cost,availableBalance:available,attemptCost,attemptAvailableBalance:available}});
const tests=[];async function test(name,run){await run();tests.push(name);console.log(`PASS ${name}`);}

await test('new manual insufficient attempt notifies platform once and never buys chips',async()=>{
  const f=await fixture(),promises=[];
  const controller=createWagerNoticeController({onNotice:notice=>promises.push(f.bridge.notifyWagerNotice(notice))});
  for(let frame=0;frame<1000;frame++)controller.sync(attempt(1),f.bridge.metadata());
  await Promise.all(promises);assert.equal(f.calls.alert.length,1);
  assert.deepEqual(f.calls.alert[0].options,{title:'代幣餘額不足',okText:'知道了'});assert.match(f.calls.alert[0].message,/可用 0/);
  controller.sync(attempt(1,{reason:'cooldown'}),f.bridge.metadata());controller.sync(attempt(1),f.bridge.metadata());await flush();
  assert.equal(f.calls.alert.length,1,'a notice reappearing is not another manual attempt');
  controller.sync(attempt(2,{cost:15}),f.bridge.metadata());await flush();assert.equal(f.calls.alert.length,2);
  assert.equal(f.calls.buyIn+f.calls.cashOut+f.calls.insufficient,0);f.bridge.dispose();
});

await test('AUTO, ordinary processing, pressure and waiting credits never open platform modals',async()=>{
  const f=await fixture();let clock=0;
  const controller=createWagerNoticeController({now:()=>clock,onNotice:notice=>{void f.bridge.notifyWagerNotice(notice);}});
  for(const [serial,options]of [[0,{auto:true}],[99,{auto:true}],[100,{reason:'pendingCredits'}],[101,{reason:'settlementBacklog'}],[102,{reason:'flightCapacity'}],[103,{reason:'connecting'}],[104,{reason:'cooldown'}]]){
    controller.sync(attempt(serial,options),f.bridge.metadata());clock+=1000;controller.sync(attempt(serial,options),f.bridge.metadata());
  }
  await flush();assert.equal(f.calls.alert.length,0);assert.equal(f.calls.buyIn+f.calls.cashOut+f.calls.insufficient,0);f.bridge.dispose();
});

await test('missing or unsupported alert API safely leaves the local notice available',async()=>{
  for(const alert of [false,async()=>{throw Object.assign(Error('unsupported'),{code:'unknownMethod'});}]) {
    const f=await fixture({alert});const controller=createWagerNoticeController({onNotice:notice=>{void f.bridge.notifyWagerNotice(notice);}});
    const notice=controller.sync(attempt(1),f.bridge.metadata());assert.equal(notice.code,'insufficientFunds');
    await flush();assert.equal(f.bridge.metadata().server.status,'ready');assert.equal(f.bridge.metadata().platformNoticeBusy,false);
    assert.equal(f.calls.buyIn+f.calls.cashOut+f.calls.insufficient,0);f.bridge.dispose();
  }
});

await test('preview does not show a real-currency insufficiency dialog and disposed bridges ignore notices',async()=>{
  const f=await fixture({preview:true});
  await f.bridge.notifyWagerNotice({code:'insufficientFunds',manualAttempt:true,attemptSerial:1,roundCost:1,availableBalance:0});
  assert.equal(f.calls.alert.length,0);f.bridge.dispose();
  const paid=await fixture();paid.bridge.dispose();await paid.bridge.notifyWagerNotice({code:'insufficientFunds',manualAttempt:true,attemptSerial:1,roundCost:1,availableBalance:0});
  assert.equal(paid.calls.alert.length,0);
});

await test('an open platform notice never accumulates a queue of later modals',async()=>{
  let release;const f=await fixture({alert:()=>new Promise(resolve=>{release=resolve;})});
  const notice={code:'insufficientFunds',manualAttempt:true,attemptSerial:1,roundCost:1,availableBalance:0};
  const first=f.bridge.notifyWagerNotice(notice);assert.equal(f.bridge.metadata().platformNoticeBusy,true);
  await f.bridge.notifyWagerNotice({...notice,attemptSerial:2});assert.equal(f.calls.alert.length,1);
  release(true);await first;await f.bridge.notifyWagerNotice({...notice,attemptSerial:2});assert.equal(f.calls.alert.length,1);
  const third=f.bridge.notifyWagerNotice({...notice,attemptSerial:3});assert.equal(f.calls.alert.length,2);release(true);await third;f.bridge.dispose();
});

await test('manual notice uses the failed attempt cost and rejects an affordable or unclassified notice',async()=>{
  const f=await fixture(),controller=createWagerNoticeController({onNotice:notice=>{void f.bridge.notifyWagerNotice(notice);}});
  controller.sync(attempt(1,{cost:15,attemptCost:6}),f.bridge.metadata());await flush();assert.match(f.calls.alert[0].message,/需要 6/);
  await f.bridge.notifyWagerNotice({code:'insufficientFunds',manualAttempt:true,attemptSerial:2,roundCost:1,availableBalance:61});
  await f.bridge.notifyWagerNotice({code:'insufficientFunds',attemptSerial:3,roundCost:1,availableBalance:0});
  assert.equal(f.calls.alert.length,1);f.bridge.dispose();
});

console.log(`Platform wager notice QA: ${tests.length} checks passed; mock SDK only, no red-diamond or platform operations.`);
