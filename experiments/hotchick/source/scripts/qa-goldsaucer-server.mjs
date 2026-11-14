import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createGoldSaucerServer} from '../game/presentation/goldsaucer-server.mjs';

// Exercise the production server functions behind a mock SDK. The packet receiver
// here checks browser transport; the separate native suite checks Luau validation.
const source = fs.readFileSync(new URL('../server/goldsaucer/functions.js', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const cost = round => round.bet * ({like:1,flower:6,rocket:15}[round.weapon]);
const cardIds = ['eunbi-n-01','eunbi-n-02','eunbi-r-01','eunbi-r-02','eunbi-sr-01',
  'yeseul-n-01','yeseul-r-01','yeseul-sr-01','jiayi-n-01','jiayi-r-01','jiayi-sr-01','jiayi-sr-02','mugi-n-01','mugi-n-02'];
const clipIds = Object.entries({eunbi:['classic','summer'],yeseul:['classic','halloween','summer'],
  jiayi:['classic','christmas'],mugi:['classic','christmas'],original:['classic']})
  .flatMap(([character, styles]) => styles.flatMap(style => ['small','medium','large'].map(tier => `${character}-${style}-${tier}`)));
const flush = () => new Promise(resolve => setImmediate(resolve));

function platform({preview = true, chips = 0, rng = 'min'} = {}) {
  let functions;
  vm.runInNewContext(source, {defineFunctions: value => { functions = value; }});
  const ledger = {chips, state:null, calls:[], debits:0, credits:0, rngCalls:0, get:0, buyIn:0, cashOut:0,
    active:0,maxActive:0, hook:null, transform:null,deferEchoes:false,echoes:[],shared:null};
  const events = new Map();
  const context = () => ({player:{id:'transport-fixture',username:'transport',displayName:'Transport QA'}, chips:ledger.chips,shared:clone(ledger.shared),
    currency:{name:'心動幣',perDiamond:50}, randomInt(min,max) { ledger.rngCalls++;
      if(rng==='largeMax'&&min===100&&max===240)return 240;
      if(rng==='special'&&min===1&&max<=4)return Math.floor(max/2)+1;
      return rng === 'max' ? max : min; }});
  ledger.state = clone(functions.init(context()));
  const sdk = {
    server:{async call(method,input) {
      ledger.calls.push({method,input:clone(input)});
      ledger.active++; ledger.maxActive=Math.max(ledger.maxActive,ledger.active);
      try {
        if(ledger.hook) await ledger.hook('before',method,input);
        const reply=clone(functions[method](clone(ledger.state),clone(input),context()));
        ledger.state=reply.state;
        if(Object.hasOwn(reply,'shared'))ledger.shared=clone(reply.shared);
        ledger.chips += reply.chips.win-reply.chips.bet;
        ledger.debits += reply.chips.bet; ledger.credits += reply.chips.win;
        const outer={result:reply.result,chips:ledger.chips,...(preview?{preview:true}:{})};
        const echo={chips:ledger.chips};
        if(ledger.deferEchoes)ledger.echoes.push(echo);
        else for(const handler of events.get('chipsChanged')||[]) handler(echo);
        if(ledger.hook) await ledger.hook('after',method,input);
        return ledger.transform?ledger.transform(outer,method):outer;
      } finally { ledger.active--; }
    }},
    chips:{
      async get() { ledger.get++; return {currency:{name:'心動幣',perDiamond:50},chips:ledger.chips}; },
      async buyIn() { ledger.buyIn++; return {ok:false}; },
      async cashOut() { ledger.cashOut++; return {ok:false}; },
    },
    on(event,handler) { const handlers=events.get(event)||new Set();handlers.add(handler);events.set(event,handlers);return()=>handlers.delete(handler); },
  };
  return {sdk,ledger,emit(event,payload) { for(const handler of events.get(event)||[])handler(payload); },
    deliverEcho(index=0) {const [echo]=ledger.echoes.splice(index,1);if(echo)for(const handler of events.get('chipsChanged')||[])handler(echo);}};
}

function harness(fake = platform(), {clientId='transport-page'} = {}) {
  let clock=0;
  const actions=new Set(), actionLog=[], packets=[];
  const state={balance:0,displayBalance:0,reservedWager:0,pendingWin:0,cards:{},platform:{
    enabled:true,ready:false,profileReady:false,paused:false,serverBalance:0,packetAck:0,packetError:'',
    requests:[],cardIds,clipIds,cardDrawRequest:0,cardDrawPending:false,progressRevision:0,
    progress:{watchedLargeClipIds:[],skipSeenLargeVideos:false,bet:10,weapon:'like'},
  }};
  const broker=createGoldSaucerServer({sdk:fake.sdk,clientId,now:()=>clock,setAction(name,down) {
    actionLog.push([name,down]); if(down)actions.add(name);else actions.delete(name);
  }});
  function read(name,width) { let value=0;for(let bit=0;bit<width;bit++)if(actions.has(`${name}Bit${bit}`))value+=2**bit;return value; }
  function receive() {
    state.platform.connecting=actions.has('GSConnecting');
    if(!actions.has('GSReady'))return false;
    const id=read('GSPacketId',31);
    if(id<=state.platform.packetAck)return false;
    const packet={id,kind:read('GSKind',3),roundId:read('GSRound',31),balance:read('GSBalance',40),mode:read('GSMode',1)};
    packets.push(packet);
    if(packet.kind===0||packet.kind===3) {
      if(packet.kind===3){assert.equal(state.reservedWager,0,'wallet receipt while reserved');assert.equal(state.platform.requests.length,0,'wallet receipt with pending rounds');}
      state.balance=packet.balance; state.displayBalance=packet.balance-state.pendingWin;
    } else if(packet.kind===1||packet.kind===2) {
      const round=state.platform.requests.shift();assert.equal(round?.roundId,packet.roundId);
      state.reservedWager-=cost(round);
      packet.win=Array.from({length:6},(_,index)=>read(`GSWin${index}`,20)).reduce((a,b)=>a+b,0);
      packet.styles=Array.from({length:6},(_,index)=>read(`GSStyle${index}`,2));
      packet.multipliers=Array.from({length:6},(_,index)=>read(`GSMult${index}`,8));
      packet.activeMask=actions.has('GSActiveMaskPresent')?read('GSActiveMask',6):null;
      state.balance=packet.balance-state.reservedWager;
      state.pendingWin+=packet.win; state.displayBalance=state.balance-state.pendingWin;
    } else if(packet.kind===4) {
      packet.profileRevision=read('GSProfileRevision',31); packet.drawAck=read('GSDrawAck',31);
      packet.progressAck=read('GSProgressAck',31);
      packet.counts=Object.fromEntries(cardIds.map((id,index)=>[id,read(`GSCard${index}`,32)]));
      packet.batchSize=read('GSBatchSize',4);packet.batchSerial=read('GSBatchSerial',31);
      packet.batchItems=Array.from({length:packet.batchSize},(_,index)=>({
        cardId:cardIds[read(`GSBatchCard${index}`,4)-1],count:read(`GSBatchOwned${index}`,32),isNew:Boolean(read(`GSBatchNew${index}`,1)),
      }));
      packet.spent=read('GSProfileSpent',40);packet.packs=read('GSPacks',14);packet.progress=read('GSProgress',10);
      state.cards={counts:packet.counts,drawsAvailable:packet.packs,progress:packet.progress,totalDraws:read('GSUsed',32)};
      if(packet.progressAck>=state.platform.progressRevision) {
        state.platform.progress.bet=[1,5,10,20,50][read('GSBet',3)-1];
        state.platform.progress.weapon=['like','flower','rocket'][read('GSWeapon',2)];
        state.platform.progress.skipSeenLargeVideos=Boolean(read('GSSkip',1));
      }
      const watched=read('GSWatched',32);
      state.platform.progress.watchedLargeClipIds=[...new Set([...state.platform.progress.watchedLargeClipIds,
        ...clipIds.filter((_,index)=>Math.floor(watched/2**index)%2===1)])];
      if(packet.drawAck>=state.platform.cardDrawRequest)state.platform.cardDrawPending=false;
      state.platform.profileReady=true;state.platform.ready=true;
    }
    state.platform.serverBalance=packet.balance;
    state.platform.packetAck=id;
    return true;
  }
  function sync() {broker.sync(clone(state));}
  return {fake,broker,state,actions,actionLog,packets,read,sync,receive,
    now:()=>clock, advance(ms){clock+=ms;},
    async step(ms=100) {clock+=ms;sync();receive();sync();await flush();},
    async run(count=30,ms=100) {for(let i=0;i<count;i++)await this.step(ms);},
    async boot() {sync();await broker.start();await this.run(5);assert.equal(broker.metadata().ready,true);},
    enqueue(round) {state.platform.requests.push(clone(round));state.reservedWager+=cost(round);state.balance-=cost(round);state.displayBalance-=cost(round);},
    collect() {state.displayBalance+=state.pendingWin;state.pendingWin=0;},
  };
}

const round=(id,{weapon='like',bet=10,tier='small',characterId='original',count=1}={})=>({roundId:id,weapon,bet,
  targets:Array.from({length:count},(_,index)=>({id:`girl-${id}-${index}`,tier,characterId}))});
const tests=[];
async function test(name,run) {await run();tests.push(name);console.log(`PASS ${name}`);}

await test('missing server API preserves local play and never emits remote keys',async()=>{
  const actions=[];const broker=createGoldSaucerServer({sdk:{},setAction:(...args)=>actions.push(args)});
  await broker.start();broker.sync({});assert.equal(broker.metadata().enabled,false);assert.deepEqual(actions,[]);broker.dispose();
});

await test('bootstrap blocks shooting until both financial and profile packets are acknowledged',async()=>{
  const h=harness();h.sync();await h.broker.start();
  assert(h.actions.has('GSConnecting'));assert.equal(h.broker.metadata().ready,false);
  const held=h.actionLog.length;for(let i=0;i<20;i++)h.sync();assert.equal(h.actionLog.length,held);
  h.receive();h.sync();assert(h.actions.has('GSConnecting'));assert.equal(h.read('GSKind',3),4);
  h.receive();h.sync();assert.equal(h.broker.metadata().mode,'demo');assert.equal(h.state.balance,10000);
  assert.equal(h.broker.metadata().ready,true);assert.equal(h.fake.ledger.chips,0);assert.equal(h.fake.ledger.buyIn,0);
  h.broker.dispose();assert.equal(h.actions.size,0);
});

await test('batch receipts preserve intermediate balances, bounded calls and no automatic real-money actions',async()=>{
  const h=harness();await h.boot();for(let id=1;id<=12;id++)h.enqueue(round(id));
  await h.run(55);
  const calls=h.fake.ledger.calls.filter(call=>call.method==='settle');
  assert.deepEqual(calls.map(call=>call.input.rounds.length),[10,2]);assert.equal(h.fake.ledger.maxActive,1);
  assert.deepEqual(h.packets.filter(packet=>packet.kind===1).map(packet=>packet.balance),Array.from({length:12},(_,i)=>10000+(i+1)*10));
  assert.equal(h.state.reservedWager,0);assert.equal(h.state.cards.progress,120);
  assert.equal(h.fake.ledger.debits,0);assert.equal(h.fake.ledger.credits,0);assert.equal(h.fake.ledger.buyIn,0);assert.equal(h.fake.ledger.cashOut,0);
  h.broker.dispose();
});

await test('lost response retries the identical intent and the server ledger charges exactly once',async()=>{
  const fake=platform({preview:false,chips:10000});let lost=false;
  fake.ledger.hook=async(phase,method)=>{if(phase==='after'&&method==='settle'&&!lost){lost=true;throw new Error('network-timeout');}};
  const h=harness(fake);await h.boot();h.enqueue(round(1));await h.run(35);
  const calls=fake.ledger.calls.filter(call=>call.method==='settle');assert.equal(calls.length,2);
  assert.deepEqual(calls[0].input,calls[1].input);assert.equal(fake.ledger.debits,10);assert.equal(fake.ledger.credits,20);
  assert.equal(h.packets.filter(packet=>packet.kind===1).length,1);assert.equal(h.state.balance,10010);
  h.broker.dispose();
});

await test('single-flight transport waits at least 500ms before the next server call',async()=>{
  const h=harness();await h.boot();h.enqueue(round(1));h.advance(1);h.sync();await flush();
  await h.run(5,1);h.enqueue(round(2));await h.run(100,1);
  assert.equal(h.fake.ledger.calls.filter(call=>call.method==='settle').length,1);
  await h.run(40,20);assert.equal(h.fake.ledger.calls.filter(call=>call.method==='settle').length,2);h.broker.dispose();
});

await test('known insufficient funds refund reservations and reconcile paid zero without a fake top-up',async()=>{
  const fake=platform({preview:false,chips:100});const h=harness(fake);await h.boot();
  h.enqueue(round(1));h.enqueue(round(2));fake.ledger.chips=0;await h.run(25);
  assert.equal(h.packets.filter(packet=>packet.kind===2).length,2);assert.equal(h.state.reservedWager,0);
  assert.equal(h.state.balance,0);assert.equal(fake.ledger.debits,0);assert.equal(fake.ledger.buyIn,0);
  assert.equal(h.broker.metadata().ready,true);h.broker.dispose();
});

await test('malformed financial response halts instead of rerolling or mutating native wallet',async()=>{
  const fake=platform();const h=harness(fake);await h.boot();
  fake.ledger.transform=(outer,method)=>{if(method==='settle')outer.result.balance++;return outer;};
  h.enqueue(round(1));await h.run(15);assert.equal(h.broker.metadata().status,'error');
  assert.equal(h.broker.metadata().lastError,'settlement-total-mismatch');assert(h.actions.has('GSConnecting'));
  assert.equal(h.packets.filter(packet=>packet.kind===1).length,0);assert.equal(h.state.reservedWager,10);h.broker.dispose();
});

await test('native packet rejection clears packet keys and blocks further bets',async()=>{
  const h=harness();h.sync();await h.broker.start();h.state.platform.packetAck=h.read('GSPacketId',31);
  h.state.platform.packetError='receipt-invalid';h.sync();assert.equal(h.broker.metadata().status,'error');
  assert.deepEqual([...h.actions],['GSConnecting']);h.broker.dispose();
});

await test('a malformed profile after a financial receipt cannot reopen betting',async()=>{
  const fake=platform();const h=harness(fake);await h.boot();
  fake.ledger.transform=(outer,method)=>{if(method==='settle')outer.result.profile.preferences.bet=999;return outer;};
  h.enqueue(round(1));await h.run(20);assert.equal(h.packets.filter(packet=>packet.kind===1).length,1);
  assert.equal(h.broker.metadata().status,'error');assert.equal(h.broker.metadata().lastError,'profile-preference-invalid');
  assert(h.actions.has('GSConnecting'));assert(!h.actions.has('GSReady'));h.broker.dispose();
});

await test('financial transport completes during platform pause while visual winnings remain pending',async()=>{
  const h=harness();await h.boot();h.state.platform.paused=true;h.enqueue(round(1));await h.run(20);
  assert.equal(h.packets.filter(packet=>packet.kind===1).length,1);assert.equal(h.state.pendingWin,20);
  assert.equal(h.state.displayBalance,9990);h.broker.dispose();
});

await test('server styles and persisted card profiles are encoded without local cosmetic or card draws',async()=>{
  const h=harness(platform({rng:'special'}));await h.boot();h.enqueue(round(1,{weapon:'rocket',bet:50,tier:'large',characterId:'yeseul'}));
  h.enqueue(round(2,{weapon:'rocket',bet:50}));await h.run(20);
  assert.equal(h.state.cards.drawsAvailable,1);assert.equal(h.state.cards.progress,500);
  h.collect();h.state.platform.cardDrawRequest=1;h.state.platform.cardDrawPending=true;await h.run(20);
  assert.equal(h.fake.ledger.calls.filter(call=>call.method==='drawCards').length,1);
  assert.equal(h.state.platform.cardDrawPending,false);assert.equal(h.state.cards.totalDraws,1);
  assert.equal(h.state.cards.counts['eunbi-n-01'],1);assert.equal(h.packets.at(-1).batchSize,1);
  assert.equal(h.packets.find(packet=>packet.kind===1).styles[0],2);
  assert.equal(h.fake.ledger.chips,0);h.broker.dispose();
});

await test('large multiplier240 and a180000 award survive the8bit multiplier packet without truncation',async()=>{
  const h=harness(platform({rng:'largeMax'}));await h.boot();
  h.enqueue(round(1,{weapon:'rocket',bet:50,tier:'large'}));await h.run(20);
  const receipt=h.packets.find(packet=>packet.kind===1);
  assert.equal(receipt.multipliers[0],240);assert.equal(receipt.win,180000);
  assert.equal(h.state.balance,189250);assert.equal(h.state.pendingWin,180000);assert.equal(h.state.reservedWager,0);
  assert.equal(h.broker.metadata().status,'ready');h.broker.dispose();
});

await test('draw retry remains idempotent and a no-packs response clears the native request safely',async()=>{
  const fake=platform();const h=harness(fake);await h.boot();
  h.enqueue(round(1,{weapon:'rocket',bet:50}));h.enqueue(round(2,{weapon:'rocket',bet:50}));await h.run(20);h.collect();
  let lost=false;fake.ledger.hook=async(phase,method)=>{if(phase==='after'&&method==='drawCards'&&!lost){lost=true;throw new Error('timeout');}};
  h.state.platform.cardDrawRequest=1;h.state.platform.cardDrawPending=true;await h.run(30);
  assert.equal(h.state.cards.totalDraws,1);assert.equal(fake.ledger.calls.filter(call=>call.method==='drawCards').length,2);
  h.state.platform.cardDrawRequest=2;h.state.platform.cardDrawPending=true;await h.run(20);
  assert.equal(h.state.platform.cardDrawPending,false);assert.equal(h.state.cards.totalDraws,1);h.broker.dispose();
});

await test('all ten accumulated packs draw together and their card counts rehydrate on a new page',async()=>{
  const fake=platform();const profile=fake.ledger.state.profiles.demo;
  profile.stats.spent=10000;profile.cards.drawsAvailable=10;profile.cards.drawsEarned=10;profile.cards.creditedSpend=10000;
  const h=harness(fake);await h.boot();assert.equal(h.state.cards.drawsAvailable,10);
  h.state.platform.cardDrawRequest=1;h.state.platform.cardDrawPending=true;await h.run(20);
  assert.equal(h.packets.at(-1).batchSize,10);assert.equal(h.state.cards.counts['eunbi-n-01'],10);
  assert.deepEqual(h.packets.at(-1).batchItems.map(item=>item.count),[1,2,3,4,5,6,7,8,9,10]);
  assert.deepEqual(h.packets.at(-1).batchItems.map(item=>item.isNew),[true,false,false,false,false,false,false,false,false,false]);
  h.broker.dispose();const next=harness(fake,{clientId:'page-after-ten-packs'});await next.boot();
  assert.equal(next.state.cards.totalDraws,10);assert.equal(next.state.cards.counts['eunbi-n-01'],10);
  assert.equal(next.state.cards.drawsAvailable,0);assert.equal(next.packets.at(-1).batchSize,10);next.broker.dispose();
});

await test('fourteen-bit stock9999 survives two ten-pack draws and a new page without an automatic draw',async()=>{
  const fake=platform(),profile=fake.ledger.state.profiles.demo;
  profile.stats.spent=9999000;profile.cards.drawsAvailable=9999;profile.cards.drawsEarned=9999;profile.cards.creditedSpend=9999000;
  const h=harness(fake);await h.boot();assert.equal(h.state.cards.drawsAvailable,9999);assert.equal(h.packets.at(-1).packs,9999);
  h.state.platform.cardDrawRequest=1;h.state.platform.cardDrawPending=true;await h.run(25);
  assert.equal(h.state.cards.drawsAvailable,9989);assert.equal(h.state.cards.totalDraws,10);assert.equal(h.packets.at(-1).batchSize,10);
  await h.run(25);assert.equal(fake.ledger.calls.filter(call=>call.method==='drawCards').length,1);
  h.state.platform.cardDrawRequest=2;h.state.platform.cardDrawPending=true;await h.run(25);
  assert.equal(h.state.cards.drawsAvailable,9979);assert.equal(h.state.cards.totalDraws,20);assert.equal(h.packets.at(-1).batchSize,10);
  h.broker.dispose();const next=harness(fake,{clientId:'after-9999-stock'});await next.boot();
  assert.equal(next.state.cards.drawsAvailable,9979);assert.equal(next.state.cards.totalDraws,20);assert.equal(next.packets.at(-1).packs,9979);
  next.broker.dispose();
});

await test('eleven stored packs open ten then one and keep the remaining pack until another explicit request',async()=>{
  const fake=platform(),profile=fake.ledger.state.profiles.demo;
  profile.stats.spent=11000;profile.cards.drawsAvailable=11;profile.cards.drawsEarned=11;profile.cards.creditedSpend=11000;
  const h=harness(fake);await h.boot();h.state.platform.cardDrawRequest=1;h.state.platform.cardDrawPending=true;await h.run(25);
  assert.equal(h.state.cards.drawsAvailable,1);assert.equal(h.state.cards.totalDraws,10);assert.equal(h.packets.at(-1).batchSize,10);
  await h.run(25);assert.equal(h.state.cards.drawsAvailable,1);assert.equal(fake.ledger.calls.filter(call=>call.method==='drawCards').length,1);
  h.state.platform.cardDrawRequest=2;h.state.platform.cardDrawPending=true;await h.run(25);
  assert.equal(h.state.cards.drawsAvailable,0);assert.equal(h.state.cards.totalDraws,11);assert.equal(h.packets.at(-1).batchSize,1);
  assert.equal(fake.ledger.rngCalls,22);h.broker.dispose();
});

await test('preferences and watched films save only on changes, debounce, and survive a new page',async()=>{
  const fake=platform({rng:'special'});const h=harness(fake);await h.boot();await h.run(20);
  assert.equal(fake.ledger.calls.filter(call=>call.method==='saveProgress').length,0);
  h.enqueue(round(1,{tier:'large',characterId:'yeseul',bet:20}));await h.run(15);h.collect();
  h.state.platform.progress={watchedLargeClipIds:['yeseul-halloween-large'],skipSeenLargeVideos:true,bet:20,weapon:'flower'};
  h.state.platform.progressRevision=1;await h.run(5);
  assert.equal(fake.ledger.calls.filter(call=>call.method==='saveProgress').length,0);await h.run(20);
  assert.equal(fake.ledger.calls.filter(call=>call.method==='saveProgress').length,1);
  const balance=h.state.balance;h.broker.dispose();const next=harness(fake,{clientId:'new-page'});await next.boot();
  assert.equal(next.state.balance,balance);assert.equal(next.state.platform.progress.bet,20);
  assert.equal(next.state.platform.progress.weapon,'flower');assert.equal(next.state.platform.progress.skipSeenLargeVideos,true);
  assert.deepEqual(next.state.platform.progress.watchedLargeClipIds,['yeseul-halloween-large']);
  assert.equal(next.packets.at(-1).spent,20);await next.run(20);
  assert.equal(fake.ledger.calls.filter(call=>call.method==='saveProgress').length,1);next.broker.dispose();
});

await test('wallet methods require explicit calls and wait for reservations and visual winnings',async()=>{
  const fake=platform({preview:false,chips:10000});const h=harness(fake);await h.boot();
  assert.equal(fake.ledger.buyIn,0);const buying=h.broker.buyIn();await h.step();await buying;assert.equal(fake.ledger.buyIn,1);await h.run(5);
  h.enqueue(round(1));h.sync();assert.equal((await h.broker.cashOut()).reason,'wallet-busy');await h.run(15);
  assert.equal((await h.broker.cashOut()).reason,'wallet-busy');assert.equal(fake.ledger.cashOut,0);
  h.collect();await h.run(5);const selling=h.broker.cashOut();await h.step();await selling;assert.equal(fake.ledger.cashOut,1);h.broker.dispose();
  const preview=harness();await preview.boot();assert.equal((await preview.broker.buyIn()).ok,false);
  assert.equal(preview.fake.ledger.buyIn,0);preview.broker.dispose();
});

await test('wallet confirmation waits for native fire gate and cancels a same-frame reservation race',async()=>{
  const fake=platform({preview:false,chips:100});const h=harness(fake);await h.boot();
  const selling=h.broker.cashOut();assert.equal(fake.ledger.cashOut,0);h.enqueue(round(1));
  await h.step();assert.equal((await selling).reason,'wallet-busy');assert.equal(fake.ledger.cashOut,0);
  await h.run(20);assert.equal(h.state.reservedWager,0);h.broker.dispose();
  const zero=harness(platform({preview:false,chips:0}));await zero.boot();assert.equal(zero.state.balance,0);
  assert.equal(zero.broker.metadata().canUseWallet,true);assert.equal(zero.fake.ledger.buyIn,0);zero.broker.dispose();
});

await test('a second page expires the old session, refunds its queued rounds and never auto-opens a new one',async()=>{
  const fake=platform({preview:false,chips:61});const first=harness(fake,{clientId:'first-page'});await first.boot();
  fake.ledger.chips=116;const second=harness(fake,{clientId:'second-page'});await second.boot();
  for(let id=1;id<=12;id++)first.enqueue(round(id,{bet:1}));await first.run(45);
  assert.equal(first.broker.metadata().status,'error');assert.equal(first.broker.metadata().lastError,'staleSession');
  assert.equal(first.broker.metadata().balanceSynchronized,false);assert.equal(first.state.reservedWager,0);
  assert.equal(first.packets.filter(packet=>packet.kind===2).length,12);assert.equal(fake.ledger.debits,0);assert.equal(fake.ledger.chips,116);
  const calls=fake.ledger.calls.length;await first.run(50);assert.equal(fake.ledger.calls.length,calls);
  assert.equal(fake.ledger.calls.filter(call=>call.method==='open').length,2);assert(first.actions.has('GSConnecting'));
  first.broker.dispose();second.broker.dispose();
});

await test('wallet refresh waits for connecting ACK and cancels safely if a reservation raced it',async()=>{
  const fake=platform({preview:false,chips:100,rng:'max'});const h=harness(fake);await h.boot();
  fake.ledger.chips=200;fake.emit('chipsChanged',{chips:200});h.sync();assert(h.actions.has('GSConnecting'));assert.equal(fake.ledger.get,0);
  h.enqueue(round(1,{bet:1}));await h.step();assert.equal(fake.ledger.get,0);
  await h.run(30);assert.equal(h.state.balance,199);assert.equal(h.state.reservedWager,0);assert.equal(h.broker.metadata().ready,true);
  assert.equal(h.broker.metadata().lastError,null);h.broker.dispose();
});

await test('a delayed wallet read cannot overwrite a late round and is refreshed after that round drains',async()=>{
  const fake=platform({preview:false,chips:100,rng:'max'});const h=harness(fake);await h.boot();
  const get=fake.sdk.chips.get;let resolveRead;
  fake.sdk.chips.get=async()=>{fake.ledger.get++;return new Promise(resolve=>{resolveRead=resolve;});};
  fake.ledger.chips=200;fake.emit('chipsChanged',{chips:200});await h.step();assert.equal(fake.ledger.get,1);
  h.enqueue(round(1,{bet:1}));h.sync();resolveRead({currency:{name:'心動幣',perDiamond:50},chips:200});
  await flush();fake.sdk.chips.get=get;
  assert.equal(h.packets.filter(packet=>packet.kind===3).length,0);
  await h.run(35);assert.equal(h.state.balance,199);assert.equal(h.state.platform.serverBalance,199);
  assert.equal(h.broker.metadata().ready,true);assert.equal(h.broker.metadata().lastError,null);h.broker.dispose();
});

await test('winning hearts and their own balance events do not block further affordable rounds',async()=>{
  const fake=platform({preview:false,chips:100});const h=harness(fake);await h.boot();
  h.enqueue(round(1,{bet:1}));await h.run(15);assert.equal(h.state.pendingWin,2);assert.equal(fake.ledger.get,0);
  h.enqueue(round(2,{bet:1}));await h.run(15);assert.equal(h.state.pendingWin,4);assert.equal(fake.ledger.debits,2);
  h.collect();h.sync();assert(!h.actions.has('GSConnecting'));h.enqueue(round(3,{bet:1}));await h.step();
  await h.run(20);assert.equal(fake.ledger.debits,3);assert.equal(h.state.pendingWin,2);
  h.collect();await h.run(20);assert.equal(h.broker.metadata().ready,true);assert.equal(h.state.balance,103);
  h.enqueue(round(4,{bet:1}));await h.run(15);assert.equal(fake.ledger.debits,4);assert.equal(h.broker.metadata().status,'ready');
  assert.equal(fake.ledger.get,0);
  h.broker.dispose();
});

await test('late own echoes across later settlements produce no wallet reads or shooting gates',async()=>{
  const fake=platform({preview:false,chips:100});fake.ledger.deferEchoes=true;const h=harness(fake);await h.boot();
  const logStart=h.actionLog.length;
  for(let id=1;id<=8;id++){h.enqueue(round(id,{bet:1}));await h.run(6);h.collect();}
  assert.equal(fake.ledger.echoes.length,9);
  while(fake.ledger.echoes.length)fake.deliverEcho(fake.ledger.echoes.length-1);
  await h.run(10);assert.equal(fake.ledger.get,0);
  assert.equal(h.actionLog.slice(logStart).filter(([key,down])=>key==='GSConnecting'&&down).length,0);
  assert.equal(h.state.balance,108);assert.equal(h.broker.metadata().walletRefreshPending,false);h.broker.dispose();
});

await test('external changes inside a settlement survive both early and late own echoes',async()=>{
  for(const deferEchoes of [false,true]) {
    const fake=platform({preview:false,chips:100});const h=harness(fake);await h.boot();fake.ledger.deferEchoes=deferEchoes;
    let changed=false;fake.ledger.hook=async(phase,method)=>{
      if(phase==='after'&&method==='settle'&&!changed){changed=true;fake.ledger.chips+=100;fake.emit('chipsChanged',{chips:fake.ledger.chips});}
    };
    h.enqueue(round(1,{bet:1}));await h.run(10);h.collect();
    if(deferEchoes)while(fake.ledger.echoes.length)fake.deliverEcho();
    await h.run(20);assert.equal(h.state.balance,201);assert.equal(fake.ledger.get,1);
    assert.equal(h.broker.metadata().ready,true);h.broker.dispose();
  }
});

await test('an external withdrawal matching an old expected echo is not lost when that echo arrives',async()=>{
  const fake=platform({preview:false,chips:100});const h=harness(fake);await h.boot();fake.ledger.deferEchoes=true;
  h.enqueue(round(1,{bet:1}));await h.run(8);h.collect();
  h.enqueue(round(2,{bet:1}));await h.run(8);h.collect();assert.equal(h.state.balance,102);
  fake.ledger.chips=101;fake.emit('chipsChanged',{chips:101});
  while(fake.ledger.echoes.length)fake.deliverEcho();
  await h.run(20);assert.equal(h.state.balance,101);assert.equal(fake.ledger.get,1);h.broker.dispose();
});

await test('external funds before server execution reconcile without invalidating a valid round',async()=>{
  const fake=platform({preview:false,chips:100});const h=harness(fake);await h.boot();let changed=false;
  fake.ledger.hook=async(phase,method)=>{if(phase==='before'&&method==='settle'&&!changed){changed=true;fake.ledger.chips+=100;fake.emit('chipsChanged',{chips:200});}};
  h.enqueue(round(1,{bet:1}));await h.run(10);h.collect();await h.run(20);
  assert.equal(h.state.balance,201);assert.equal(fake.ledger.debits,1);assert.equal(fake.ledger.get,1);
  assert.equal(h.broker.metadata().lastError,null);h.broker.dispose();
});

await test('forty winning rounds with a delayed SDK keep processing without self-induced wallet gates',async()=>{
  const fake=platform({preview:false,chips:1000});const h=harness(fake);await h.boot();const logStart=h.actionLog.length;
  let release=null;fake.ledger.hook=async(phase,method)=>{if(phase==='before'&&method==='settle')await new Promise(resolve=>{release=resolve;});};
  for(let base=1;base<=40;base+=8){
    for(let id=base;id<base+8;id++)h.enqueue(round(id,{bet:1}));
    await h.step();await h.run(8);assert.equal(fake.ledger.active,1);assert(!h.actions.has('GSConnecting'));
    release();await flush();await h.run(22);h.collect();
  }
  await h.run(10);assert.equal(fake.ledger.debits,40);assert.equal(h.state.balance,1040);assert.equal(fake.ledger.get,0);
  assert.equal(h.actionLog.slice(logStart).filter(([key,down])=>key==='GSConnecting'&&down).length,0);
  assert.equal(fake.ledger.maxActive,1);h.broker.dispose();
});

await test('focus recovery reasserts packet bits and disposal ignores delayed server responses',async()=>{
  const h=harness();h.sync();await h.broker.start();const before=[...h.actions];h.actions.clear();h.broker.reassert();
  assert.deepEqual([...h.actions],before);h.broker.dispose();assert.equal(h.actions.size,0);
  const fake=platform();let release;fake.ledger.hook=async(phase,method)=>{if(phase==='before'&&method==='open')await new Promise(resolve=>{release=resolve;});};
  const delayed=harness(fake);const starting=delayed.broker.start();await flush();delayed.broker.dispose();release();await starting;
  assert.equal(delayed.actions.size,0);assert.equal(delayed.broker.metadata().status,'disposed');
});

const roomBuild='hc-rooms-v1';
function fieldTarget(board,slot){
  const generation=board.slots[slot-1].generation;
  let r=(board.seed+slot*104729+generation*13007)%2147483647;
  if(r<1)r+=2147483646;
  for(let i=0;i<4;i++)r=r*16807%2147483647;
  return{id:String(generation*32+slot),tier:slot<=18?'small':slot<=24?'medium':'large',
    characterId:['original','mugi','jiayi','yeseul','eunbi'][Math.floor((r-1)/2147483646*5)]};
}
async function roomOperation(h,method,input){
  let settled=false,value,error;
  h.broker.roomCall(method,input).then(result=>{settled=true;value=result;},reason=>{settled=true;error=reason;});
  await h.run(35);
  assert(settled,'bounded room operation completes');
  if(error)throw error;
  return value;
}

await test('room directory and snapshots use the financial single-flight queue without wallet or fire gates',async()=>{
  const fake=platform({preview:false,chips:1000}),h=harness(fake);await h.boot();const start=h.actionLog.length;
  const joined=await roomOperation(h,'roomDirectory',{op:'advertise',roomId:'qa-room-one',buildId:roomBuild});
  assert.equal(joined.board.slots.length,27);h.broker.setRoomContext({roomId:'qa-room-one',buildId:roomBuild});
  const snapshot=await roomOperation(h,'roomSnapshot',{roomId:'qa-room-one',buildId:roomBuild});
  assert.equal(snapshot.board.seed,joined.board.seed);assert.equal(fake.ledger.maxActive,1);
  assert.equal(fake.ledger.debits,0);assert.equal(fake.ledger.credits,0);assert.equal(fake.ledger.get,0);
  assert.equal(h.actionLog.slice(start).filter(([key,down])=>key==='GSConnecting'&&down).length,0);h.broker.dispose();
});

await test('an expired shared target refunds its reservation and never increments card spend',async()=>{
  const fake=platform({preview:false,chips:1000}),h=harness(fake);await h.boot();
  const joined=await roomOperation(h,'roomDirectory',{op:'advertise',roomId:'qa-refund-room',buildId:roomBuild});
  h.broker.setRoomContext({roomId:'qa-refund-room',buildId:roomBuild});const target=fieldTarget(joined.board,1);
  h.enqueue({roundId:1,weapon:'like',bet:10,targets:[target]});await h.run(20);h.collect();
  const credited=fake.ledger.credits;
  h.enqueue({roundId:2,weapon:'like',bet:10,targets:[target]});await h.run(20);
  assert.equal(fake.ledger.debits,10);assert.equal(fake.ledger.credits,credited);
  assert.equal(h.packets.filter(p=>p.kind===2).length,1);assert.equal(h.state.reservedWager,0);
  assert.equal(h.state.cards.progress,10);assert.equal(h.broker.metadata().status,'ready');h.broker.dispose();
});

await test('partial shared captures retain target order and encode the active denominator mask',async()=>{
  const fake=platform({preview:false,chips:1000}),h=harness(fake);await h.boot();
  const joined=await roomOperation(h,'roomDirectory',{op:'advertise',roomId:'qa-mask-room',buildId:roomBuild});
  h.broker.setRoomContext({roomId:'qa-mask-room',buildId:roomBuild});const a=fieldTarget(joined.board,1),b=fieldTarget(joined.board,2);
  h.enqueue({roundId:1,weapon:'like',bet:10,targets:[a]});await h.run(20);h.collect();
  h.enqueue({roundId:2,weapon:'flower',bet:10,targets:[a,b]});await h.run(20);
  const receipt=h.packets.find(p=>p.kind===1&&p.roundId===2);
  assert.equal(receipt.activeMask,2);assert.deepEqual(receipt.multipliers.slice(0,2),[0,2]);
  assert.equal(receipt.win,120);assert.equal(fake.ledger.debits,70);assert.equal(h.state.cards.progress,70);h.broker.dispose();
});

await test('trusted field notifications follow receipt acknowledgements and switching cannot drop reserved rounds',async()=>{
  const fake=platform({preview:false,chips:1000}),h=harness(fake);await h.boot();
  const joined=await roomOperation(h,'roomDirectory',{op:'advertise',roomId:'qa-field-room',buildId:roomBuild});
  h.broker.setRoomContext({roomId:'qa-field-room',buildId:roomBuild});const snapshots=[];
  const unsub=h.broker.onRoomField(board=>snapshots.push({board,pending:h.state.platform.requests.length,packetAck:h.state.platform.packetAck}));
  h.enqueue({roundId:1,weapon:'like',bet:10,targets:[fieldTarget(joined.board,1)]});
  h.sync();
  assert.throws(()=>h.broker.setRoomContext(null),/not-drained/);await h.run(20);
  assert.equal(snapshots.length,1);assert.equal(snapshots[0].pending,0);assert.equal(snapshots[0].packetAck,h.state.platform.packetAck);
  h.collect();h.sync();assert(h.broker.isIdleForRoomSwitch());h.broker.setRoomContext(null);
  assert.equal(h.state.balance,1010);unsub();h.broker.dispose();
});

await test('room lookup failures stay outside the financial error state and disposal cancels queued lookups',async()=>{
  const h=harness();await h.boot();
  await assert.rejects(roomOperation(h,'roomSnapshot',{roomId:'qa-missing-room',buildId:roomBuild}),/room/i);
  assert.equal(h.broker.metadata().status,'ready');assert.equal(h.state.balance,10000);
  const pending=h.broker.roomCall('roomDirectory',{op:'list',buildId:roomBuild});
  const check=assert.rejects(pending,/disposed/);h.broker.dispose();await check;
});

await test('a wallet-only refresh racing the board ACK cannot strand its new room context',async()=>{
  const fake=platform({preview:false,chips:1000}),h=harness(fake);await h.boot();
  await roomOperation(h,'roomDirectory',{op:'advertise',roomId:'qa-wallet-room',buildId:roomBuild});
  fake.ledger.chips=1100;fake.emit('chipsChanged',{chips:1100});h.sync();
  assert.equal(h.broker.isIdleForRoomSwitch(),false);
  h.broker.setRoomContext({roomId:'qa-wallet-room',buildId:roomBuild});
  await h.run(15);assert.equal(h.state.balance,1100);assert.equal(h.broker.metadata().roomContext.roomId,'qa-wallet-room');
  assert.equal(fake.ledger.debits,0);h.broker.dispose();
});

console.log(`GoldSaucer server transport QA: ${tests.length} checks passed; production server functions, mock SDK and native packet receiver. No real currency operations.`);
