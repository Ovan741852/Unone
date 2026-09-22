// Actual browser <-> authenticated HTTP bridge. No assistant/model requests.
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import assert from 'node:assert/strict';

const out = process.argv[2];
if (!out) throw Error('Usage: node scripts/verify-frame-atelier-bridge.mjs <new-evidence-directory>');
await mkdir(out); // Never overwrite earlier evidence.
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.UNONE_PLAYWRIGHT_MODULE || 'C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const child = spawn(process.env.UNONE_PYTHON || 'python', ['-u', fileURLToPath(new URL('./serve-frame-atelier.py', import.meta.url)), '--port', '0'], {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
let browser;
const report = {ok: false, checks: [], errors: []};
try {
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Bridge startup timeout')), 10000);
    child.once('error', e => {clearTimeout(timer); reject(e);});
    child.once('exit', code => {clearTimeout(timer); reject(Error(`Bridge exited: ${code}`));});
    let output = '';
    child.stdout.on('data', data => {
      output += data;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {clearTimeout(timer); resolve(match[0]);}
    });
  });
  child.stderr.resume();
  browser = await chromium.launch({channel: process.env.UNONE_BROWSER_CHANNEL || 'msedge', headless: true});
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  page.on('pageerror', e => report.errors.push(e.message));
  await page.route('http://127.0.0.1:8787/**', route => {report.errors.push('Unexpected model call'); return route.abort();});
  await page.goto(base + '/Unone/web/frame-atelier/');
  await page.waitForFunction(() => Boolean(window.frameAtelier));
  const {token} = await (await fetch(base + '/api/frame-atelier/session', {headers: {'X-Frame-Atelier': '1'}})).json();
  const headers = {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'};
  async function command(name, payload = {}) {
    const response = await fetch(base + '/api/frame-atelier/command', {method: 'POST', headers, body: JSON.stringify({name, payload, timeout: 10})});
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.ok, true);
    return result.result;
  }
  const before = await command('inspect');
  const added = await command('add_frame');
  assert.equal(added.frames.length, before.frames.length + 1);
  const id = added.frames.find(frame => !before.frames.some(old => old.id === frame.id)).id;
  const changed = await command('update_frame', {id, name: 'Authenticated bridge regression'});
  assert.equal(changed.frames.find(frame => frame.id === id).name, 'Authenticated bridge regression');
  await page.getByText('Authenticated bridge regression', {exact: true}).first().waitFor({state: 'visible'});
  await page.reload();
  await page.waitForFunction(() => Boolean(window.frameAtelier));
  assert.equal((await command('inspect')).frames.find(frame => frame.id === id).name, 'Authenticated bridge regression');
  report.checks.push('Authenticated inspect, add, update, visible UI and reload persistence');
  await page.screenshot({path: join(out, 'bridge-roundtrip.png'), fullPage: true});
  assert.equal((await fetch(base + '/api/frame-atelier/state', {method: 'POST', headers: {...headers, Origin: 'https://untrusted.invalid'}, body: '{}'})).status, 403);
  assert.equal((await fetch(base + '/api/frame-atelier/poll')).status, 401);
  report.checks.push('Cross-origin mutation and unauthenticated polling rejected');
  assert.deepEqual(report.errors, []);
  report.ok = true;
} catch (error) {
  report.errors.push(error.stack);
  process.exitCode = 1;
} finally {
  await browser?.close();
  child.kill(); // Only the ephemeral server created by this test.
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({...report, evidence: resolve(out)}));
}
