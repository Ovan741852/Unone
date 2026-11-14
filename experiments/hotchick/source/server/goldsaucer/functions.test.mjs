import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('./functions.js', import.meta.url), 'utf8');
const luau = fs.readFileSync(new URL('../../game/scripts/main.luau', import.meta.url), 'utf8');
const PLAYER = {id: 'test-player', username: 'tester', displayName: 'Tester'};
const CURRENCY = {name: '心動幣', perDiamond: 50};
const clean = value => JSON.parse(JSON.stringify(value));

function runtime() {
  let functions;
  const context = vm.createContext({defineFunctions(value) { functions = value; }});
  vm.runInContext(source, context);
  return {functions, targetAward: vm.runInContext('targetAward', context)};
}

function context({chips = 10000, currency = CURRENCY, rolls, seed = 2147483} = {}) {
  let randomCalls = 0;
  let state = seed;
  return {
    player: PLAYER,
    chips,
    currency,
    randomCalls: () => randomCalls,
    randomInt(minimum, maximum) {
      const index = randomCalls++;
      const value = rolls ? rolls[index] : (state = state * 16807 % 2147483647);
      const selected = rolls ? value : minimum + Math.floor((value - 1) / 2147483646 * (maximum - minimum + 1));
      assert(Number.isInteger(selected) && selected >= minimum && selected <= maximum,
        `invalid test random value ${selected} for ${minimum}..${maximum}`);
      return selected;
    },
  };
}

function opened(options) {
  const server = runtime();
  const ctx = context(options);
  const state = server.functions.init(ctx);
  const reply = server.functions.open(state, {clientId: 'page-one'}, ctx);
  assert.equal(reply.result.ok, true);
  return {...server, state, ctx};
}

function round({roundId = 1, weapon = 'like', bet = 10, targets} = {}) {
  return {roundId, weapon, bet, targets: targets || [{id: 'girl-1', tier: 'small', characterId: 'eunbi'}]};
}

function batch(state, rounds = [round()], mode = 'paid', batchId = state.sequence + 1) {
  return {session: state.session, batchId, mode, rounds};
}

test('open starts an isolated session and the same clientId retries without resetting it', () => {
  const server = opened();
  assert.equal(server.state.session, 1);
  assert.equal(server.state.sequence, 0);
  assert.equal(server.state.demoBalance, 10000);
  const firstRevision = server.state.revision;
  server.state.demoBalance = 9000;
  let reply = server.functions.open(server.state, {clientId: 'page-one'}, server.ctx);
  assert.equal(reply.result.revision, firstRevision);
  assert.equal(reply.result.demoBalance, 9000);
  reply = server.functions.open(server.state, {clientId: 'page-two'}, server.ctx);
  assert.equal(reply.result.session, 2);
  assert.equal(reply.result.sequence, 0);
  assert.equal(reply.result.demoBalance, 9000);
  assert.deepEqual(clean(reply.chips), {bet: 0, win: 0});
  assert.equal(server.ctx.randomCalls(), 0);
});

test('paid settlement uses the entire weapon cost once and only platform random numbers', () => {
  const server = opened({rolls: [1, 6]});
  const reply = server.functions.settle(server.state, batch(server.state, [round({weapon: 'rocket'})]), server.ctx);
  assert.equal(reply.result.ok, true);
  assert.equal(reply.result.bet, 150);
  assert.equal(reply.result.win, 900);
  assert.equal(reply.result.balance, 10750);
  assert.deepEqual(clean(reply.chips), {bet: 150, win: 900});
  assert.equal(reply.result.rounds[0].targets[0].multiplier, 6);
  assert.equal(server.ctx.randomCalls(), 2);
});

test('all five characters pay small captures while the original missing replay remains null and locked', () => {
  const characters = ['original', 'mugi', 'jiayi', 'yeseul', 'eunbi'];
  const server = opened({rolls: characters.flatMap(() => [1, 6])});
  const request = batch(server.state, characters.map((characterId, index) => round({
    roundId: index + 1,
    targets: [{id: `small-${characterId}`, tier: 'small', characterId}],
  })));
  const settled = clean(server.functions.settle(server.state, request, server.ctx));
  assert.equal(settled.result.ok, true);
  assert.deepEqual(settled.chips, {bet: 50, win: 300});
  assert.equal(settled.result.balance, 10250);
  assert.equal(settled.result.profile.stats.captures, 5);
  for (let index = 0; index < characters.length; index++) {
    const outcome = settled.result.rounds[index].targets[0];
    assert.equal(outcome.captured, true);
    assert.equal(outcome.multiplier, 6);
    assert.equal(outcome.award, 60);
    assert.equal(outcome.styleId, 'classic');
    assert.equal(outcome.clipId, index === 0 ? null : `${characters[index]}-classic-small`);
  }
  assert.deepEqual(settled.result.profile.unlockedClipIds,
    characters.slice(1).map(character => `${character}-classic-small`).sort());
  assert.equal(server.ctx.randomCalls(), 10);
  const after = clean(server.state);
  server.ctx.chips = settled.result.balance;
  const retry = clean(server.functions.settle(server.state, clean(request), server.ctx));
  assert.deepEqual(retry.result, settled.result);
  assert.deepEqual(retry.chips, {bet: 0, win: 0});
  assert.deepEqual(clean(server.state), after);
  assert.equal(server.ctx.randomCalls(), 10);
});

test('whole-cost splitting across distinct mixed targets and rounding uses integer draws', () => {
  const targets = [
    {id: 'small', tier: 'small', characterId: 'eunbi'},
    {id: 'medium', tier: 'medium', characterId: 'mugi'},
    {id: 'large', tier: 'large', characterId: 'original'},
    {id: 'other', tier: 'small', characterId: 'jiayi'},
  ];
  const server = opened({rolls: [1, 3, 1, 1300, 17000, 400]});
  const reply = server.functions.settle(server.state, batch(server.state, [round({weapon: 'flower', bet: 1, targets})]), server.ctx);
  assert.equal(reply.result.ok, true);
  assert.equal(reply.result.bet, 6);
  assert.equal(reply.result.win, 5); // 6 * 3 / 4 = 4.5, rounded up by the supplied integer draw.
  assert.deepEqual(clean(reply.result.rounds[0].targets.map(target => target.award)), [5, 0, 0, 0]);
  assert.equal(server.ctx.randomCalls(), 6);
});

test('a zero-chip preview can use demo funds while returning zero platform ledger movements', () => {
  const server = opened({chips: 0, rolls: [400]});
  const reply = server.functions.settle(server.state, batch(server.state, [round()], 'demo'), server.ctx);
  assert.equal(reply.result.ok, true);
  assert.equal(reply.result.balance, 9990);
  assert.equal(server.state.demoBalance, 9990);
  assert.deepEqual(clean(reply.chips), {bet: 0, win: 0});
  const paid = server.functions.settle(server.state, batch(server.state, [round({roundId: 2})]), server.ctx);
  assert.equal(paid.result.error.code, 'insufficientFunds');
  assert.equal(server.state.sequence, 1);
  assert.equal(server.ctx.randomCalls(), 1);
});

test('uncertain-call retries return the original result and never charge or reroll', () => {
  const server = opened({rolls: [1, 6]});
  const request = batch(server.state);
  const first = clean(server.functions.settle(server.state, request, server.ctx));
  server.ctx.chips = first.result.balance;
  const after = clean(server.state);
  const retry = clean(server.functions.settle(server.state, clean(request), server.ctx));
  assert.deepEqual(retry.result, first.result);
  assert.deepEqual(retry.chips, {bet: 0, win: 0});
  assert.deepEqual(clean(server.state), after);
  assert.equal(server.ctx.randomCalls(), 2);
  request.rounds[0].bet = 20;
  const conflict = server.functions.settle(server.state, request, server.ctx);
  assert.equal(conflict.result.error.code, 'requestConflict');
  assert.deepEqual(clean(server.state), after);
});

test('invalid complete batches are rejected before any RNG or game-state change', () => {
  const changes = [
    value => { value.rounds[0].bet = 2; },
    value => { value.rounds[0].bet = Infinity; },
    value => { value.rounds[0].weapon = '__proto__'; },
    value => { value.rounds[0].targets[0].tier = 'jackpot'; },
    value => { value.rounds[0].targets[0].characterId = 'attacker'; },
    value => { value.rounds[0].targets[0].id = 'x'.repeat(65); },
    value => { value.rounds[0].targets[0].award = 1000000; },
    value => { value.rounds[0].targets = []; },
    value => { value.rounds[0].targets.push({...value.rounds[0].targets[0]}); },
    value => { value.rounds.push(clean(value.rounds[0])); },
    value => { value.rounds = Array.from({length: 11}, (_, index) => round({roundId: index + 1})); },
    value => { value.player = 'someone-else'; },
    value => { value.mode = 'refunded'; },
    value => { value.batchId = 1.5; },
    value => { value.rounds.push(round({roundId: 2, bet: 3})); },
  ];
  for (const change of changes) {
    const server = opened();
    const before = clean(server.state);
    const request = batch(server.state);
    change(request);
    const reply = server.functions.settle(server.state, request, server.ctx);
    assert.equal(reply.result.ok, false);
    assert.equal(reply.result.error.code, 'invalidRequest');
    assert.deepEqual(clean(reply.chips), {bet: 0, win: 0});
    assert.equal(server.ctx.randomCalls(), 0);
    assert.deepEqual(clean(server.state), before);
  }
});

test('stale sessions and skipped/expired batch identifiers cannot create a new wager', () => {
  const server = opened({rolls: [400, 400]});
  const request = batch(server.state);
  let invalid = {...request, session: request.session + 1};
  assert.equal(server.functions.settle(server.state, invalid, server.ctx).result.error.code, 'staleSession');
  invalid = {...request, batchId: 3};
  assert.equal(server.functions.settle(server.state, invalid, server.ctx).result.error.code, 'staleBatch');
  server.functions.settle(server.state, request, server.ctx);
  server.functions.settle(server.state, batch(server.state, [round({roundId: 2})]), server.ctx);
  assert.equal(server.functions.settle(server.state, request, server.ctx).result.error.code, 'staleBatch');
  assert.equal(server.ctx.randomCalls(), 2);
});

test('insufficient total funds reject every round, including otherwise affordable prefixes', () => {
  const server = opened({chips: 10});
  const before = clean(server.state);
  const reply = server.functions.settle(server.state, batch(server.state, [round(), round({roundId: 2})]), server.ctx);
  assert.equal(reply.result.error.code, 'insufficientFunds');
  assert.equal(server.ctx.randomCalls(), 0);
  assert.deepEqual(clean(server.state), before);
});

test('maximum dense batches stay within random, result and state budgets', () => {
  const server = opened({seed: 91823});
  const targets = Array.from({length: 6}, (_, index) => ({
    id: `entity-${index}`, tier: ['small', 'medium', 'large'][index % 3], characterId: 'yeseul',
  }));
  const rounds = Array.from({length: 10}, (_, index) => round({roundId: index + 1, weapon: 'flower', bet: 50, targets}));
  const request = batch(server.state, rounds);
  const reply = server.functions.settle(server.state, request, server.ctx);
  assert.equal(reply.result.ok, true);
  assert.equal(reply.result.bet, 3000);
  assert(server.ctx.randomCalls() <= 240);
  assert(Buffer.byteLength(JSON.stringify(reply.result)) <= 16384);
  assert(Buffer.byteLength(JSON.stringify(reply.state)) <= 65536);
  assert(Buffer.byteLength(JSON.stringify(request)) <= 8192);
});

test('large capture has exactly the quarter-rate boundary and a 100..240 multiplier range', () => {
  const {targetAward} = runtime();
  const intervals = [];
  const rolls = [98, 240];
  const captured = targetAward({id: 'large-boundary', tier: 'large'}, 750, 1, {
    randomInt(minimum, maximum) {
      intervals.push([minimum, maximum]);
      return rolls.shift();
    },
  });
  assert.deepEqual(intervals, [[1, 17000], [100, 240]]);
  assert.equal(intervals[0][1], 4 * 4250);
  assert.equal(captured.captured, true);
  assert.equal(captured.multiplier, 240);
  assert.equal(captured.award, 180000);
  let calls = 0;
  const missed = targetAward({id: 'large-miss', tier: 'large'}, 750, 1, {
    randomInt(minimum, maximum) {
      assert.deepEqual([minimum, maximum], [1, 17000]);
      calls++;
      return 99;
    },
  });
  assert.deepEqual(clean(missed), {id: 'large-miss', captured: false, award: 0, multiplier: 0});
  assert.equal(calls, 1);
});

test('the wallet guard reserves the complete 1,800,000 maximum batch payout', () => {
  const maxWallet = 1099511627775;
  const maxBatchWin = 10 * 50 * 15 * 240;
  assert.equal(maxBatchWin, 1800000);
  const server = opened({chips: maxWallet - maxBatchWin, rolls: Array.from({length: 10}, () => [1, 240]).flat()});
  const rounds = Array.from({length: 10}, (_, index) => round({
    roundId: index + 1, weapon: 'rocket', bet: 50,
    targets: [{id: `large-max-${index}`, tier: 'large', characterId: 'original'}],
  }));
  const request = batch(server.state, rounds);
  const settled = clean(server.functions.settle(server.state, request, server.ctx));
  assert.equal(settled.result.ok, true);
  assert.deepEqual(settled.chips, {bet: 7500, win: maxBatchWin});
  assert.equal(settled.result.balance, maxWallet - 7500);
  assert(settled.result.rounds.every(value => value.targets[0].award === 180000));
  const after = clean(server.state);
  server.ctx.chips = settled.result.balance;
  const retry = clean(server.functions.settle(server.state, request, server.ctx));
  assert.deepEqual(retry.result, settled.result);
  assert.deepEqual(retry.chips, {bet: 0, win: 0});
  assert.deepEqual(clean(server.state), after);
  assert.equal(server.ctx.randomCalls(), 20);

  const rejected = runtime();
  const ctx = context({chips: maxWallet - maxBatchWin + 1});
  const state = rejected.functions.init(ctx);
  assert.equal(rejected.functions.open(state, {clientId: 'over-limit'}, ctx).result.error.code, 'walletLimit');
  assert.equal(state.session, 0);
  assert.equal(ctx.randomCalls(), 0);
  const ready = opened();
  ready.ctx.chips = ctx.chips;
  const before = clean(ready.state);
  assert.equal(ready.functions.settle(ready.state, batch(ready.state), ready.ctx).result.error.code, 'walletLimit');
  assert.deepEqual(clean(ready.state), before);
  assert.equal(ready.ctx.randomCalls(), 0);
});

test('a stored state cannot be reused for another player and a mismatched exchange rate fails closed', () => {
  const server = opened();
  server.ctx.player = {...PLAYER, id: 'different-player'};
  assert.equal(server.functions.settle(server.state, batch(server.state), server.ctx).result.error.code, 'invalidState');
  server.ctx.player = PLAYER;
  server.ctx.currency = {...CURRENCY, perDiamond: 100};
  assert.equal(server.functions.settle(server.state, batch(server.state), server.ctx).result.error.code, 'currencyMismatch');
  assert.equal(server.ctx.randomCalls(), 0);
});

test('the production award helper has exact 49/50 expectation for every supported wager and integer tail', () => {
  const {targetAward} = runtime();
  const ranges = {small: [2, 6], medium: [8, 18], large: [100, 240]};
  const weapons = {like: [1, 1], flower: [6, 6], rocket: [15, 5]};
  let cases = 0;
  for (const [tier, [low, high]] of Object.entries(ranges)) {
    const denominator = 50 * (low + high);
    let captures = 0;
    for (let captureRoll = 1; captureRoll <= denominator; captureRoll++) {
      const ctx = {randomInt(minimum) { return minimum === 1 ? captureRoll : low; }};
      if (targetAward({id: 'proof', tier}, 6, 6, ctx).captured) captures++;
    }
    assert.equal(captures, 98);
    for (const bet of [1, 5, 10, 20, 50]) {
      for (const [factor, limit] of Object.values(weapons)) {
        const cost = bet * factor;
        for (let count = 1; count <= limit; count++) {
          let summedAward = 0;
          for (let multiplier = low; multiplier <= high; multiplier++) {
            for (let tail = 1; tail <= count; tail++) {
              const rolls = [1, multiplier, tail];
              const ctx = {randomInt() { return rolls.shift(); }};
              summedAward += targetAward({id: 'proof', tier}, cost, count, ctx).award;
            }
          }
          // Multiply the exact rational expectation by N; no floating arithmetic.
          const numerator = BigInt(captures * summedAward * count * 100);
          const expected = BigInt(cost * 98 * denominator * (high - low + 1) * count);
          assert.equal(numerator, expected, `${tier}/${cost}/${count}`);
          cases++;
        }
      }
    }
  }
  assert.equal(cases, 180);
});

test('server rules match the authored Luau payout tables', () => {
  assert.match(luau, /local RTP_NUMERATOR = 98\b/);
  assert.match(luau, /local RTP_DENOMINATOR = 100\b/);
  assert.match(luau, /local BETS = \{1, 5, 10, 20, 50\}/);
  assert.match(luau, /\{like=1, flower=6, rocket=15\}/);
  assert.match(luau, /\{small=2, medium=8, large=100\}/);
  assert.match(luau, /\{small=6, medium=18, large=240\}/);
});

test('style selection is server-owned and only unlocks the exact eligible captured clip', () => {
  const server = opened({rolls: [1, 100, 4]});
  const target = {id: 'summer-target', tier: 'large', characterId: 'yeseul'};
  const response = server.functions.settle(server.state,
    batch(server.state, [round({weapon: 'rocket', bet: 50, targets: [target]})]), server.ctx);
  assert.equal(response.result.ok, true);
  assert.equal(response.result.rounds[0].targets[0].styleId, 'summer');
  assert.equal(response.result.rounds[0].targets[0].clipId, 'yeseul-summer-large');
  assert.deepEqual(clean(response.result.profile.unlockedClipIds), ['yeseul-summer-large']);
  assert.deepEqual(clean(response.result.profile.stats), {spent: 750, won: 75000, settledRounds: 1, captures: 1});
  assert.equal(server.ctx.randomCalls(), 3);
  assert.deepEqual(clean(server.state.profiles.demo.unlockedClipIds), []);
});

test('all style thresholds and the 50/25/25 large split follow the authored rules', () => {
  const sourceRuntime = vm.createContext({defineFunctions() {}});
  vm.runInContext(source, sourceRuntime);
  const style = vm.runInContext('clipStyle', sourceRuntime);
  const target = (characterId, tier) => ({characterId, tier});
  const never = {randomInt() { throw Error('ineligible styles consumed RNG'); }};
  assert.equal(style(target('eunbi', 'small'), 50, never), 'classic');
  assert.equal(style(target('eunbi', 'medium'), 20, never), 'classic');
  assert.equal(style(target('mugi', 'large'), 20, never), 'classic');
  assert.equal(style(target('yeseul', 'large'), 10, never), 'classic');
  assert.equal(style(target('original', 'large'), 50, never), 'classic');
  const force = choice => ({randomInt() { return choice; }});
  assert.equal(style(target('eunbi', 'medium'), 50, force(2)), 'summer');
  assert.equal(style(target('jiayi', 'large'), 50, force(2)), 'christmas');
  assert.equal(style(target('mugi', 'medium'), 50, force(2)), 'christmas');
  assert.equal(style(target('yeseul', 'medium'), 20, force(2)), 'halloween');
  assert.equal(style(target('yeseul', 'large'), 20, force(2)), 'halloween');
  assert.deepEqual([1, 2, 3, 4].map(choice => style(target('yeseul', 'large'), 50, force(choice))),
    ['classic', 'classic', 'halloween', 'summer']);
});

test('settled spend preserves packs above ten and uncertain ten-card draws are idempotent', () => {
  const rolls = [...Array(20).fill(400), ...Array.from({length: 10}, () => [1, 0]).flat(), 400];
  const server = opened({chips: 100000, rolls});
  const paidRounds = offset => Array.from({length: 10}, (_, index) =>
    round({roundId: offset + index, weapon: 'rocket', bet: 50}));
  let reply = server.functions.settle(server.state, batch(server.state, paidRounds(1)), server.ctx);
  server.ctx.chips = reply.result.balance;
  assert.equal(reply.result.profile.cards.drawsAvailable, 7);
  assert.equal(reply.result.profile.cards.progress, 500);
  reply = server.functions.settle(server.state, batch(server.state, paidRounds(11)), server.ctx);
  server.ctx.chips = reply.result.balance;
  assert.equal(reply.result.profile.cards.drawsAvailable, 15);
  assert.equal(reply.result.profile.cards.progress, 0);
  assert.equal(reply.result.profile.cards.creditedSpend, 15000);
  assert.equal(reply.result.profile.cards.ignoredSpend, 0);
  const request = {session: server.state.session, mode: 'paid', drawId: 1};
  const drawn = clean(server.functions.drawCards(server.state, request, server.ctx));
  assert.equal(drawn.result.profile.cards.drawsAvailable, 5);
  assert.equal(drawn.result.profile.cards.totalDraws, 10);
  assert.equal(drawn.result.profile.cards.counts['eunbi-n-01'], 10);
  assert.equal(drawn.result.lastBatch.size, 10);
  assert.equal(drawn.result.lastBatch.items[0].isNew, true);
  assert(drawn.result.lastBatch.items.slice(1).every(item => !item.isNew));
  assert.deepEqual(drawn.chips, {bet: 0, win: 0});
  const calls = server.ctx.randomCalls();
  const replay = clean(server.functions.drawCards(server.state, request, server.ctx));
  assert.deepEqual(replay.result, drawn.result);
  assert.deepEqual(replay.chips, {bet: 0, win: 0});
  assert.equal(server.ctx.randomCalls(), calls);
  reply = server.functions.settle(server.state, batch(server.state, [round({roundId: 21, weapon: 'rocket', bet: 50})]), server.ctx);
  assert.equal(reply.result.profile.cards.progress, 750);
  assert.equal(reply.result.profile.cards.drawsAvailable, 5);
  assert.equal(server.state.profiles.demo.cards.totalDraws, 0);
  const reopen = server.functions.open(server.state, {clientId: 'new-page', mode: 'paid'}, server.ctx);
  assert.equal(reopen.result.profile.cards.totalDraws, 10);
  assert.equal(reopen.result.profile.cards.counts['eunbi-n-01'], 10);
  assert.equal(reopen.result.profile.cards.progress, 750);
  assert.equal(reopen.result.profile.cards.drawsAvailable, 5);
  assert.equal(reopen.result.profile.cards.lastBatch.size, 10);
});

test('pack storage stops at 9999, discards overflow, and resumes only from new spend after drawing', () => {
  const server = opened({rolls: [400, 400, ...Array.from({length: 10}, () => [1, 0]).flat(), 400]});
  const cards = server.state.profiles.paid.cards;
  cards.drawsAvailable = 9998;
  cards.progress = 999;
  let reply = server.functions.settle(server.state, batch(server.state), server.ctx);
  server.ctx.chips = reply.result.balance;
  assert.equal(reply.result.profile.cards.drawsAvailable, 9999);
  assert.equal(reply.result.profile.cards.progress, 0);
  assert.equal(reply.result.profile.cards.creditedSpend, 1);
  assert.equal(reply.result.profile.cards.ignoredSpend, 9);
  assert.equal(reply.result.profile.cards.drawsEarned, 1);
  reply = server.functions.settle(server.state, batch(server.state, [round({roundId: 2})]), server.ctx);
  server.ctx.chips = reply.result.balance;
  assert.equal(reply.result.profile.cards.drawsAvailable, 9999);
  assert.equal(reply.result.profile.cards.progress, 0);
  assert.equal(reply.result.profile.cards.creditedSpend, 1);
  assert.equal(reply.result.profile.cards.ignoredSpend, 19);
  reply = server.functions.drawCards(server.state, {session: 1, mode: 'paid', drawId: 1}, server.ctx);
  assert.equal(reply.result.lastBatch.size, 10);
  assert.equal(reply.result.profile.cards.drawsAvailable, 9989);
  assert.equal(reply.result.profile.cards.progress, 0);
  reply = server.functions.settle(server.state, batch(server.state, [round({roundId: 3})]), server.ctx);
  assert.equal(reply.result.profile.cards.drawsAvailable, 9989);
  assert.equal(reply.result.profile.cards.progress, 10);
  assert.equal(reply.result.profile.cards.creditedSpend, 11);
  assert.equal(reply.result.profile.cards.ignoredSpend, 19);
});

test('eleven stored packs open ten, retain one across retries and reload, then open the final one', () => {
  const server = opened({rolls: Array.from({length: 11}, () => [96, 1]).flat()});
  const profile = server.state.profiles.paid;
  profile.cards.drawsAvailable = 11;
  profile.cards.counts['jiayi-n-01'] = 2;
  profile.cards.totalDraws = 2;
  profile.unlockedClipIds = ['original-classic-large'];
  profile.watchedLargeClipIds = ['original-classic-large'];
  profile.skipSeenLargeVideos = true;
  const request = {session: 1, mode: 'paid', drawId: 1};
  const first = clean(server.functions.drawCards(server.state, request, server.ctx));
  assert.equal(first.result.lastBatch.size, 10);
  assert.equal(first.result.profile.cards.drawsAvailable, 1);
  assert.equal(first.result.profile.cards.totalDraws, 12);
  assert.equal(first.result.profile.cards.counts['yeseul-sr-01'], 10);
  assert.equal(first.result.profile.cards.counts['jiayi-n-01'], 2);
  assert.equal(server.ctx.randomCalls(), 20);
  const after = clean(server.state);
  const retry = clean(server.functions.drawCards(server.state, request, server.ctx));
  assert.deepEqual(retry.result, first.result);
  assert.deepEqual(retry.chips, {bet: 0, win: 0});
  assert.deepEqual(clean(server.state), after);
  assert.equal(server.ctx.randomCalls(), 20);
  const reload = server.functions.open(server.state, {clientId: 'eleven-reloaded', mode: 'paid'}, server.ctx);
  assert.equal(reload.result.profile.cards.drawsAvailable, 1);
  assert.deepEqual(clean(reload.result.profile.unlockedClipIds), ['original-classic-large']);
  assert.deepEqual(clean(reload.result.profile.watchedLargeClipIds), ['original-classic-large']);
  assert.equal(reload.result.profile.skipSeenLargeVideos, true);
  assert.equal(server.state.schema, 1);
  const last = server.functions.drawCards(server.state, {session: reload.result.session, mode: 'paid', drawId: 1}, server.ctx);
  assert.equal(last.result.lastBatch.size, 1);
  assert.equal(last.result.profile.cards.drawsAvailable, 0);
  assert.equal(last.result.profile.cards.totalDraws, 13);
  assert.equal(last.result.profile.cards.counts['yeseul-sr-01'], 11);
  assert.equal(server.ctx.randomCalls(), 22);
});

test('9999 stored packs take only twenty RNG draws per ten-card batch and retain 9979 after two batches', () => {
  const server = opened({rolls: Array.from({length: 20}, () => [1, 0]).flat()});
  server.state.profiles.paid.cards.drawsAvailable = 9999;
  for (let drawId = 1; drawId <= 2; drawId++) {
    const request = {session: 1, mode: 'paid', drawId};
    const calls = server.ctx.randomCalls();
    const reply = clean(server.functions.drawCards(server.state, request, server.ctx));
    assert.equal(reply.result.ok, true);
    assert.equal(reply.result.lastBatch.size, 10);
    assert.equal(reply.result.lastBatch.items.length, 10);
    assert.equal(reply.result.profile.cards.drawsAvailable, 9999 - drawId * 10);
    assert.equal(reply.result.profile.cards.totalDraws, drawId * 10);
    assert.equal(server.ctx.randomCalls() - calls, 20);
    assert.deepEqual(reply.chips, {bet: 0, win: 0});
    assert(Buffer.byteLength(JSON.stringify(reply.result)) <= 16384);
    assert(Buffer.byteLength(JSON.stringify(reply.state)) <= 65536);
    assert(Buffer.byteLength(JSON.stringify(request)) <= 8192);
    const after = clean(server.state);
    const retry = clean(server.functions.drawCards(server.state, request, server.ctx));
    assert.deepEqual(retry.result, reply.result);
    assert.deepEqual(clean(server.state), after);
    assert.equal(server.ctx.randomCalls() - calls, 20);
  }
  const reloaded = server.functions.open(server.state, {clientId: 'max-packs-reloaded', mode: 'paid'}, server.ctx);
  assert.equal(reloaded.result.profile.cards.drawsAvailable, 9979);
  assert.equal(reloaded.result.profile.cards.totalDraws, 20);
  assert.equal(reloaded.result.profile.cards.counts['eunbi-n-01'], 20);
  assert.equal(server.state.profiles.demo.cards.drawsAvailable, 0);
});

test('all fourteen cards are reachable with exact N/R/SR boundaries', () => {
  const rolls = [];
  for (let index = 0; index < 6; index++) rolls.push(70, index);
  for (let index = 0; index < 4; index++) rolls.push(95, index);
  for (let index = 0; index < 4; index++) rolls.push(96, index);
  const server = opened({rolls});
  server.state.profiles.paid.cards.drawsAvailable = 10;
  let reply = server.functions.drawCards(server.state, {session: 1, mode: 'paid', drawId: 1}, server.ctx);
  assert.equal(reply.result.profile.cards.totalDraws, 10);
  server.state.profiles.paid.cards.drawsAvailable = 4;
  reply = server.functions.drawCards(server.state, {session: 1, mode: 'paid', drawId: 2}, server.ctx);
  assert.equal(reply.result.profile.cards.totalDraws, 14);
  assert.equal(Object.keys(reply.result.profile.cards.counts).length, 14);
  assert.equal(reply.result.profile.cards.counts['yeseul-sr-01'], 1);
  assert.equal(reply.result.profile.cards.counts['jiayi-sr-02'], 1);
  assert.equal(server.ctx.randomCalls(), 28);
});

test('watched clips and preferences persist without accepting invented unlocks or card inventory', () => {
  const server = opened({rolls: [1, 100, 1]});
  const request = batch(server.state, [round({weapon: 'rocket', bet: 50,
    targets: [{id: 'large', tier: 'large', characterId: 'yeseul'}]})]);
  const settled = server.functions.settle(server.state, request, server.ctx);
  assert.deepEqual(clean(settled.result.profile.unlockedClipIds), ['yeseul-classic-large']);
  const before = clean(server.state);
  const invalid = server.functions.saveProgress(server.state, {
    session: 1, mode: 'paid', watchedLargeClipIds: ['yeseul-summer-large'],
  }, server.ctx);
  assert.equal(invalid.result.error.code, 'invalidRequest');
  assert.deepEqual(clean(server.state), before);
  const injected = server.functions.saveProgress(server.state, {
    session: 1, mode: 'paid', cards: {counts: {'yeseul-sr-01': 99}},
  }, server.ctx);
  assert.equal(injected.result.error.code, 'invalidRequest');
  const saved = server.functions.saveProgress(server.state, {
    session: 1, mode: 'paid', expectedRevision: settled.result.profile.revision,
    watchedLargeClipIds: ['yeseul-classic-large'], skipSeenLargeVideos: true, bet: 20, weapon: 'flower',
  }, server.ctx);
  assert.equal(saved.result.ok, true);
  assert.deepEqual(clean(saved.result.profile.watchedLargeClipIds), ['yeseul-classic-large']);
  assert.deepEqual(clean(saved.result.profile.preferences), {bet: 20, weapon: 'flower'});
  const oldRevision = server.functions.saveProgress(server.state, {
    session: 1, mode: 'paid', expectedRevision: settled.result.profile.revision, skipSeenLargeVideos: false,
  }, server.ctx);
  assert.equal(oldRevision.result.error.code, 'profileConflict');
  const reopen = server.functions.open(server.state, {clientId: 'another-page', mode: 'paid'}, server.ctx);
  assert.equal(reopen.result.profile.skipSeenLargeVideos, true);
  assert.deepEqual(clean(reopen.result.profile.watchedLargeClipIds), ['yeseul-classic-large']);
  assert.equal(reopen.result.profiles.demo.skipSeenLargeVideos, false);
});

const platformRoot = process.env.GOLDSAUCER_SOURCE || fileURLToPath(new URL('../../../GoldSaucer/', import.meta.url));
const bootstrapPath = path.join(platformRoot, 'packages/sandbox/src/functions-bootstrap.ts');
test('the script runs through the real platform bootstrap with zero-chip demo and replay semantics', {
  skip: fs.existsSync(bootstrapPath) ? false : 'Set GOLDSAUCER_SOURCE to run the platform bootstrap contract check',
}, () => {
  const bootstrapSource = fs.readFileSync(bootstrapPath, 'utf8');
  const bootstrap = bootstrapSource.match(/export const FUNCTIONS_BOOTSTRAP = String\.raw`([\s\S]*)`;\s*$/)?.[1];
  assert(bootstrap);
  function call(name, input, state) {
    const vmContext = vm.createContext({});
    vm.runInContext(bootstrap + '\n' + source, vmContext);
    vmContext.request = JSON.stringify({name, input, state, player: PLAYER, chips: 0, currency: CURRENCY,
      randoms: Array.from({length: 256}, () => 0.99)});
    const response = vm.runInContext('__gs_call(request)', vmContext);
    return JSON.parse(response).ok;
  }
  const open = call('open', {clientId: 'bootstrap'}, null);
  assert.equal(open.result.ok, true);
  const input = batch(open.state, [round()], 'demo');
  const settled = call('settle', input, open.state);
  assert.equal(settled.result.ok, true);
  assert.equal(settled.result.balance, 9990);
  assert.deepEqual(settled.chips, {bet: 0, win: 0});
  const retried = call('settle', input, settled.state);
  assert.deepEqual(retried.result, settled.result);
  assert.deepEqual(retried.chips, {bet: 0, win: 0});
});
