// Actual browser <-> authenticated HTTP bridge. Codex and asset services are stubbed for deterministic UI tests.
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
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
let mockCodex = false;
let mockPlanningCalls = 0;
let mockStructureCalls = 0;
let signalFirstPlan;
let releaseFirstPlan;
const firstPlanStarted = new Promise(resolve => { signalFirstPlan = resolve; });
const firstPlanGate = new Promise(resolve => { releaseFirstPlan = resolve; });
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
  await page.route('http://127.0.0.1:11435/**', async route => {
    blockedModelRequests++;
    blockedModelMethods.push(route.request().method());
    return route.abort();
  });
  await page.route('**/api/frame-atelier/codex/status', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({ready: mockCodex, installed: mockCodex, authenticated: mockCodex, provider: 'codex-cli', version: mockCodex ? 'codex-cli 0.144.1' : '', path: ''})}));
  await page.route('**/api/frame-atelier/codex/generate', async route => {
    if (!mockCodex) return route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({ok: false, error: 'CODEX_CLI_NOT_READY'})});
    const {operation} = route.request().postDataJSON();
    if (operation === 'plan') {
      const call = mockPlanningCalls++;
      if (call === 0) {
        signalFirstPlan();
        await firstPlanGate;
      }
      return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({ok: true, result: {planning: '整理需求：新增一個描述標籤。'}})});
    }
    const call = mockStructureCalls++;
    const childName = call === 0 ? 'AI status addition' : 'AI status discarded';
    return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({ok: true, result: {
      analysis: '新增一個標籤。',
      panel_update: {name: null, purpose: null, type: call === 0 ? 'image' : null, variant: null, rect: null},
      children: [{id: 'mock-child-' + call, role: 'label', label: childName, purpose: 'Status test', rect: {x: 5, y: 6, width: 85, height: 12}}],
    }})});
  });
  const samplePng = await readFile(new URL('../_Tools/replay-acceptance-20260910/project/assets/sky_forest_dusk.png', import.meta.url));
  const testAssetUrl = '/Unone/web/frame-atelier/assets/imported/asset-00000000000000000000000000000001.png';
  await page.route('**/api/frame-atelier/assets/import', async route => {
    assert.equal(route.request().headers()['content-type'], 'image/png');
    assert.equal(route.request().postDataBuffer().byteLength, samplePng.byteLength);
    return route.fulfill({status: 201, contentType: 'application/json', body: JSON.stringify({ok: true, asset_url: testAssetUrl, media_type: 'image/png', bytes: samplePng.byteLength})});
  });
  await page.route('**' + testAssetUrl, route => route.fulfill({status: 200, contentType: 'image/png', body: samplePng}));
  await page.goto(base + '/Unone/web/frame-atelier/');
  await page.waitForFunction(() => Boolean(window.frameAtelier));
  await page.waitForFunction(() => document.querySelector('#ai-status')?.dataset.state === 'offline');
  assert.match(await page.locator('#ai-status').textContent(), /未就緒/);
  assert.equal(await page.locator('#ai-submit').isDisabled(), true, 'AI submission must be disabled when Codex CLI is unavailable');
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
  const partState = await command('add_element', {type: 'image', parentId: equipId, name: 'part_icon', visible: true, rect: {x: 14, y: 14, width: 72, height: 72}});
  const partId = partState.elements.find(item => item.name === 'part_icon').id;
  const itemState = await command('add_element', {type: 'image', parentId: equipId, name: 'equip_icon', visible: false, rect: {x: 14, y: 14, width: 72, height: 72}});
  const itemId = itemState.elements.find(item => item.name === 'equip_icon').id;
  await command('select_element', {id: equipId});
  const typePicker = page.locator('.inspector-content [data-field="type"]');
  assert.ok(await typePicker.locator('option[value="image"]').count(), 'Image must be available as a parent node type');
  await typePicker.selectOption('image');
  await page.waitForFunction(id => window.frameAtelier.inspect().elements.find(item => item.id === id)?.type === 'image', equipId);
  const convertedHierarchy = await command('inspect');
  assert.deepEqual(convertedHierarchy.elements.filter(item => item.parentId === equipId).map(item => item.name), ['part_icon', 'equip_icon'], 'Changing Panel to Image must preserve its children');
  const imageChild = await command('add_element', {type: 'label', parentId: equipId, name: 'image_child_probe'});
  const imageChildId = imageChild.elements.find(item => item.name === 'image_child_probe').id;
  assert.equal(imageChild.elements.find(item => item.id === imageChildId).parentId, equipId, 'New components must be allowed under an Image parent');
  await command('delete_element', {id: imageChildId});
  assert.equal(await page.locator('.inspector-content [data-field="variant"]').count(), 0, 'Image nodes must not offer misleading display presets');
  assert.match(await page.locator('.image-source-field').textContent(), /使用專案既有圖片/);
  assert.match(await page.locator('.image-source-field').textContent(), /ImageGen/);
  assert.equal(await page.locator('.image-source-field [data-field="assetUrl"]').isDisabled(), true, 'Existing-image choice is disabled until the project has an imported image');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('.image-import-field [data-action="import-image"]').click();
  await (await chooserPromise).setFiles({name: 'imagegen-test.png', mimeType: 'image/png', buffer: samplePng});
  await page.waitForFunction(({id, assetUrl}) => window.frameAtelier.inspect().elements.find(item => item.id === id)?.assetUrl === assetUrl, {id: equipId, assetUrl: testAssetUrl});
  assert.ok(await page.locator('.scene-node[data-node-id="' + equipId + '"] > .node-face .image-asset').evaluate(image => image.complete && image.naturalWidth > 0), 'The parent Image must render its imported background asset');
  assert.equal(await page.locator('.scene-node[data-node-id="' + equipId + '"] > .scene-node[data-node-id="' + partId + '"]').count(), 1, 'Children must remain nested above the Image background');
  assert.equal((await command('inspect')).elements.find(item => item.id === equipId).assetUrl, testAssetUrl);
  await page.locator('.inspector-panel').screenshot({path: join(out, 'image-parent-with-children.png')});
  report.checks.push('Panel can be converted to an Image parent without losing children; imported image renders beneath nested components');
  report.checks.push('Image source offers project reuse or new-image import after Codex ImageGen; no misleading display-style selector');
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
  await command('select_element', {id: itemId});
  await page.screenshot({path: join(out, 'image-source-inspector.png'), fullPage: true});
  await page.locator('.inspector-panel').screenshot({path: join(out, 'image-source-inspector-panel.png')});
  assert.equal(await page.locator('.inspector-content [data-field="assetUrl"]').isDisabled(), false, 'An imported image must be available to other Image nodes');
  await page.locator('.inspector-content [data-field="assetUrl"]').selectOption(testAssetUrl);
  await page.waitForFunction(({id, assetUrl}) => window.frameAtelier.inspect().elements.find(item => item.id === id)?.assetUrl === assetUrl, {id: itemId, assetUrl: testAssetUrl});
  assert.ok(await page.locator('.scene-node[data-node-id="' + itemId + '"] .image-asset').evaluate(image => image.complete && image.naturalWidth > 0), 'A project image must be reusable by another image node');
  report.checks.push('Existing project image can be selected and reused on a second image node');
  report.checks.push('Nested equipment-slot tree, overlay alignment, independent image visibility, and layer eye toggling');
  const rootLeaf = await command('add_element', {type: 'label', parentId: null, name: 'ROOT'});
  const rootId = rootLeaf.elements.find(item => item.name === 'ROOT').id;
  await command('select_element', {id: rootId});
  assert.ok(await page.locator('.inspector-content [data-field="type"] option[value="image"]').count(), 'A top-level leaf must be convertible to an Image parent');
  await page.locator('.inspector-content [data-field="type"]').selectOption('image');
  await page.waitForFunction(id => window.frameAtelier.inspect().elements.find(item => item.id === id)?.type === 'image', rootId);
  const rootChild = await command('add_element', {type: 'label', parentId: rootId, name: 'root_child_probe'});
  assert.equal(rootChild.elements.find(item => item.name === 'root_child_probe').parentId, rootId, 'The converted root Image must accept child elements');
  await command('delete_element', {id: rootId});
  report.checks.push('A root leaf can switch to Image and then accept nested child elements');
  const textParent = await command('add_element', {type: 'label', parentId: null, name: 'text_parent_probe'});
  const textParentId = textParent.elements.find(item => item.name === 'text_parent_probe').id;
  const buttonChild = await command('add_element', {type: 'button', parentId: textParentId, name: 'button_child_probe'});
  const buttonChildId = buttonChild.elements.find(item => item.name === 'button_child_probe').id;
  const nestedImage = await command('add_element', {type: 'image', parentId: buttonChildId, name: 'nested_image_probe'});
  const nestedImageId = nestedImage.elements.find(item => item.name === 'nested_image_probe').id;
  await command('select_element', {id: nestedImageId});
  assert.ok(await page.locator('.inspector-content [data-field="parentId"] option[value="' + textParentId + '"]').count(), 'A Label must be offered as a valid parent');
  const cycleResponse = await fetch(base + '/api/frame-atelier/command', {method: 'POST', headers, body: JSON.stringify({name: 'set_parent', payload: {id: textParentId, parentId: nestedImageId}, timeout: 10})});
  assert.equal(cycleResponse.status, 422, 'A descendant must not be assignable as its own ancestor');
  assert.equal((await cycleResponse.json()).error, 'INVALID_PARENT');
  const atomicCycleResponse = await fetch(base + '/api/frame-atelier/command', {method: 'POST', headers, body: JSON.stringify({name: 'update_element', payload: {id: textParentId, parentId: nestedImageId, name: 'must_remain_unchanged'}, timeout: 10})});
  assert.equal(atomicCycleResponse.status, 422, 'An invalid parent update must be rejected before applying any other fields');
  assert.equal((await atomicCycleResponse.json()).error, 'INVALID_PARENT');
  const generalizedParents = await command('inspect');
  assert.equal(generalizedParents.elements.find(item => item.id === buttonChildId).parentId, textParentId);
  assert.equal(generalizedParents.elements.find(item => item.id === nestedImageId).parentId, buttonChildId);
  assert.equal(generalizedParents.elements.find(item => item.id === textParentId).name, 'text_parent_probe');
  await command('delete_element', {id: textParentId});
  report.checks.push('Label and Button can own children; parent choices expose all node kinds while cyclic parenting is rejected');
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
  assert.match(await page.locator('#toast').textContent(), /未就緒/);
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
  mockCodex = true;
  const beforeReview = await page.evaluate(() => window.frameAtelier.inspect());
  const applyingReview = command('decompose_panel', {id: cardId, prompt: 'Add a status label'});
  await firstPlanStarted;
  await page.waitForFunction(() => document.querySelector('#ai-status')?.dataset.state === 'busy' && /1\/2/.test(document.querySelector('#ai-status')?.textContent || ''));
  assert.match(await page.locator('#ai-status').textContent(), /1\/2/);
  releaseFirstPlan();
  await page.locator('#ai-review-dialog[open]').waitFor({state: 'visible'});
  assert.match(await page.locator('#ai-review-list').textContent(), /AI status addition/);
  assert.match(await page.locator('#ai-review-summary').textContent(), /左側 Before.*右側 After/);
  assert.match(await page.locator('#ai-review-before-title').textContent(), /Before.*變更前/);
  assert.match(await page.locator('#ai-review-after-title').textContent(), /After.*提案後/);
  assert.equal(await page.locator('#ai-review-before .scene-node[data-node-id="' + cardId + '"]').getAttribute('class').then(value => value.includes('type-container')), true);
  assert.equal(await page.locator('#ai-review-after .scene-node[data-node-id="' + cardId + '"]').getAttribute('class').then(value => value.includes('type-image')), true, 'The After preview must show the AI-proposed parent type');
  assert.equal(await page.locator('#ai-review-before .scene-node[aria-label="AI status addition"]').count(), 0);
  const addedPreview = page.locator('#ai-review-after .scene-node[aria-label="AI status addition"]');
  assert.equal(await addedPreview.count(), 1, 'The proposed node must appear only in the after canvas');
  assert.equal(await addedPreview.getAttribute('data-review-kind'), 'added');
  assert.equal(await page.locator('#ai-review-after .ai-review-marker[data-node-id="' + await addedPreview.getAttribute('data-node-id') + '"]').getAttribute('data-review-label'), '新增');
  const reviewDialogBounds = await page.locator('#ai-review-dialog').evaluate(element => element.getBoundingClientRect().height);
  assert.ok(reviewDialogBounds < 850, `Review dialog should fit its content instead of filling the viewport (${reviewDialogBounds}px)`);
  assert.deepEqual((await page.evaluate(() => window.frameAtelier.inspect())).elements, beforeReview.elements, 'AI changes must stay unapplied while the diff is open');
  await page.screenshot({path: join(out, 'review-visual-before-apply.png'), fullPage: true});
  await page.locator('#ai-review-apply').click();
  const applied = await applyingReview;
  assert.ok(applied.elements.some(item => item.name === 'AI status addition'));
  assert.equal(applied.elements.find(item => item.id === cardId).type, 'image', 'Applying the AI diff must convert the selected parent to Image');
  assert.ok(applied.elements.some(item => item.id === childId && item.parentId === cardId), 'Changing a parent visual type must retain its existing descendants');
  assert.equal(await page.locator('#ai-status').getAttribute('data-state'), 'done');
  await page.waitForTimeout(2500);
  assert.match(await page.locator('#ai-status').textContent(), /完成/ , 'Completion status must remain after the toast disappears');
  const discardingReview = command('decompose_panel', {id: cardId, prompt: 'Add another status label'});
  await page.locator('#ai-review-dialog[open]').waitFor({state: 'visible'});
  assert.match(await page.locator('#ai-review-list').textContent(), /AI status discarded/);
  assert.equal((await page.evaluate(() => window.frameAtelier.inspect())).elements.some(item => item.name === 'AI status discarded'), false);
  await page.locator('#ai-review-dialog button[value="cancel"]').last().click();
  const discarded = await discardingReview;
  assert.equal(discarded.elements.some(item => item.name === 'AI status discarded'), false, 'Rejecting the diff must preserve the original canvas');
  assert.match(await page.locator('#ai-status').textContent(), /已取消/);
  mockCodex = false;
  report.checks.push('Codex two-stage progress/completion feedback; left-before/right-after visual review highlights additions, keeps proposed edits unapplied until confirmation, and preserves apply/reject behavior');
  await page.reload();
  await page.waitForFunction(() => Boolean(window.frameAtelier));
  await page.waitForFunction(() => document.querySelector('#ai-status')?.dataset.state === 'offline');
  assert.equal((await command('inspect')).frames.find(frame => frame.id === id).name, 'Authenticated bridge regression');
  assert.ok((await command('get_change_history', {limit: 10})).total > 0);
  report.history_bounds_after_reload = await page.locator('#change-history').evaluate(element => {
    const own = element.getBoundingClientRect(), parent = element.parentElement.getBoundingClientRect();
    return {top: own.top, bottom: own.bottom, parentTop: parent.top, parentBottom: parent.bottom, height: own.height};
  });
  assert.equal(blockedModelRequests, 0, 'Frame Atelier must not call the removed Ollama/Gemma service');
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
