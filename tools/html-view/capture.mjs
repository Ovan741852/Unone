import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { measure } from './dom.mjs';

function installedBrowsers() {
  if (process.platform === 'win32') {
    return [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
      .filter(Boolean)
      .flatMap((base) =>
        [
          'Google/Chrome/Application/chrome.exe',
          'Microsoft/Edge/Application/msedge.exe',
          'Chromium/Application/chrome.exe'
        ].map((name) => path.join(base, name))
      );
  }
  if (process.platform === 'darwin') {
    return ['/Applications', path.join(os.homedir(), 'Applications')].flatMap((base) =>
      [
        'Google Chrome.app/Contents/MacOS/Google Chrome',
        'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        'Chromium.app/Contents/MacOS/Chromium'
      ].map((name) => path.join(base, name))
    );
  }
  return [...(process.env.PATH || '').split(path.delimiter).filter(Boolean), '/usr/bin', '/snap/bin'].flatMap(
    (base) =>
      [
        'google-chrome',
        'google-chrome-stable',
        'chromium',
        'chromium-browser',
        'microsoft-edge',
        'microsoft-edge-stable'
      ].map((name) => path.join(base, name))
  );
}

const executableExists = async (file) =>
  access(file, constants.X_OK).then(
    () => true,
    () => false
  );
export async function findAndLaunch(
  chromium,
  { explicit, candidates = installedBrowsers(), exists = executableExists } = {}
) {
  if (explicit) return chromium.launch({ headless: true, executablePath: explicit });
  let reason;
  // Playwright may have installed its headless shell independently of the full browser.
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    reason = error;
  }
  for (const executablePath of new Set([chromium.executablePath(), ...candidates])) {
    if (await exists(executablePath)) {
      try {
        return await chromium.launch({ headless: true, executablePath });
      } catch (error) {
        reason = error;
      }
    }
  }
  throw new Error(
    'Chromium could not start. Run "npx playwright-core install chromium" or pass --browser /path/to/chrome or /path/to/edge.',
    { cause: reason }
  );
}

export async function launchBrowser(executablePath) {
  const entry = process.env.UNONE_PLAYWRIGHT_MODULE;
  const { chromium } = await import(
    entry ? pathToFileURL(path.resolve(entry)).href : 'playwright-core'
  ).catch((error) => {
    throw new Error(
      'Install playwright-core in tools/html-view or set UNONE_PLAYWRIGHT_MODULE to its index.mjs.',
      { cause: error }
    );
  });
  return findAndLaunch(chromium, { explicit: executablePath || process.env.UNONE_CHROMIUM });
}

const mime = {
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon'
};

// A fresh document paints the element's box only. Text and descendants never enter this surface.
async function renderLayer(page, raster, resource) {
  const { css, pad, w, h, crop } = raster;
  const resolved = { ...css };
  const matches = [...css['background-image'].matchAll(/url\(["']?([^"')]+)["']?\)/g)];
  for (const [original, url] of matches)
    resolved['background-image'] = resolved['background-image'].replace(
      original,
      'url("' + (await resource(url)) + '")'
    );
  const src = raster.src ? await resource(raster.src) : null;
  const width = Math.max(1, Math.ceil(crop.w)),
    height = Math.max(1, Math.ceil(crop.h));
  await page.setViewportSize({ width, height });
  await page.evaluate(
    async ({ css, src, pad, crop, w, h }) => {
      const element = document.createElement(src ? 'img' : 'div');
      element.style.cssText = 'position:absolute;display:block;box-sizing:border-box;margin:0;padding:0';
      for (const [key, value] of Object.entries(css)) element.style.setProperty(key, value);
      Object.assign(element.style, {
        width: w + 'px',
        height: h + 'px',
        left: pad.left - crop.x + 'px',
        top: pad.top - crop.y + 'px'
      });
      document.body.replaceChildren(element);
      if (src) {
        element.src = src;
        await element.decode();
      }
      const urls = Array.from(css['background-image'].matchAll(/url\("([^"]+)"\)/g), (m) => m[1]);
      await Promise.all(
        urls.map(async (url) => {
          const image = new Image();
          image.src = url;
          await image.decode();
        })
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
    },
    { css: resolved, src, pad, crop, w, h }
  );
  return page.screenshot({ omitBackground: true, animations: 'disabled' });
}

function luau(value) {
  if (Array.isArray(value)) return '{' + value.map(luau).join(',') + '}';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .map(([k, v]) => '[' + luau(k) + ']=' + luau(v))
        .join(',') +
      '}'
    );
  if (typeof value === 'string')
    return (
      '"' +
      value.replace(/[\u0000-\u001f"\\]/g, (ch) => {
        if (ch === '"' || ch === '\\') return '\\' + ch;
        return '\\' + String(ch.charCodeAt(0)).padStart(3, '0');
      }) +
      '"'
    );
  return value == null ? 'nil' : String(value);
}

export async function captureViews(
  browser,
  { url, selector, actions = {}, viewports, out, touch = false, prepare }
) {
  const bundle = { version: 1, views: {}, assets: [] };
  const stored = new Map(),
    rendered = new Map();
  const assetDir = path.join(out, 'assets');
  await mkdir(assetDir, { recursive: true });
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport,
      hasTouch: touch,
      deviceScaleFactor: 1,
      reducedMotion: 'no-preference'
    });
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load' });
      if (prepare) await prepare(page, viewport);
      const root = page.locator(selector);
      await root.waitFor({ state: 'visible' });
      if ((await root.count()) !== 1)
        throw new Error('Selector must identify exactly one visible root: ' + selector);
      await page.addStyleTag({
        content:
          '*,*::before,*::after{animation-play-state:paused!important;transition-duration:0s!important;caret-color:transparent!important}'
      });
      await root.evaluate(async (el) => {
        const images = [...el.querySelectorAll('img')];
        if (el instanceof HTMLImageElement) images.push(el);
        for (const img of images) if (img.loading === 'lazy') img.loading = 'eager';
        await Promise.all([document.fonts.ready, ...images.map((i) => i.decode().catch(() => {}))]);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const { nodes, ...view } = await root.evaluate(measure, actions);
      const layer = await context.newPage();
      await layer.setContent(
        '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}</style>'
      );
      const resources = new Map();
      async function resource(uri) {
        if (uri.startsWith('data:')) return uri;
        if (resources.has(uri)) return resources.get(uri);
        let bytes, type;
        if (uri.startsWith('file:')) {
          const file = fileURLToPath(uri);
          bytes = await readFile(file);
          type = mime[path.extname(file).toLowerCase()];
        } else if (uri.startsWith('blob:')) {
          const data = await page.evaluate(async (u) => {
            const blob = await (await fetch(u)).blob();
            return new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          }, uri);
          resources.set(uri, data);
          return data;
        } else {
          const response = await context.request.get(uri);
          if (!response.ok()) throw new Error('Image request failed with ' + response.status() + ': ' + uri);
          bytes = await response.body();
          type = response.headers()['content-type']?.split(';')[0];
        }
        const data = 'data:' + (type || 'application/octet-stream') + ';base64,' + bytes.toString('base64');
        resources.set(uri, data);
        return data;
      }
      for (const node of nodes) {
        if (!node.raster) continue;
        const key = JSON.stringify(node.raster);
        let id = rendered.get(key);
        if (!id) {
          const bytes = await renderLayer(layer, node.raster, resource);
          const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
          id = 'asset://html-view/' + hash;
          if (!stored.has(id)) {
            const entry = { id, source: 'assets/' + hash + '.png', kind: 'texture2d' };
            await writeFile(path.join(out, entry.source), bytes);
            stored.set(id, entry);
          }
          rendered.set(key, id);
        }
        delete node.raster;
        node.asset = id;
      }
      const key = viewport.width + 'x' + viewport.height;
      const rootNode = { kind: 'screen', id: 'html-view', node: 'html-view', children: nodes };
      if (nodes.length > 200) rootNode.budget = { max_nodes: nodes.length + 1 };
      bundle.views[key] = { ...view, viewport, root: rootNode };
    } finally {
      await context.close();
    }
  }
  bundle.assets = [...stored.values()];
  // Replace manifests only after all pages and materialized images have succeeded.
  const stamp = process.pid + '-' + Date.now();
  for (const [filename, contents] of [
    ['views.json', JSON.stringify(bundle, null, 2) + '\n'],
    [
      'views.luau',
      '-- Generated by Unone html-view. Source of the actions is the game.\nreturn ' + luau(bundle) + '\n'
    ]
  ]) {
    const target = path.join(out, filename),
      temp = target + '.' + stamp + '.tmp';
    await writeFile(temp, contents);
    await rename(temp, target);
  }
  return bundle;
}
