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
let blockedModelRequests = 0;
const blockedModelMethods = [];
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
  await page.route('http://127.0.0.1:11435/**', route => {blockedModelRequests++; blockedModelMethods.push(route.request().method()); return route.abort();});
  await page.goto(base + '/Unone/web/frame-atelier/');
  await page.waitForFunction(() => Boolean(window.frameAtelier));
  await page.waitForFunction(() => document.querySelector('#ai-status')?.dataset.state === 'offline');
  assert.match(await page.locator('#ai-status').textContent(), /未連線/);
  assert.equal(await page.locator('#ai-submit').isDisabled(), true, 'AI submission must be disabled when Gemma is unavailable');
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
  await page.waitForTimeout(350);
  const history = await command('get_change_history', {limit: 10});
  assert.ok(history.total > 0);
  const inspectWithHistory = await command('inspect', {includeHistory: true, historyLimit: 10});
  assert.ok(inspectWithHistory.change_history.total > 0);
  assert.equal(inspectWithHistory.change_history.project, inspectWithHistory.project.name);
  assert.ok(history.entries.some(entry => entry.source === 'manual' && (
    entry.changes.added.some(item => item.id === id && item.name === 'Authenticated bridge regression') ||
    entry.changes.updated.some(change => change.after.id === id && change.after.name === 'Authenticated bridge regression')
  )));
  await page.getByText('修改紀錄', {exact: true}).waitFor({state: 'visible'});
  const bgState = await command('add_element', {type: 'container', parentId: null, name: 'bg', layoutMode: 'vertical', rect: {x: 40, y: 20, width: 20, height: 34}});
  const bgId = bgState.elements.find(item => item.name === 'bg').id;
  const equipState = await command('add_element', {type: 'panel', parentId: bgId, name: 'equip_bg', variant: 'strong', rect: {x: 5, y: 5, width: 78, height: 78}});
  const equipId = equipState.elements.find(item => item.name === 'equip_bg').id;
  const partState = await command('add_element', {type: 'image', parentId: equipId, name: 'part_icon', variant: 'watermark', visible: true, rect: {x: 14, y: 14, width: 72, height: 72}});
  const partId = partState.elements.find(item => item.name === 'part_icon').id;
  const itemState = await command('add_element', {type: 'image', parentId: equipId, name: 'equip_icon', variant: 'icon', visible: false, rect: {x: 14, y: 14, width: 72, height: 72}});
  const itemId = itemState.elements.find(item => item.name === 'equip_icon').id;
  await command('add_element', {type: 'label', parentId: bgId, name: 'equip_name', text: '裝備名稱', rect: {x: 5, y: 5, width: 90, height: 14}});
  const hierarchy = await command('inspect');
  const bgNode = hierarchy.unone_ui.children.find(item => item.id === bgId);
  const slotNode = bgNode.children.find(item => item.id === equipId);
  assert.deepEqual(slotNode.children.map(item => item.name), ['part_icon', 'equip_icon']);
  assert.equal(bgNode.children.find(item => item.name === 'equip_name').id, hierarchy.elements.find(item => item.name === 'equip_name').id);
  assert.deepEqual(slotNode.children[0].rect, slotNode.children[1].rect);
  assert.equal(hierarchy.elements.find(item => item.id === itemId).visible, false);
  await command('select_element', {id: itemId});
  assert.equal(await page.locator('.inspector-content [data-field="visible"]').isChecked(), false);
  const itemRow = page.locator('.tree-row[data-id="' + itemId + '"]');
  await itemRow.locator('[data-toggle-visibility]').click();
  assert.equal((await command('inspect')).elements.find(item => item.id === itemId).visible, true);
  await itemRow.locator('[data-toggle-visibility]').click();
  assert.equal((await command('inspect')).elements.find(item => item.id === itemId).visible, false);
  report.checks.push('Nested equipment-slot tree, overlay alignment, independent image visibility, and layer eye toggling');
  const cardState = await command('add_element', {type: 'container', name: 'History test card', rect: {x: 10, y: 10, width: 30, height: 35}});
  const cardId = cardState.elements.find(item => item.name === 'History test card').id;
  const childState = await command('add_element', {type: 'container', name: 'Cascade parent', parentId: cardId});
  const childId = childState.elements.find(item => item.name === 'Cascade parent').id;
  const leafState = await command('add_element', {type: 'label', name: 'Cascade leaf', parentId: childId});
  const leafId = leafState.elements.find(item => item.name === 'Cascade leaf').id;
  const beforeOfflinePrompt = await command('inspect');
  const prompt = '這是道具卡片，上方放 Icon，下方放文字';
  await page.locator('#ai-prompt').fill(prompt);
  await page.locator('#ai-prompt').press('Enter');
  assert.equal(await page.locator('#ai-prompt').inputValue(), prompt, 'Prompt must be preserved while offline');
  assert.match(await page.locator('#toast').textContent(), /未連線/);
  assert.equal(await page.locator('#ai-submit').isDisabled(), true);
  assert.deepEqual((await command('inspect')).elements, beforeOfflinePrompt.elements, 'Offline AI attempt must not modify the canvas');
  const cardRow = page.locator('.tree-row[data-id="' + cardId + '"]');
  const cardToggle = cardRow.locator(':scope > .tree-row-content > [data-tree-toggle]');
  await cardToggle.waitFor({state: 'visible'});
  await cardToggle.click();
  assert.equal(await cardRow.getAttribute('aria-expanded'), 'false');
  assert.equal(await cardRow.locator(':scope > .tree-children').isHidden(), true);
  await cardToggle.click();
  assert.equal(await cardRow.getAttribute('aria-expanded'), 'true');
  assert.equal(await cardRow.locator(':scope > .tree-children').isVisible(), true);
  const beforeCascadeDelete = await command('inspect');
  const removedBranch = new Set([cardId]);
  let foundChild = true;
  while (foundChild) {
    foundChild = false;
    for (const item of beforeCascadeDelete.elements) if (removedBranch.has(item.parentId) && !removedBranch.has(item.id)) { removedBranch.add(item.id); foundChild = true; }
  }
  assert.ok(removedBranch.has(childId));
  assert.ok(removedBranch.has(leafId));
  const deleteAction = cardRow.locator(':scope > .tree-row-content > [data-delete-node]');
  await page.mouse.move(500, 400);
  assert.ok(Number(await deleteAction.evaluate(element => getComputedStyle(element).opacity)) > 0);
  await deleteAction.hover();
  await deleteAction.click();
  await cardRow.waitFor({state: 'detached'});
  const afterCascadeDelete = await command('inspect');
  assert.ok(afterCascadeDelete.elements.every(item => !removedBranch.has(item.id)));
  assert.match(await page.locator('#toast').textContent(), /可按 Ctrl\+Z 復原/);
  await page.keyboard.press('Control+z');
  const afterUndo = await command('inspect');
  assert.ok([...removedBranch].every(branchId => afterUndo.elements.some(item => item.id === branchId)));
  const aiHistory = await command('get_change_history', {limit: 50});
  assert.equal(aiHistory.entries.some(entry => entry.prompt === prompt), false, 'An offline prompt must not be reported as an AI result');
  await page.locator('#change-history').evaluate(element => {element.open = true;});
  const historyBounds = await page.locator('#change-history').evaluate(element => {
    const own = element.getBoundingClientRect(), parent = element.parentElement.getBoundingClientRect();
    return {height: own.height, top: own.top, bottom: own.bottom, parentTop: parent.top, parentBottom: parent.bottom};
  });
  assert.ok(historyBounds.height >= 42 && historyBounds.top >= historyBounds.parentTop && historyBounds.bottom <= historyBounds.parentBottom + 1, JSON.stringify(historyBounds));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.frameAtelier));
  await page.waitForFunction(() => document.querySelector('#ai-status')?.dataset.state === 'offline');
  assert.equal((await command('inspect')).frames.find(frame => frame.id === id).name, 'Authenticated bridge regression');
  assert.ok((await command('get_change_history', {limit: 10})).total > 0);
  report.history_bounds_after_reload = await page.locator('#change-history').evaluate(element => {
    const own = element.getBoundingClientRect(), parent = element.parentElement.getBoundingClientRect();
    return {top: own.top, bottom: own.bottom, parentTop: parent.top, parentBottom: parent.bottom, height: own.height};
  });
  assert.equal(blockedModelRequests, 2, 'Only one connection check should run per page load; offline submission must not call the model');
  assert.ok(blockedModelMethods.every(method => method === 'GET'), JSON.stringify(blockedModelMethods));
  report.checks.push('Authenticated inspect, add, update, history through legacy inspect command, visible offline warning, disabled AI submission, preserved prompt, unchanged canvas, collapsible tree rows, cascading deletion with undo, visible history and reload persistence');
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
