#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { captureViews, launchBrowser } from './capture.mjs';

const usage = `Usage: game ui import-html (--file page.html | --url URL) --selector CSS [--viewport WxH ...] --out DIR
Source entry point: node tools/html-view/cli.mjs [same options]

  --actions FILE    JSON object with CSS selectors as keys and Unone input actions as values
  --viewport WxH    CSS viewport; defaults to 1280x720. Repeat for responsive variants
  --touch           Enable the browser's touch and coarse-pointer media queries
  --prepare MODULE  Local ES module exporting async function (page, viewport) to set the source state
  --browser FILE    Chromium executable; otherwise use UNONE_CHROMIUM, Playwright, or installed Chrome/Edge
  --help            Show this message

Outputs views.json, views.luau and assets/*.png. The browser runs only during this authoring step.`;

try {
  const { values: v } = parseArgs({
    options: {
      file: { type: 'string' },
      url: { type: 'string' },
      selector: { type: 'string' },
      viewport: { type: 'string', multiple: true },
      out: { type: 'string' },
      actions: { type: 'string' },
      touch: { type: 'boolean' },
      prepare: { type: 'string' },
      browser: { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    }
  });
  if (v.help) console.log(usage);
  else {
    if (Boolean(v.file) === Boolean(v.url)) throw new Error('Choose exactly one --file or --url.');
    if (!v.selector || !v.out) throw new Error('Required: --selector CSS --out DIR');
    const viewports = [...new Set(v.viewport || ['1280x720'])].map((value) => {
      const m = /^(\d+)x(\d+)$/i.exec(value);
      if (!m || !Number(m[1]) || !Number(m[2]) || Number(m[1]) > 16384 || Number(m[2]) > 16384)
        throw new Error('Invalid --viewport: ' + value);
      return { width: Number(m[1]), height: Number(m[2]) };
    });
    const url = v.file ? pathToFileURL(path.resolve(v.file)).href : new URL(v.url).href;
    const actions = v.actions ? JSON.parse(await readFile(v.actions, 'utf8')) : {};
    if (
      !actions ||
      Array.isArray(actions) ||
      typeof actions !== 'object' ||
      Object.entries(actions).some(([k, a]) => !k.trim() || typeof a !== 'string' || !a.trim())
    )
      throw new Error('--actions must map CSS selector strings to nonempty action strings');
    const prepare = v.prepare ? (await import(pathToFileURL(path.resolve(v.prepare)).href)).default : null;
    if (v.prepare && typeof prepare !== 'function')
      throw new Error('--prepare must default-export a function');
    const browser = await launchBrowser(v.browser);
    try {
      const bundle = await captureViews(browser, {
        url,
        actions,
        prepare,
        selector: v.selector,
        viewports,
        out: path.resolve(v.out),
        touch: v.touch
      });
      for (const [key, view] of Object.entries(bundle.views)) {
        console.log(
          key +
            ': ' +
            view.root.children.length +
            ' native nodes, ' +
            view.warnings.length +
            ' authoring notes'
        );
        for (const warning of view.warnings) console.error('  ' + warning);
      }
      console.log(bundle.assets.length + ' PNG assets; ' + path.resolve(v.out));
    } finally {
      await browser.close();
    }
  }
} catch (error) {
  console.error(error.message);
  if (error.cause) console.error(error.cause.message);
  process.exitCode = 1;
}
