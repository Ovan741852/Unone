import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createGoldSaucerBridge} from '../game/presentation/goldsaucer.mjs';
import {CdpClient} from './cdp-client.mjs';

function mockSdk(overrides = {}) {
  const events = new Map();
  const calls = {init:0, getUser:0, getBalance:0, unsubscribe:0, sponsor:0, save:0};
  const sdk = {
    async init() { calls.init++; },
    async getUser() { calls.getUser++; return {untrustedDisplayName:'fixture'}; },
    async getBalance() { calls.getBalance++; return {untrustedShape:123}; },
    sponsor() { calls.sponsor++; throw new Error('Currency transfer must never be requested'); },
    saves:{set() { calls.save++; throw new Error('This version keeps session-only collections'); }},
    on(event, callback) {
      const callbacks = events.get(event) || new Set();
      callbacks.add(callback); events.set(event, callbacks);
      return () => { calls.unsubscribe++; callbacks.delete(callback); };
    },
    ...overrides,
  };
  return {sdk, calls, emit(event) { for (const callback of events.get(event) || []) callback(); }};
}

const tests = [];
async function test(name, run) { await run(); tests.push(name); }
const tick = () => new Promise(resolve => setImmediate(resolve));
function acknowledgeBoot(bridge,actions,paused) {
  bridge.sync({platform:{paused:true}});bridge.sync({platform:{paused:false}});
  if(actions)actions.length=0;if(paused)paused.length=0;
}

await test('missing SDK preserves a local game without emitting commands', async () => {
  const actions = [];
  const bridge = createGoldSaucerBridge({sdk:null, setAction:(...args)=>actions.push(args)});
  await bridge.ready;
  bridge.sync({platform:{paused:true}});
  assert.equal(bridge.metadata().status,'local');
  assert.equal(bridge.metadata().paused,false);
  assert.deepEqual(actions,[]);
  bridge.dispose();
});

await test('documented initialization and read-only queries keep raw identity/balance private', async () => {
  const fake = mockSdk(), bridge = createGoldSaucerBridge({sdk:fake.sdk});
  await bridge.ready;
  assert.equal(bridge.metadata().status,'ready');
  assert.equal(bridge.metadata().identityReady,true);
  assert.equal(bridge.metadata().balanceReady,true);
  assert.equal(fake.calls.init,1); assert.equal(fake.calls.getUser,1); assert.equal(fake.calls.getBalance,1);
  assert.equal(bridge.metadata().exchangeRate,50); assert.equal(bridge.metadata().exchangeAvailable,false);
  assert(!JSON.stringify(bridge.metadata()).includes('untrusted'));
  assert.equal(fake.calls.sponsor,0); assert.equal(fake.calls.save,0);
  bridge.dispose();
});

await test('pause remains held across missed native ticks and releases only on ACK', async () => {
  const fake = mockSdk(), actions = [], paused = [];
  const bridge = createGoldSaucerBridge({sdk:fake.sdk,setAction:(...args)=>actions.push(args),onPauseChange:value=>paused.push(value)});
  await bridge.ready; acknowledgeBoot(bridge,actions,paused);fake.emit('pause');
  for (let frame=0;frame<100;frame++) bridge.sync({platform:{paused:false}});
  assert.deepEqual(actions,[['PlatformPause',true]]);
  assert.deepEqual(paused,[true]);
  bridge.sync({platform:{paused:true}});
  assert.deepEqual(actions,[['PlatformPause',true],['PlatformPause',false]]);
  assert.equal(bridge.metadata().paused,true);
  bridge.dispose();
});

await test('resume keeps presentation suspended until native resume acknowledgement', async () => {
  const fake = mockSdk(), actions = [], paused = [];
  const bridge = createGoldSaucerBridge({sdk:fake.sdk,setAction:(...args)=>actions.push(args),onPauseChange:value=>paused.push(value)});
  await bridge.ready;acknowledgeBoot(bridge,actions,paused); fake.emit('pause'); bridge.sync({platform:{paused:true}}); fake.emit('resume');
  bridge.sync({platform:{paused:true}});
  assert.equal(bridge.metadata().paused,true);
  assert.deepEqual(actions.at(-1),['PlatformResume',true]);
  bridge.sync({platform:{paused:false}});
  assert.equal(bridge.metadata().paused,false);
  assert.deepEqual(actions.at(-1),['PlatformResume',false]);
  assert.deepEqual(paused,[true,false]); bridge.dispose();
});

await test('rapid pause/resume before a native tick serializes both command acknowledgements', async () => {
  const fake = mockSdk(), actions = [];
  const bridge = createGoldSaucerBridge({sdk:fake.sdk,setAction:(...args)=>actions.push(args)});
  await bridge.ready;acknowledgeBoot(bridge,actions); fake.emit('pause'); fake.emit('resume');
  bridge.sync({platform:{paused:false}});
  assert.deepEqual(actions,[['PlatformPause',true]]);
  bridge.sync({platform:{paused:true}}); bridge.sync({platform:{paused:false}});
  assert.deepEqual(actions,[['PlatformPause',true],['PlatformPause',false],['PlatformResume',true],['PlatformResume',false]]);
  bridge.dispose();
});

await test('repeated events and missing observations never duplicate a held command', async () => {
  const fake = mockSdk(), actions = [];
  const bridge = createGoldSaucerBridge({sdk:fake.sdk,setAction:(...args)=>actions.push(args)});
  await bridge.ready;acknowledgeBoot(bridge,actions); fake.emit('pause'); fake.emit('pause'); bridge.sync({}); bridge.sync(null);
  assert.deepEqual(actions,[['PlatformPause',true]]); bridge.dispose();
});

await test('SDK pause during initialization is retained', async () => {
  const fake = mockSdk(), actions = [];
  fake.sdk.init = async () => { fake.emit('pause'); };
  const bridge = createGoldSaucerBridge({sdk:fake.sdk,setAction:(...args)=>actions.push(args)});
  await bridge.ready;
  assert.equal(bridge.metadata().paused,true); assert.deepEqual(actions,[['PlatformPause',true]]);
  bridge.dispose();
});

await test('identity changes require a reload and never switch a running local session to paid', async () => {
  const fake = mockSdk(), bridge = createGoldSaucerBridge({sdk:fake.sdk});
  await bridge.ready; fake.emit('userChanged'); fake.emit('balanceChanged'); await tick();
  assert.equal(fake.calls.getUser,1); assert.equal(fake.calls.getBalance,1);
  assert.equal(bridge.metadata().reloadRequired,true);assert.equal(bridge.metadata().lastError,'account-changed-reload');
  assert.equal(fake.calls.sponsor,0); assert.equal(fake.calls.save,0); bridge.dispose();
});

await test('failed SDK initialization is contained and leaves local rendering available', async () => {
  const fake = mockSdk({init:async()=>{ throw Object.assign(new Error('blocked'),{code:'unauthorized'}); }});
  const bridge = createGoldSaucerBridge({sdk:fake.sdk}); await bridge.ready;
  assert.equal(bridge.metadata().status,'error'); assert.equal(bridge.metadata().lastError,'unauthorized');
  assert.equal(fake.calls.getUser,0); assert.equal(fake.calls.getBalance,0); bridge.dispose();
});

await test('failed read-only queries are contained while pause subscriptions remain active', async () => {
  const fake = mockSdk({getBalance:async()=>{ throw new Error('unavailable'); }});
  const bridge = createGoldSaucerBridge({sdk:fake.sdk}); await bridge.ready;
  assert.equal(bridge.metadata().status,'ready'); assert.equal(bridge.metadata().balanceReady,false);
  acknowledgeBoot(bridge);fake.emit('pause'); assert.equal(bridge.metadata().paused,true); bridge.dispose();
});

await test('dispose releases held input and subscriptions once', async () => {
  const fake = mockSdk(), actions = [];
  const bridge = createGoldSaucerBridge({sdk:fake.sdk,setAction:(...args)=>actions.push(args)});
  await bridge.ready;acknowledgeBoot(bridge,actions); fake.emit('pause'); bridge.dispose(); bridge.dispose(); fake.emit('resume');
  assert.deepEqual(actions,[['PlatformPause',true],['PlatformPause',false]]);
  assert.equal(fake.calls.unsubscribe,4); assert.equal(bridge.metadata().status,'disposed');
});

await test('late asynchronous completion cannot revive a disposed bridge', async () => {
  let finish;
  const fake = mockSdk({init:()=>new Promise(resolve=>{finish=resolve;})});
  const bridge = createGoldSaucerBridge({sdk:fake.sdk}); bridge.dispose(); finish(); await bridge.ready;
  assert.equal(bridge.metadata().status,'disposed'); assert.equal(fake.calls.getUser,0);
});

await test('SDKs without unsubscribe handles cannot trigger queries after disposal', async () => {
  const fake = mockSdk();
  const subscribe = fake.sdk.on;
  fake.sdk.on = (event, callback) => { subscribe(event, callback); };
  const bridge = createGoldSaucerBridge({sdk:fake.sdk}); await bridge.ready; bridge.dispose();
  fake.emit('userChanged'); fake.emit('balanceChanged'); await tick();
  assert.equal(fake.calls.getUser,1); assert.equal(fake.calls.getBalance,1);
});

if (process.argv.includes('--browser')) {
  await test('card opening phases and draw timeout remain frozen during platform pause', async () => {
    const cdp = await CdpClient.connect();
    const {targetId} = await cdp.send('Target.createTarget',{url:'about:blank'});
    const {sessionId} = await cdp.send('Target.attachToTarget',{targetId,flatten:true});
    const evaluate = expression => cdp.evaluate(sessionId,expression);
    async function advance(milliseconds) {
      let listener;
      const expired = new Promise((resolve,reject) => {
        const timeout = setTimeout(()=>reject(new Error('Virtual time budget did not finish')),10000);
        listener = event => {
          if(event.sessionId===sessionId && event.method==='Emulation.virtualTimeBudgetExpired') {
            clearTimeout(timeout);resolve();
          }
        };
        cdp.listeners.add(listener);
      });
      try {
        await cdp.send('Emulation.setVirtualTimePolicy',{policy:'advance',budget:milliseconds},sessionId);
        await expired;
      } finally { cdp.listeners.delete(listener); }
    }
    try {
      await cdp.send('Runtime.enable',{},sessionId);
      await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false},sessionId);
      await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]},sessionId);
      await cdp.send('Emulation.setVirtualTimePolicy',{policy:'pause'},sessionId);
      const module = fs.readFileSync('game/presentation/cards.mjs','utf8');
      const css = fs.readFileSync('game/presentation/game-ui.css','utf8')+'\n'+fs.readFileSync('game/presentation/cards.css','utf8');
      await evaluate(`(async()=>{
        document.head.innerHTML='<style></style>';document.querySelector('style').textContent=${JSON.stringify(css)};
        document.body.innerHTML='<div class="hc-game-ui"><section class="hc-modal"><div class="hc-modal-card is-pack"><div class="hc-modal-body"></div></div></section></div>';
        const {createCards}=await import('data:text/javascript;base64,${Buffer.from(module).toString('base64')}');
        window.cardCalls=[];
        window.cardFixture={ready:true,canDraw:true,drawsAvailable:3,capacity:10,catalog:[
          {id:'n',rarity:'N',name:'Normal',count:0},{id:'r',rarity:'R',name:'Rare',count:0},{id:'sr',rarity:'SR',name:'Super',count:0}
        ]};
        const art='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="purple"/></svg>');
        window.cardControl=createCards({asset:()=>art,action:code=>cardCalls.push(code)});
        cardControl.mountPack(document.querySelector('.hc-modal-body'),cardFixture);
        document.querySelector('[data-card-action="open-pack"]').click();
        cardControl.setPlatformPaused(true);
      })()`);
      await advance(9000);
      assert.equal(await evaluate('cardControl.metadata().waiting'),true);
      assert.equal(await evaluate('cardControl.metadata().packPhase'),'charge');
      await evaluate(`cardControl.update({...cardFixture,drawsAvailable:0,lastBatch:{serial:1,size:3,items:[{serial:1,cardId:'n',count:1},{serial:2,cardId:'sr',count:1},{serial:3,cardId:'r',count:1}]}})`);
      await advance(2000);
      assert.equal(await evaluate('cardControl.metadata().packPhase'),'charge');
      for (const [activeTime,phase] of [[1000,'tear'],[700,'backs'],[700,'reveal']]) {
        await evaluate('cardControl.setPlatformPaused(false)');
        await advance(activeTime);
        assert.equal(await evaluate('cardControl.metadata().packPhase'),phase);
        await evaluate('cardControl.setPlatformPaused(true)');
        await advance(2500);
        assert.equal(await evaluate('cardControl.metadata().packPhase'),phase);
      }
      await evaluate('cardControl.setPlatformPaused(false)');
      await advance(5000);
      assert.equal(await evaluate('cardControl.metadata().packPhase'),'results');
      assert.deepEqual(await evaluate('cardControl.metadata().sortedResults.map(item=>item.cardId)'),['sr','r','n']);
      assert.deepEqual(await evaluate('cardCalls'),['CardDrawAll']);
      await evaluate('cardControl.release()');
    } finally {
      await cdp.send('Target.closeTarget',{targetId});
      cdp.close();
    }
  });
}

console.log(JSON.stringify({passed:true,checks:tests.length,tests},null,2));
