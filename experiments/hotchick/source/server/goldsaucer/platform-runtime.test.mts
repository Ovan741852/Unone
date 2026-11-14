import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// Run with the platform's installed tsx loader. This exercises its actual sandbox.
const platformRoot = process.env.GOLDSAUCER_SOURCE || 'D:/TSProject/GoldSaucer';
const runtimeUrl = pathToFileURL(path.join(platformRoot, 'packages/sandbox/src/functions-runtime.ts')).href;
const {initFunctionsRuntime, validateFunctions, runFunction} = await import(runtimeUrl);
const source = await fs.readFile('server/goldsaucer/functions.js', 'utf8');
await initFunctionsRuntime();
const validated = validateFunctions(source);
assert.equal(validated.ok, true, JSON.stringify(validated));
assert.deepEqual(validated.names, ['open', 'settle', 'drawCards', 'saveProgress', 'roomDirectory', 'roomSnapshot']);
let state = null;
let calls = 0;
let peakStateBytes = 0;
let peakResultBytes = 0;
function call(name, input, randomValue = 0, randomCount = 256) {
  const response = runFunction(source, {
    name, input, state,
    player: {id: 'synthetic-user', username: 'synthetic', displayName: 'Synthetic'},
    chips: 0, currency: {name: '心動幣', perDiamond: 50},
    randoms: Array.from({length: randomCount}, () => randomValue),
  });
  assert.equal(response.ok, true, JSON.stringify(response));
  state = response.out.state;
  assert.deepEqual(response.out.chips, {bet: 0, win: 0});
  peakStateBytes = Math.max(peakStateBytes, Buffer.byteLength(JSON.stringify(state)));
  peakResultBytes = Math.max(peakResultBytes, Buffer.byteLength(JSON.stringify(response.out.result)));
  assert(peakStateBytes <= 65536);
  assert(peakResultBytes <= 16384);
  calls++;
  return response.out.result;
}

const opened = call('open', {clientId: 'synthetic-tab-1', mode: 'demo'});
assert.equal(opened.ok, true);
const request = {
  session: opened.session, batchId: 1, mode: 'demo',
  rounds: Array.from({length: 10}, (_,round) => ({
    roundId: round + 1, weapon: 'flower', bet: 50,
    targets: Array.from({length: 6}, (_,target) => ({
      id: `target-${round}-${target}`, tier: 'large', characterId: 'eunbi',
    })),
  })),
};
const settled = call('settle', request);
assert.equal(settled.ok, true, JSON.stringify(settled));
assert.equal(settled.bet, 3000);
assert.equal(settled.win, 300000);
assert.equal(settled.balance, 307000);
assert.equal(settled.profile.cards.drawsAvailable, 3);
assert(settled.profile.unlockedClipIds.length > 0);
const replay = call('settle', request, .999);
assert.equal(replay.balance, settled.balance);
assert.deepEqual(replay.rounds, settled.rounds);
const drawn = call('drawCards', {session: opened.session, mode: 'demo', drawId: 1});
assert.equal(drawn.ok, true, JSON.stringify(drawn));
assert.equal(drawn.profile.cards.totalDraws, 3);
assert.equal(drawn.profile.cards.drawsAvailable, 0);
assert.equal(drawn.lastBatch.items.length, 3);
const saved = call('saveProgress', {
  session: opened.session, mode: 'demo', expectedRevision: drawn.profile.revision,
  watchedLargeClipIds: settled.profile.unlockedClipIds.filter(id => id.endsWith('-large')),
  skipSeenLargeVideos: true, bet: 20, weapon: 'rocket',
});
assert.equal(saved.ok, true, JSON.stringify(saved));
const reloaded = call('open', {clientId: 'synthetic-tab-2', mode: 'demo'});
assert.equal(reloaded.demoBalance, settled.balance);
assert.deepEqual(reloaded.profile.cards.counts, drawn.profile.cards.counts);
assert.equal(reloaded.profile.skipSeenLargeVideos, true);
assert.deepEqual(reloaded.profile.preferences, {bet: 20, weapon: 'rocket'});
assert.deepEqual(reloaded.profile.unlockedClipIds, settled.profile.unlockedClipIds);
assert.deepEqual(reloaded.profile.watchedLargeClipIds, saved.profile.watchedLargeClipIds);

// A synthetic persisted snapshot exercises the storage boundary without real wagers or a long earning loop.
state.profiles.demo.cards.drawsAvailable = 9998;
state.profiles.demo.cards.progress = 999;
const capped = call('settle', {
  session: reloaded.session, batchId: 1, mode: 'demo',
  rounds: [{roundId: 1, weapon: 'like', bet: 10,
    targets: [{id: 'cap-boundary', tier: 'small', characterId: 'original'}]}],
}, .999);
assert.equal(capped.profile.cards.drawsAvailable, 9999);
assert.equal(capped.profile.cards.progress, 0);
assert.equal(capped.profile.cards.ignoredSpend, 9);
for (let drawId = 1; drawId <= 2; drawId++) {
  const input = {session: reloaded.session, mode: 'demo', drawId};
  // Only twenty random numbers are supplied: a ten-card call cannot silently draw the remaining packs.
  const batch = call('drawCards', input, 0, 20);
  assert.equal(batch.lastBatch.size, 10);
  assert.equal(batch.lastBatch.items.length, 10);
  assert.equal(batch.profile.cards.drawsAvailable, 9999 - drawId * 10);
  assert.equal(batch.profile.cards.totalDraws, 3 + drawId * 10);
  const retry = call('drawCards', input, .999, 0);
  assert.deepEqual(retry, batch);
}
const packsReloaded = call('open', {clientId: 'synthetic-tab-3', mode: 'demo'});
assert.equal(packsReloaded.profile.cards.drawsAvailable, 9979);
assert.equal(packsReloaded.profile.cards.totalDraws, 23);
assert.equal(packsReloaded.profile.cards.counts['eunbi-n-01'], 23);
assert.deepEqual(packsReloaded.profile.unlockedClipIds, reloaded.profile.unlockedClipIds);
assert.deepEqual(packsReloaded.profile.watchedLargeClipIds, reloaded.profile.watchedLargeClipIds);
assert.equal(packsReloaded.profile.skipSeenLargeVideos, true);
const stateBytes = Buffer.byteLength(JSON.stringify(state));
assert(stateBytes <= 65536);
const resultBytes = Buffer.byteLength(JSON.stringify(settled));
assert(resultBytes <= 16384);
const report = {
  passed: true, scope: 'GoldSaucer actual asm.js QuickJS runtime with synthetic player',
  calls, functions: validated.names, stateBytes, resultBytes, peakStateBytes, peakResultBytes,
  checks: ['ten-round worst-case capture and RNG budget', 'duplicate has identical financial result',
    'server draws cards and stores counts', 'unlocks, watched clips and preferences survive a new session',
    '9999 pack cap discards overflow', 'two ten-card batches retain 9979 stored packs',
    'ten-card draw succeeds with only twenty RNG values; retry needs none',
    'remaining packs, cards and valid unlocks survive reload',
    'demo calls report zero platform chip movements', 'state and result obey platform limits'],
};
await fs.mkdir('artifacts/goldsaucer/qa', {recursive: true});
await fs.writeFile('artifacts/goldsaucer/qa/platform-functions-runtime.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
