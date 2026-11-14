import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createGoldSaucerServer} from '../game/presentation/goldsaucer-server.mjs';

// Reuse the existing packet fixture while exercising the production broker and
// production functions. No platform calls or real currency operations occur.
const fixtureSource = fs.readFileSync(new URL('./qa-goldsaucer-server.mjs', import.meta.url), 'utf8');
const fixtureBody = fixtureSource.slice(fixtureSource.indexOf('const source ='), fixtureSource.indexOf('const tests=[];'))
  .replaceAll('import.meta.url', 'moduleUrl');
const {platform, harness, round} = new Function('assert','fs','vm','createGoldSaucerServer','moduleUrl',
  fixtureBody + '\nreturn {platform,harness,round};')(assert, fs, vm, createGoldSaucerServer, import.meta.url);
const results = [];
const test = async (name, fn) => { await fn(); results.push(name); console.log('PASS ' + name); };

await test('paid balance61 accepts a base1 like wager and remains ready', async () => {
  const h = harness(platform({preview:false,chips:61,rng:'max'}));
  await h.boot();
  h.state.platform.progress.bet = 1;
  h.state.platform.progressRevision = 1;
  h.enqueue(round(1,{bet:1}));
  await h.run(35);
  assert.equal(h.fake.ledger.chips,60);
  assert.equal(h.state.displayBalance,60);
  assert.equal(h.state.reservedWager,0);
  assert.equal(h.broker.metadata().ready,true);
  assert.equal(h.actions.has('GSConnecting'),false);
  assert.equal(h.fake.ledger.debits,1);
  h.broker.dispose();
});

await test('paid balance61 supports base1 flower and rocket costs', async () => {
  const h = harness(platform({preview:false,chips:61,rng:'max'}));
  await h.boot();
  h.enqueue(round(1,{bet:1,weapon:'flower',count:6}));
  await h.run(20);
  h.enqueue(round(2,{bet:1,weapon:'rocket',count:5}));
  await h.run(20);
  assert.equal(h.fake.ledger.debits,21);
  assert.equal(h.state.displayBalance,40);
  assert.equal(h.broker.metadata().ready,true);
  assert.equal(h.state.reservedWager,0);
  h.broker.dispose();
});

await test('lowering base50 to base1 during settlement preserves the newer preference', async () => {
  const h = harness(platform({preview:false,chips:61,rng:'max'}));
  await h.boot();
  h.enqueue(round(1,{bet:50}));
  h.state.platform.progress.bet = 1;
  h.state.platform.progressRevision = 1;
  await h.run(35);
  assert.equal(h.state.displayBalance,11);
  assert.equal(h.state.platform.progress.bet,1);
  h.enqueue(round(2,{bet:1}));
  await h.run(35);
  assert.equal(h.state.displayBalance,10);
  assert.equal(h.fake.ledger.chips,10);
  assert.equal(h.broker.metadata().ready,true);
  h.broker.dispose();
});

await test('server116 with display61 and55 pending winnings can settle further base1 wagers', async () => {
  const h = harness(platform({preview:false,chips:116,rng:'max'}));
  await h.boot();
  h.state.pendingWin = 55;
  h.state.displayBalance = 61;
  h.state.platform.progress.bet = 1;
  h.state.platform.progressRevision = 1;
  h.enqueue(round(1,{bet:1}));
  await h.run(35);
  assert.equal(h.fake.ledger.chips,115);
  assert.equal(h.state.displayBalance,60);
  assert.equal(h.state.pendingWin,55);
  assert.equal(h.state.reservedWager,0);
  assert.equal(h.actions.has('GSConnecting'),false);
  assert.equal(h.broker.metadata().ready,true);
  h.broker.dispose();
});

await test('sixty base1 wagers drain61 to1 without a permanent transport gate', async () => {
  const h = harness(platform({preview:false,chips:61,rng:'max'}));
  await h.boot();
  h.state.platform.progress.bet = 1;
  h.state.platform.progressRevision = 1;
  for(let id=1;id<=60;id++) {
    h.enqueue(round(id,{bet:1}));
    await h.run(12);
    assert.equal(h.broker.metadata().ready,true,JSON.stringify({id,meta:h.broker.metadata()}));
    assert.equal(h.state.reservedWager,0);
  }
  assert.equal(h.fake.ledger.chips,1);
  assert.equal(h.state.displayBalance,1);
  assert.equal(h.fake.ledger.debits,60);
  h.broker.dispose();
});

const report={passed:true,scope:'Production broker/functions with synthetic paid ledger and packet receiver; no real currency',checks:results};
fs.mkdirSync('artifacts/goldsaucer/qa',{recursive:true});
fs.writeFileSync('artifacts/goldsaucer/qa/low-balance-transport.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
