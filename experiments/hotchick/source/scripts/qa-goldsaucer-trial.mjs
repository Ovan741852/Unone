import assert from 'node:assert/strict';
import {createGoldSaucerBridge,createCardSeedBridge,standaloneTrialRequested} from '../game/presentation/goldsaucer.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const profile={revision:0,preferences:{bet:10,weapon:'like'},stats:{spent:0},unlockedClipIds:[],watchedLargeClipIds:[],skipSeenLargeVideos:false,
  cards:{drawsAvailable:0,progress:0,drawsEarned:0,totalDraws:0,creditedSpend:0,ignoredSpend:0,counts:{},lastBatch:null}};
function fakeSdk({guest=false,preview=false,balance=61,demoBalance=12345,holdInit=false,failInit=false}={}) {
  const calls={init:0,on:0,getUser:0,getBalance:0,server:0,chips:0,saves:0,ui:0,rooms:0};
  const events=new Map();let finishInit;
  const unauthorized=category=>{calls[category]++;throw Object.assign(Error('not signed in'),{code:'unauthorized'});};
  const demoProfile=clone(profile);demoProfile.stats.spent=2000;demoProfile.cards.drawsEarned=2;demoProfile.cards.totalDraws=2;demoProfile.cards.creditedSpend=2000;demoProfile.cards.counts.card0=2;
  const sdk={
    async init(){calls.init++;if(holdInit)await new Promise(resolve=>{finishInit=resolve;});if(failInit)throw Error('init failed');return {trial:guest,preview,user:guest?null:{id:'fixture'}};},
    async getUser(){if(guest)return unauthorized('getUser');calls.getUser++;return {id:'fixture'};},
    async getBalance(){if(guest)return unauthorized('getBalance');calls.getBalance++;return 0;},
    on(name,handler){calls.on++;const handlers=events.get(name)||new Set();handlers.add(handler);events.set(name,handlers);return()=>handlers.delete(handler);},
    server:{async call(name){if(guest)return unauthorized('server');calls.server++;assert.equal(name,'open');return {result:{session:1,sequence:0,rate:50,balance,demoBalance,profiles:{paid:profile,demo:demoProfile}},chips:balance,...(preview?{preview:true}:{})};}},
    chips:{get:()=>unauthorized('chips'),buyIn:()=>unauthorized('chips'),cashOut:()=>unauthorized('chips'),insufficient:()=>unauthorized('chips')},
    saves:{get:()=>unauthorized('saves'),set:()=>unauthorized('saves'),getJSON:()=>unauthorized('saves')},
    ui:{alert:()=>unauthorized('ui')},
    ...(guest?{multiplayer:{join:()=>unauthorized('rooms')}}:{}),
  };
  return {sdk,calls,finish(){finishInit?.();},emit(name,value){for(const handler of events.get(name)||[])handler(value);}};
}
function harness(fake) {
  const held=new Set(),log=[],packets=[];
  const state={balance:10000,displayBalance:10000,reservedWager:0,pendingWin:0,platform:{paused:false,requests:[],packetAck:0,packetError:'',cardIds:Array.from({length:14},(_,i)=>`card${i}`),clipIds:['test-classic-large']}};
  const bridge=createGoldSaucerBridge({sdk:fake.sdk,setAction(name,down){log.push([name,down]);if(down)held.add(name);else held.delete(name);}});
  const read=(name,width)=>Array.from({length:width},(_,bit)=>held.has(`${name}Bit${bit}`)?2**bit:0).reduce((a,b)=>a+b,0);
  const tick=()=>{
    if(held.has('PlatformPause'))state.platform.paused=true;else if(held.has('PlatformResume'))state.platform.paused=false;
    if(held.has('GSReady')&&read('GSPacketId',31)>state.platform.packetAck){
      const packet={kind:read('GSKind',3),balance:read('GSBalance',40),used:read('GSUsed',32),card0:read('GSCard0',32)};packets.push(packet);
      if(packet.kind===0||packet.kind===3)state.balance=state.displayBalance=packet.balance;
      state.platform.packetAck=read('GSPacketId',31);
    }
    bridge.sync(clone(state));
  };
  return {bridge,state,held,log,packets,tick,async run(){for(let i=0;i<8;i++){tick();await flush();}},async boot(){await bridge.ready;await this.run();}};
}
async function withSurface(search,topLevel,run){const previous=globalThis.window;const surface={location:{search}};surface.top=topLevel?surface:{};globalThis.window=surface;try{return await run(surface);}finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}}
const tests=[];async function test(name,run){await run();tests.push(name);console.log(`PASS ${name}`);}

await test('guest init keeps the local10000 session and never touches authenticated server, chips or saves',async()=>{
  const fake=fakeSdk({guest:true}),h=harness(fake);await h.boot();
  assert.equal(h.bridge.metadata().trial,true);assert.equal(h.bridge.metadata().source,'platform-guest');
  assert.equal(h.bridge.metadata().bootPending,false);assert.equal(h.bridge.metadata().paused,false);
  assert.equal(h.state.balance,10000);assert.equal(h.bridge.metadata().server.enabled,false);
  assert.equal(h.log.some(([name])=>name==='GSConnecting'),false);assert.equal(fake.calls.init,1);
  assert.equal(fake.calls.server+fake.calls.chips+fake.calls.saves+fake.calls.getBalance+fake.calls.getUser+fake.calls.rooms,0);
  assert.equal(h.bridge.metadata().rooms.enabled,false);
  await h.bridge.buyIn();await h.bridge.cashOut();await h.bridge.notifyWagerNotice({code:'insufficientFunds',manualAttempt:true,attemptSerial:1,roundCost:1,availableBalance:0});
  assert.equal(fake.calls.chips+fake.calls.ui,0);h.bridge.dispose();
});

await test('SDK identity initialization pauses locally without prematurely enabling remote mode',async()=>{
  const fake=fakeSdk({guest:true,holdInit:true}),h=harness(fake);
  assert.equal(h.bridge.metadata().bootPending,true);assert(h.held.has('PlatformPause'));assert(!h.held.has('GSConnecting'));
  await h.run();assert.equal(h.state.platform.paused,true);assert.equal(fake.calls.server,0);
  fake.finish();await h.boot();assert.equal(h.bridge.metadata().paused,false);assert.equal(h.bridge.metadata().trial,true);h.bridge.dispose();
});

await test('a real platform pause during guest initialization survives ending the boot pause',async()=>{
  const fake=fakeSdk({guest:true,holdInit:true}),h=harness(fake);fake.emit('pause');h.tick();fake.finish();await h.boot();
  assert.equal(h.bridge.metadata().bootPending,false);assert.equal(h.bridge.metadata().desiredPaused,true);assert.equal(h.bridge.metadata().paused,true);
  fake.emit('resume');await h.run();assert.equal(h.bridge.metadata().paused,false);h.bridge.dispose();
});

await test('explicit top-level trial skips every SDK method including init and event registration',async()=>{
  await withSurface('?trial=1',true,async surface=>{
    assert.equal(standaloneTrialRequested(surface),true);
    let calls=0;const forbidden=new Proxy(()=>{calls++;throw Error('SDK forbidden in standalone');},{get(){calls++;throw Error('SDK member forbidden');}});
    const fake={sdk:new Proxy({},{get(){return forbidden;}})},h=harness(fake);await h.boot();
    assert.equal(h.bridge.metadata().trial,true);assert.equal(h.bridge.metadata().source,'standalone');assert.equal(h.bridge.metadata().enabled,false);
    assert.equal(h.state.balance,10000);assert.equal(h.log.length,0);await h.bridge.buyIn();await h.bridge.cashOut();assert.equal(calls,0);h.bridge.dispose();
  });
});

await test('iframe trial query cannot bypass signed-in paid initialization or grant local coins',async()=>{
  await withSurface('?trial=1',false,async surface=>{
    assert.equal(standaloneTrialRequested(surface),false);const fake=fakeSdk({balance:61}),h=harness(fake);await h.boot();
    assert.equal(h.bridge.metadata().trial,false);assert.equal(h.bridge.metadata().source,'platform');assert.equal(h.bridge.metadata().server.mode,'paid');
    assert.equal(h.state.balance,61);assert.equal(fake.calls.init,1);assert.equal(fake.calls.server,1);assert.equal(fake.calls.chips,0);h.bridge.dispose();
  });
});

await test('author preview keeps its persistent server demo balance and card profile',async()=>{
  const fake=fakeSdk({preview:true,demoBalance:12345}),h=harness(fake);await h.boot();
  assert.equal(h.bridge.metadata().trial,false);assert.equal(h.bridge.metadata().source,'author-preview');assert.equal(h.bridge.metadata().server.mode,'demo');
  assert.equal(h.state.balance,12345);assert.equal(h.packets.find(packet=>packet.kind===4).used,2);assert.equal(h.packets.find(packet=>packet.kind===4).card0,2);
  assert.equal(fake.calls.chips,0);h.bridge.dispose();
});

await test('guest identity changes require reload and cannot bootstrap that local board as paid',async()=>{
  const fake=fakeSdk({guest:true}),h=harness(fake);await h.boot();fake.emit('userChanged',{trial:false,user:{id:'now-signed-in'}});await h.run();
  assert.equal(h.bridge.metadata().reloadRequired,true);assert.equal(h.bridge.metadata().status,'error');assert.equal(h.bridge.metadata().paused,true);
  fake.emit('resume');await h.run();assert.equal(h.bridge.metadata().paused,true);assert.equal(fake.calls.server,0);assert.equal(fake.calls.init,1);
  assert(!h.log.some(([name])=>name==='GSConnecting'));h.bridge.dispose();
});

await test('failed identity initialization stays paused without silently opening a funded local trial',async()=>{
  const fake=fakeSdk({failInit:true}),h=harness(fake);await h.boot();assert.equal(h.bridge.metadata().trial,false);
  assert.equal(h.bridge.metadata().reloadRequired,true);assert.equal(h.bridge.metadata().paused,true);assert.equal(fake.calls.server,0);
  assert(!h.log.some(([name])=>name==='GSConnecting'));h.bridge.dispose();
});

await test('seed handshake reasserts the same seed after pause or a missed acknowledgement and never reseeds after ACK',async()=>{
  let clock=0,seeds=0;const held=new Set(),log=[];
  const seed=createCardSeedBridge({now:()=>clock,makeSeed:()=>{seeds++;return 12345;},setAction(name,down){log.push([name,down]);if(down)held.add(name);else held.delete(name);}});
  const unready={cards:{seedReady:false}};seed.sync(unready);const original=[...held].sort();assert(held.has('CardSeedReady'));
  seed.sync(unready,{suspended:true});assert.equal(held.size,0);seed.sync(unready);assert.deepEqual([...held].sort(),original);assert.equal(seeds,1);
  clock=501;seed.sync(unready);assert.equal(held.size,0);seed.sync(unready);assert.deepEqual([...held].sort(),original);assert.equal(seeds,1);
  seed.sync({cards:{seedReady:true}});const count=log.length;for(let frame=0;frame<1000;frame++)seed.sync({cards:{seedReady:true}});
  assert.equal(held.size,0);assert.equal(log.length,count);assert.equal(seeds,1);seed.release();
});

console.log(`GoldSaucer trial QA: ${tests.length} checks passed; mock identity/packets only, no real platform or currency.`);
