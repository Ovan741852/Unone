const { chromium } = require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname);
const evidence = path.join(root, 'evidence');
fs.mkdirSync(evidence, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('http://127.0.0.1:8001/Unone/web/blind-loadout/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts?.ready);
    await page.waitForTimeout(500);
    const regions = await page.evaluate(() => [...document.querySelectorAll('[data-region]')].map((element) => {
      const rect = element.getBoundingClientRect();
      const list = (value) => value ? value.split('|').map((item) => item.trim()).filter(Boolean) : [];
      const bool = (value) => value === 'true' ? true : value === 'false' ? false : null;
      const children = list(element.dataset.children);
      const iconRequired = bool(element.dataset.iconRequired);
      return {
        id: element.dataset.region,
        name: element.dataset.name,
        label: element.dataset.label || element.dataset.name,
        role: element.dataset.role || 'region',
        behavior: element.dataset.behavior || 'unknown',
        purpose: element.dataset.purpose,
        dynamic_fields: list(element.dataset.dynamicFields),
        fixed_fields: list(element.dataset.fixedFields),
        children,
        component: { reusable: bool(element.dataset.reusable) === true, type: element.dataset.componentType || 'one-off' },
        nine_grid: { eligible: bool(element.dataset.nineGrid) === true, reason: element.dataset.nineGridReason || (bool(element.dataset.nineGrid) === true ? '可作為可替換素材候選' : '不建議九宮格') },
        icon: { required: iconRequired === true, purpose: element.dataset.iconPurpose || '不需要額外 icon' },
        rect: {
          x: +(rect.left / innerWidth * 100).toFixed(3),
          y: +(rect.top / innerHeight * 100).toFixed(3),
          width: +(rect.width / innerWidth * 100).toFixed(3),
          height: +(rect.height / innerHeight * 100).toFixed(3),
        },
      };
    }));
    const elements = await page.evaluate(() => [...document.querySelectorAll('[data-element]')].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        id: element.dataset.element,
        parent_id: element.dataset.parent || null,
        label: element.dataset.label || element.dataset.element,
        role: element.dataset.role || 'unknown',
        contains_text: Boolean(element.textContent?.trim()),
        rect: {
          x: +(rect.left / innerWidth * 100).toFixed(3),
          y: +(rect.top / innerHeight * 100).toFixed(3),
          width: +(rect.width / innerWidth * 100).toFixed(3),
          height: +(rect.height / innerHeight * 100).toFixed(3),
        },
      };
    }));
    const screenshot = path.join(evidence, 'hero-loadout.png');
    await page.screenshot({ path: screenshot });
    const source = { viewport: { width: 1920, height: 1080 }, screenshot, regions, elements, errors };
    fs.writeFileSync(path.join(evidence, 'html-ground-truth.json'), JSON.stringify(source, null, 2));
    console.log(JSON.stringify({ screenshot, regionCount: regions.length, errors }));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
