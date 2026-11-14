import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {CdpClient} from './cdp-client.mjs';

const address = new URL(process.argv[2] || 'http://127.0.0.1:8245/');
address.searchParams.set('debug', '1');
const source = await fs.readFile('server/goldsaucer/functions.js', 'utf8');
const storageKey = `heart-king-server-qa-${Date.now()}`;
const client = await CdpClient.connect(9237);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let targetId;
let sessionId;
const errors = [];
const evaluate = expression => client.evaluate(sessionId, expression);
async function waitFor(read, label, timeout = 40000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await sleep(60);
  }
  const detail = await evaluate(`window.hotChickDebug ? {balance:hotChickDebug.snapshot().balance,cards:hotChickDebug.snapshot().cards.drawsUsed,platform:hotChickDebug.metadata().platform} : document.body.innerText`);
  throw new Error(label + ': ' + JSON.stringify(detail));
}

const mockSource = `(() => {
  let definitions;
  const defineFunctions = value => { definitions = value; };
  ${source}
  const key = ${JSON.stringify(storageKey)};
  const callbacks = new Map();
  window.__goldQa = {calls: [], roll: .999, dropNext: true};
  const context = () => ({
    player: {id: 'qa-player', username: 'qa', displayName: 'QA'},
    chips: 0, currency: {name: '心動幣', perDiamond: 50},
    random: () => window.__goldQa.roll,
    randomInt: (min, max) => min + Math.floor(window.__goldQa.roll * (max - min + 1)),
  });
  const emit = event => { for (const callback of callbacks.get(event) || []) callback(); };
  window.GoldSaucer = {
    async init() {}, async getUser() { return {id: 'qa-player'}; },
    async getBalance() { return {balance: 0}; },
    on(event, callback) {
      const list = callbacks.get(event) || []; list.push(callback); callbacks.set(event, list);
      return () => callbacks.set(event, (callbacks.get(event) || []).filter(value => value !== callback));
    },
    chips: {
      async get() { return {currency: null, chips: 0, diamondsValue: 0, bankBalance: 0}; },
      async buyIn() { throw Error('unexpected-buy-in'); },
      async cashOut() { throw Error('unexpected-cash-out'); },
    },
    server: {async call(name, input) {
      const state = JSON.parse(localStorage.getItem(key) || 'null') || definitions.init(context());
      const out = definitions[name](state, JSON.parse(JSON.stringify(input)), context());
      localStorage.setItem(key, JSON.stringify(out.state));
      window.__goldQa.calls.push({name, batchId: input.batchId, ok: out.result?.ok, balance: out.result?.balance});
      emit('chipsChanged');
      if (name === 'settle' && window.__goldQa.dropNext) {
        window.__goldQa.dropNext = false; throw Error('synthetic-lost-response');
      }
      return {result: out.result, chips: 0, preview: true};
    }},
  };
  window.__goldQa.saved = () => JSON.parse(localStorage.getItem(key) || 'null');
})();`;

try {
  ({targetId} = await client.send('Target.createTarget', {url: 'about:blank'}));
  ({sessionId} = await client.send('Target.attachToTarget', {targetId, flatten: true}));
  await client.send('Page.enable', {}, sessionId);
  await client.send('Runtime.enable', {}, sessionId);
  await client.send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 720, deviceScaleFactor: 1, mobile: false}, sessionId);
  client.listeners.add(event => {
    if (event.sessionId === sessionId && event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails.text);
  });
  await client.send('Page.addScriptToEvaluateOnNewDocument', {source: mockSource}, sessionId);
  await client.send('Page.navigate', {url: address.href}, sessionId);
  const state = () => evaluate('window.hotChickDebug.snapshot()');
  const metadata = () => evaluate('window.hotChickDebug.metadata()');
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await waitFor(() => evaluate('Boolean(window.hotChickDebug?.ready)'), 'official player boot');
  await waitFor(async () => (await state()).platform.ready, 'financial and profile bootstrap');
  let value = await state();
  assert.equal(value.platform.mode, 'demo');
  assert.equal(value.displayBalance, 10000);
  assert.equal(value.cards.drawsAvailable, 0);
  while ((await state()).bet < 50) { await click('[data-action=BetUp]'); await sleep(150); }
  await click('[data-action=WeaponFlower]'); await sleep(150);
  value = await state();
  const target = Object.values(value.targets).find(item => item.state === 'swimming' && item.x > -7 && item.x < 6 && Math.abs(item.y) < 3);
  assert(target);
  const point = await evaluate(`(() => { const r = document.querySelector('canvas').getBoundingClientRect();return {x:r.left+(${target.x}/17.77777778+.5)*r.width,y:r.top+(.5-(${target.y}/10))*r.height};})()`);
  await client.send('Input.dispatchMouseEvent', {type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1}, sessionId);
  await sleep(75);
  await client.send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1}, sessionId);
  await click('[data-action=ToggleAuto]');
  await waitFor(async () => (await state()).stats.spent >= 1200, 'authoritative server wagers and retry');
  if ((await state()).auto) await click('[data-action=ToggleAuto]');
  await waitFor(async () => { const x = await state();return x.reservedWager === 0 && !Object.values(x.platform.requests).length; }, 'all pending wagers acknowledged');
  const beforeDraw = await state();
  assert(beforeDraw.cards.drawsAvailable >= 1);
  const calls = await evaluate('window.__goldQa.calls');
  assert(calls.filter(item => item.name === 'settle' && item.batchId === 1).length >= 2);
  const cloud = await evaluate('window.__goldQa.saved()');
  assert.equal(beforeDraw.balance, cloud.demoBalance);
  assert.equal(cloud.profiles.demo.stats.spent, beforeDraw.stats.spent);
  await click('[data-ui=skip-seen-large]');
  await waitFor(() => evaluate('window.__goldQa.saved().profiles.demo.skipSeenLargeVideos'), 'preference persisted');
  await click('[data-ui=pack]');
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-card-action=open-pack]'))`), 'pack UI');
  await click('[data-card-action=open-pack]');
  await waitFor(async () => (await state()).cards.drawsUsed > 0, 'server-owned cards received');
  const afterDraw = await state();
  const savedCards = await evaluate('window.__goldQa.saved().profiles.demo.cards');
  assert.equal(savedCards.totalDraws, beforeDraw.cards.drawsAvailable);
  assert.equal(savedCards.drawsAvailable, 0);
  await waitFor(() => evaluate(`document.querySelector('.hc-card-pack-overlay')?.dataset.phase === 'results'`), 'card reveal animation');
  const beforeReload = {balance: afterDraw.balance, counts: savedCards.counts, totalDraws: savedCards.totalDraws};
  await client.send('Page.reload', {}, sessionId);
  await waitFor(() => evaluate('Boolean(window.hotChickDebug?.ready)'), 'reloaded player boot');
  await waitFor(async () => (await state()).platform.ready, 'saved player profile restored');
  const restored = await state();
  assert.equal(restored.balance, beforeReload.balance);
  assert.equal(restored.preferences.skipSeenLargeVideos, true);
  assert.equal(restored.cards.drawsUsed, beforeReload.totalDraws);
  const counts = Object.fromEntries(Object.values(restored.cards.catalog).filter(card => card.count > 0).map(card => [card.id, card.count]));
  assert.deepEqual(counts, beforeReload.counts);
  // Force only the synthetic transport's RNG, then let the real board, hit
  // detection, receipt packets and complete video playback run normally.
  await evaluate('window.__goldQa.roll = 0');
  await click('[data-action=WeaponLike]');
  await click('[data-action=ToggleLock]');
  const large = await waitFor(async () => {
    const x = await state(); return x.reveal?.symbolTier === 'large' && !x.reveal.preview ? x.reveal : null;
  }, 'natural server-selected large reveal');
  if ((await state()).auto) await click('[data-action=ToggleAuto]');
  await waitFor(async () => (await state()).reveal?.stage === 'video', 'decoded large video');
  await sleep(1500);
  const shot = await client.send('Page.captureScreenshot', {format:'png'}, sessionId);
  await fs.writeFile('artifacts/goldsaucer/qa/browser-remote-large.png', Buffer.from(shot.data, 'base64'));
  await waitFor(() => evaluate(`window.__goldQa.saved().profiles.demo.watchedLargeClipIds.includes(${JSON.stringify(large.clipId)})`), 'complete large video watch persisted');
  const savedProfile = await evaluate('window.__goldQa.saved().profiles.demo');
  assert(savedProfile.unlockedClipIds.includes(large.clipId));
  await client.send('Page.reload', {}, sessionId);
  await waitFor(() => evaluate('Boolean(window.hotChickDebug?.ready)'), 'second reloaded player boot');
  await waitFor(async () => (await state()).platform.ready, 'unlocks and watched videos restored');
  const final = await state();
  assert(Object.values(final.watchedLargeClipIds).includes(large.clipId));
  const restoredClip = (await metadata()).gallery.characters.flatMap(character => character.styles.flatMap(style => style.items)).find(item => item.clipId === large.clipId);
  assert.equal(restoredClip.unlocked, true);
  const mainShot = await client.send('Page.captureScreenshot', {format:'png'}, sessionId);
  await fs.writeFile('artifacts/goldsaucer/qa/browser-remote-restored.png', Buffer.from(mainShot.data, 'base64'));
  assert.deepEqual(errors, []);
  const report = {
    passed: true, scope: 'official Unone player and real server source with a synthetic SDK transport',
    checks: ['server bootstrap', 'lost-response idempotent retry', 'authoritative spend and packs', 'server card draw',
      'card reveal', 'reload restores balance, counts and preference', 'natural large capture and complete playback',
      'server unlock and watched video restored'],
    spent: cloud.profiles.demo.stats.spent, cards: savedCards, watchedClip:large.clipId, errors,
  };
  await fs.mkdir('artifacts/goldsaucer/qa', {recursive: true});
  await fs.writeFile('artifacts/goldsaucer/qa/browser-remote-e2e.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  if (targetId) await client.send('Target.closeTarget', {targetId});
  client.close();
}
