import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as capture from './capture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, 'cli.mjs');
const fixture = path.join(here, 'example/home.html');
const actions = path.join(here, 'example/actions.json');

test('imports responsive native nodes, original actions, inline fragments and isolated decorations', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'unone-view-'));
  try {
    const processResult = spawnSync(
      process.execPath,
      [
        cli,
        '--file',
        fixture,
        '--selector',
        '#home',
        '--actions',
        actions,
        '--viewport',
        '720x400',
        '--viewport',
        '400x720',
        '--out',
        dir
      ],
      { encoding: 'utf8', timeout: 60000 }
    );
    assert.equal(processResult.status, 0, processResult.stderr);
    const data = JSON.parse(await readFile(path.join(dir, 'views.json'), 'utf8'));
    const luau = await readFile(path.join(dir, 'views.luau'), 'utf8');
    assert.match(luau, /return\s*\{/);
    assert.equal(data.version, 1);
    const wide = data.views['720x400'],
      narrow = data.views['400x720'];
    assert.ok(wide.width > narrow.width && wide.height < narrow.height);
    for (const view of [wide, narrow]) {
      assert.equal(view.root.kind, 'screen');
      assert.ok(view.root.node);
      const nodes = view.root.children;
      assert.equal(new Set(nodes.map((n) => n.id)).size, nodes.length);
      for (const n of nodes) {
        const { x, y, width, height } = n.rect;
        assert.ok(
          x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 100.001 && y + height <= 100.001,
          n.id
        );
      }
      const start = nodes.find((n) => n.action === 'StartGame');
      assert.equal(start.kind, 'button');
      assert.equal(start.text, '開始遊戲');
      const party = nodes.find((n) => n.action === 'OpenParty');
      assert.equal(party.kind, 'input_region');
      assert.equal(nodes.filter((n) => n.action).length, 2);
      assert.ok(nodes.some((n) => n.kind === 'panel' && n.style?.background));
      assert.ok(nodes.some((n) => n.kind === 'text' && n.text.trim() === '開始'));
      assert.ok(nodes.some((n) => n.kind === 'text' && n.text === '組隊' && n.style.font_weight >= 600));
      assert.ok(nodes.some((n) => n.kind === 'image' && n.alt === 'blue'));
      assert.ok(!nodes.some((n) => n.text?.includes('不應匯出')));
      const surfaces = nodes.filter((n) => n.kind === 'image' && n.background_for && n.rect.height > 10);
      assert.equal(surfaces.length, 2);
      assert.equal(
        surfaces[0].asset,
        surfaces[1].asset,
        'identically styled cards with different contents must share decoration'
      );
      assert.ok(nodes.indexOf(surfaces[0]) < nodes.indexOf(party));
    }
    for (const asset of data.assets) {
      assert.equal(asset.kind, 'texture2d');
      const bytes = await readFile(path.join(dir, asset.source));
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    }
    assert.ok(data.assets.length >= 2);
    const icon = wide.root.children.find((n) => n.alt === 'blue');
    const imageFile = data.assets.find((a) => a.id === icon.asset);
    const imageBytes = await readFile(path.join(dir, imageFile.source));
    const browser = await capture.launchBrowser();
    try {
      const page = await browser.newPage();
      const alpha = await page.evaluate(async (encoded) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + encoded;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const c = canvas.getContext('2d');
        c.drawImage(img, 0, 0);
        return [
          c.getImageData(0, 0, 1, 1).data[3],
          c.getImageData(img.width >> 1, img.height >> 1, 1, 1).data[3]
        ];
      }, imageBytes.toString('base64'));
      assert.deepEqual(alpha, [0, 255], 'native PNG must keep both transparent and opaque pixels');
    } finally {
      await browser.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('help and argument errors work without a browser', () => {
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--viewport/);
  assert.match(help.stdout, /1280x720/);
  const bad = spawnSync(
    process.execPath,
    [cli, '--file', fixture, '--selector', 'main', '--viewport', 'bad', '--out', '.'],
    { encoding: 'utf8' }
  );
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /viewport/i);
});

test('browser discovery prefers Playwright, then an installed system browser, with a clear missing-browser message', async () => {
  const launches = [];
  const mock = {
    executablePath: () => '/playwright/chrome',
    launch: async (o) => {
      launches.push(o.executablePath);
      if (!o.executablePath) throw new Error('headless shell missing');
      return o.executablePath;
    }
  };
  assert.equal(
    await capture.findAndLaunch(mock, { candidates: ['/system/edge'], exists: async () => true }),
    '/playwright/chrome'
  );
  assert.equal(
    await capture.findAndLaunch(mock, {
      candidates: ['/system/edge'],
      exists: async (p) => p === '/system/edge'
    }),
    '/system/edge'
  );
  assert.equal(await capture.findAndLaunch(mock, { explicit: '/custom/chrome' }), '/custom/chrome');
  await assert.rejects(
    capture.findAndLaunch(mock, { candidates: [], exists: async () => false }),
    /install chromium.*--browser/i
  );
});

test('native text keeps its measured left edge and room for different glyph metrics up to its nearest neighbor or clip', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'unone-text-width-'));
  try {
    const file = path.join(dir, 'text.html');
    await writeFile(
      file,
      `<style>*{box-sizing:border-box}body{margin:0}main{width:400px;height:160px;font:18px/24px Arial}section{width:250px;padding:0 20px 0 10px}
      .row{width:320px}.row span+span{margin-left:24px}.clip{width:90px;overflow:hidden;font-family:system-ui;opacity:.5}.clip div{width:300px}</style>
      <main><section data-unone-bind="title">和三隻電腦馬上開始</section>
        <div class="row"><span data-unone-bind="a">one</span><span data-unone-bind="b">two</span></div>
        <div class="clip"><div data-unone-bind="clip">文字</div></div></main>`
    );
    await promisify(execFile)(process.execPath, [cli, '--file', file, '--selector', 'main', '--out', dir]);
    const view = JSON.parse(await readFile(path.join(dir, 'views.json'), 'utf8')).views['1280x720'];
    const text = (name) =>
      view.root.children.find((n) => n.kind === 'text' && view.bindings[name].includes(n.id)).rect;
    const left = (r) => (r.x * view.width) / 100;
    const right = (r) => ((r.x + r.width) * view.width) / 100;
    assert.ok(Math.abs(left(text('title')) - 10) < 0.01);
    assert.ok(
      Math.abs(right(text('title')) - 230) < 0.01,
      'a standalone subtitle must reach the content edge'
    );
    assert.ok(
      Math.abs(right(text('a')) - left(text('b'))) < 0.01,
      'inline text may use the gap but not the next label'
    );
    assert.ok(Math.abs(right(text('b')) - 320) < 0.01);
    assert.ok(Math.abs(right(text('clip')) - 90) < 0.01);
    const clipped = view.root.children.find((n) => n.kind === 'text' && view.bindings.clip.includes(n.id));
    assert.equal(clipped.style.opacity, 0.5);
    assert.equal(
      clipped.style.font_family,
      undefined,
      'CSS system-ui uses the native project presentation font'
    );
    assert.equal(
      view.root.children.find((n) => view.bindings.title.includes(n.id) && n.kind === 'text').style
        .font_family,
      'Arial'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('captures a prepared URL, selector bounds and bindings; the child action wins a native hit', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/image.svg') {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>'
      );
    } else
      res.end(`<style>*{box-sizing:border-box}body{margin:0}main{position:absolute;left:18px;top:27px;width:340px;height:150px;background:white}button{width:75px;font-size:18px}</style>
      <main data-unone-action="Parent"><img src="/image.svg" alt="remote"><span id="label"></span>
      <button data-unone-action="Child">Some long wrapped button text</button></main>`);
  });
  const dir = await mkdtemp(path.join(os.tmpdir(), 'unone-url-'));
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const prepare = path.join(dir, 'prepare.mjs');
    await writeFile(
      prepare,
      "export default async page=>{await page.locator('#label').evaluate(el=>{el.textContent='Bound name';el.dataset.unoneBind='name'})}"
    );
    const { port } = server.address();
    await promisify(execFile)(process.execPath, [
      cli,
      '--url',
      'http://127.0.0.1:' + port,
      '--selector',
      'main',
      '--prepare',
      prepare,
      '--out',
      dir
    ]);
    const view = JSON.parse(await readFile(path.join(dir, 'views.json'), 'utf8')).views['1280x720'];
    assert.deepEqual(view.bounds, { x: 18, y: 27, width: 340, height: 150 });
    assert.deepEqual(view.viewport, { width: 1280, height: 720 });
    const nodes = view.root.children;
    assert.equal(nodes.find((n) => n.id === view.bindings.name[0]).text, 'Bound name');
    const child = nodes.find((n) => n.action === 'Child');
    assert.equal(child.kind, 'input_region', 'multi-line native controls need individual text lines');
    assert.ok(
      nodes.findIndex((n) => n.action === 'Parent') < nodes.indexOf(child),
      'native reverse hit testing must choose the child'
    );
    assert.ok(
      nodes
        .filter((n) => n.kind === 'text')
        .map((n) => n.text.trim())
        .join(' ')
        .includes('Some long wrapped button text')
    );
    assert.ok(nodes.some((n) => n.alt === 'remote' && n.asset));
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
