import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {CdpClient} from './cdp-client.mjs';

const address = new URL(process.argv[2] || 'http://127.0.0.1:8244/');
const reportPath = process.argv[3] || 'artifacts/goldsaucer/qa/browser-package.json';
const client = await CdpClient.connect(9237);
const errors = [];
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let targetId;
let sessionId;
const evaluate = expression => client.evaluate(sessionId, expression);
async function waitFor(read, label, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await sleep(80);
  }
  throw new Error(label);
}

try {
  const manifest = await (await fetch(new URL('goldsaucer.json', address))).json();
  assert.equal(manifest.sdk.inject, true);
  assert.equal(manifest.orientation, 'landscape');
  if (manifest.functions) {
    assert.equal(manifest.functions, 'server/functions.js');
    assert.equal(manifest.currency.name, '心動幣');
    assert.equal(manifest.currency.perDiamond, 50);
    assert.equal(manifest.currency.autoBuyIn, true);
    assert.equal(manifest.currency.autoCashOut, false);
  }
  const index = await (await fetch(address)).text();
  assert(!index.includes('<base '));
  ({targetId} = await client.send('Target.createTarget', {url: 'about:blank'}));
  ({sessionId} = await client.send('Target.attachToTarget', {targetId, flatten: true}));
  await client.send('Page.enable', {}, sessionId);
  await client.send('Runtime.enable', {}, sessionId);
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 720, deviceScaleFactor: 1, mobile: false,
  }, sessionId);
  client.listeners.add(event => {
    if (event.sessionId === sessionId && event.method === 'Runtime.exceptionThrown') {
      errors.push(event.params.exceptionDetails.text);
    }
  });
  await client.send('Page.addScriptToEvaluateOnNewDocument', {source: `(() => {
    const listeners = new Map();
    window.__goldQa = {emit(event) { for (const callback of listeners.get(event) || []) callback(); }};
    window.GoldSaucer = {
      async init() {}, async getUser() { return {id: 'qa'}; },
      async getBalance() { return {balance: 9}; },
      on(event, callback) {
        const callbacks = listeners.get(event) || [];
        callbacks.push(callback); listeners.set(event, callbacks);
        return () => listeners.set(event, (listeners.get(event) || []).filter(item => item !== callback));
      },
    };
  })();`}, sessionId);
  const testAddress = new URL(address);
  testAddress.searchParams.set('debug', '1');
  await client.send('Page.navigate', {url: testAddress.href}, sessionId);
  await waitFor(() => evaluate('window.hotChickDebug?.ready'), 'flattened official player boot');
  const state = () => evaluate('window.hotChickDebug.snapshot()');
  const metadata = () => evaluate('window.hotChickDebug.metadata()');
  await waitFor(async () => (await metadata()).platform?.status === 'ready' && !(await state()).platform.paused, 'mock SDK initialized and startup pause released');
  await evaluate(`document.querySelector('[data-ui=tools]').click()`);
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-ui="preview-stack"]'))`), 'tools ready');
  await evaluate(`document.querySelector('[data-ui="preview-stack"]').click()`);
  const playing = await waitFor(async () => {
    const value = await metadata();
    return value.activeMediumDecoders === 6 &&
      value.mediumPlayers.filter(player => player.currentTime > 0.05 && !player.paused).length === 6 ? value : null;
  }, 'six concurrent videos playing');
  await evaluate(`window.__goldQa.emit('pause')`);
  await waitFor(async () => (await state()).platform.paused, 'native pause acknowledged');
  const before = await metadata();
  await sleep(800);
  const paused = await metadata();
  assert(paused.mediumPlayers.every(player => player.paused));
  for (const player of paused.mediumPlayers) {
    const previous = before.mediumPlayers.find(item => item.serial === player.serial);
    assert(Math.abs(player.currentTime - previous.currentTime) < 0.08);
  }
  await evaluate(`window.__goldQa.emit('resume')`);
  await waitFor(async () => (await metadata()).mediumPlayers.some(player => {
    const previous = paused.mediumPlayers.find(item => item.serial === player.serial);
    return previous && !player.paused && player.currentTime > previous.currentTime + 0.08;
  }), 'media resumed');
  const final = await state();
  assert.equal(final.stats.spent, 0);
  assert.equal(final.stats.won, 0);
  assert.equal(final.displayBalance, 10000);
  assert.equal((await fetch(new URL('cover.webp', address))).status, 200);
  assert.deepEqual(errors, []);
  const report = {
    passed: true, url: address.href, scope: 'flattened official player with mocked platform SDK',
    checks: ['official player boot', 'root SDK manifest and landscape', 'six concurrent videos pause and resume',
      'preview has no money effects', 'cover available'],
    videoSources: playing.mediumPlayers.map(player => player.source), errors,
  };
  await fs.mkdir('artifacts/goldsaucer/qa', {recursive: true});
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  if (targetId) await client.send('Target.closeTarget', {targetId});
  client.close();
}
