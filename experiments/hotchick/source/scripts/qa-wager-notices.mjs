import assert from 'node:assert/strict';
import fs from 'node:fs';
import {wagerNotice,createWagerNoticeController,updateWagerNotice} from '../game/presentation/game-panels.mjs';

const server={enabled:true,status:'ready',mode:'paid',ready:true,balanceSynchronized:true};
const state=(blockReason,extra={})=>({auto:false,displayBalance:61,wagerStatus:{blockReason,availableBalance:61,roundCost:1,attemptSerial:1,attemptReason:blockReason,...extra}});
const tests=[];
function test(name,run){run();tests.push(name);console.log(`PASS ${name}`);}

test('stale session reports the true connection problem and requires a deliberate reconnect',()=>{
  const notice=wagerNotice(state('connecting'),{server:{...server,status:'error',lastError:'staleSession',balanceSynchronized:false}});
  assert.equal(notice.code,'staleSession');assert.equal(notice.action,'reconnect');assert.equal(notice.actionDisabled,false);
  assert(notice.message.includes('其他分頁'));assert(!notice.message.includes('餘額不足'));
  const refunding=wagerNotice(state('connecting'),{server:{...server,status:'refunding',lastError:'staleSession'}});
  assert.equal(refunding.actionDisabled,true);
});

test('insufficient funds uses the attempted cost while pending credits and backpressure remain distinct',()=>{
  const insufficient=wagerNotice(state('insufficientFunds',{availableBalance:0,roundCost:15}),{server});
  assert.equal(insufficient.code,'insufficientFunds');assert.match(insufficient.message,/可用 0/);assert.match(insufficient.message,/需要 15/);
  assert.equal(insufficient.action,'wallet');
  const pending=wagerNotice(state('pendingCredits',{availableBalance:0,roundCost:15}),{server});
  assert.equal(pending.code,'pendingCredits');assert(!pending.message.includes('餘額不足'));
  const backlog=wagerNotice(state('settlementBacklog'),{server});
  assert.equal(backlog.code,'settlementBacklog');assert(backlog.message.includes('在途回合'));assert(!backlog.message.includes('餘額不足'));
});

test('no silent low-balance warning appears before an attempt and an affordable winner remains clear',()=>{
  assert.equal(wagerNotice(state('insufficientFunds',{attemptSerial:0}),{server}),null);
  assert.equal(wagerNotice({...state(''),pendingWin:500,mediumVideoCount:6},{server}),null);
  assert.equal(wagerNotice(state('cooldown'),{server}),null);
  assert.equal(wagerNotice(state(''),{server:{...server,lastError:'insufficientFunds'}}),null);
});

test('trial insufficiency explains manual reload without a funding or automatic restart action',()=>{
  const notice=wagerNotice(state('insufficientFunds',{availableBalance:0}),{trial:true,source:'standalone',server:{enabled:false}});
  assert.equal(notice.title,'試玩點數不足');assert.equal(notice.action,null);assert.match(notice.message,/可重新整理開始新的試玩/);
  assert(!notice.message.includes('帶入'));assert(!notice.message.includes('補滿'));
  const renderer=fs.readFileSync(new URL('../game/presentation/game-renderer.mjs',import.meta.url),'utf8');
  assert(!renderer.includes('TrialRefill'));assert(!renderer.includes('trial-refill'));
});

test('notice callback boundary deduplicates held attempts and delays brief synchronization messages',()=>{
  let clock=0;const events=[];const controller=createWagerNoticeController({now:()=>clock,onNotice:value=>events.push(value)});
  for(let frame=0;frame<1000;frame++)controller.sync(state('insufficientFunds',{availableBalance:0}),{server});
  assert.equal(events.length,1);assert.equal(events[0].code,'insufficientFunds');
  controller.sync(state('insufficientFunds',{availableBalance:0,attemptSerial:2}),{server});assert.equal(events.length,2);
  controller.sync(state(''),{server});assert.equal(events.at(-1),null);
  const syncing={server:{...server,status:'syncing',walletBusy:true}};
  assert.equal(controller.sync(state('connecting'),syncing),null);clock=899;assert.equal(controller.sync(state('connecting'),syncing),null);
  clock=900;assert.equal(controller.sync(state('connecting'),syncing).code,'walletSync');
});

test('persistent banner avoids repeated DOM mutations and exposes an explicit reconnect button',()=>{
  let mutations=0;const nodes=new Map();
  for(const name of ['.hc-platform-notice-title','.hc-platform-notice-message','button']) {
    const node={dataset:{},hidden:false,disabled:false,_text:''};
    Object.defineProperty(node,'textContent',{get(){return this._text;},set(value){mutations++;this._text=value;}});nodes.set(name,node);
  }
  const element={dataset:{},hidden:true,querySelector:name=>nodes.get(name)};
  const notice=wagerNotice(state('connecting'),{server:{...server,status:'error',lastError:'staleSession'}});
  updateWagerNotice(element,notice);const first=mutations;
  for(let frame=0;frame<1000;frame++)updateWagerNotice(element,{...notice});
  assert.equal(mutations,first);assert.equal(element.dataset.code,'staleSession');assert.equal(element.hidden,false);
  assert.equal(nodes.get('button').dataset.ui,'platform-reconnect');assert.equal(nodes.get('button').textContent,'重新連線');
  updateWagerNotice(element,null);assert.equal(element.hidden,true);
});

test('ordinary synchronization and capacity states are delayed passive indicators while errors retain actions',()=>{
  let clock=0;const controller=createWagerNoticeController({now:()=>clock});
  for(const reason of ['settlementBacklog','pendingCredits','flightCapacity','connecting']) {
    controller.sync(state(''),{server});clock+=1;
    const current=state(reason);assert.equal(controller.sync(current,{server}),null);clock+=899;
    assert.equal(controller.sync(current,{server}),null);clock+=1;
    const notice=controller.sync(current,{server});assert.equal(notice.passive,true);assert.equal(notice.action,null);
    if(reason==='flightCapacity')assert(!notice.message.includes('同步'));
  }
  const insufficient=wagerNotice(state('insufficientFunds',{availableBalance:0}),{server});
  assert.equal(insufficient.passive,false);assert.equal(insufficient.action,'wallet');
  const css=fs.readFileSync(new URL('../game/presentation/game-ui.css',import.meta.url),'utf8');
  assert.match(css,/\.hc-platform-notice\[data-passive="true"\]\s*\{[^}]*pointer-events:none/);
  assert.match(css,/\.hc-platform-notice\[data-passive="true"\]\s*\*\s*\{pointer-events:none!important/);
});

console.log(`Wager notice QA: ${tests.length} checks passed. Host notification is an optional local callback; no undocumented SDK calls.`);
