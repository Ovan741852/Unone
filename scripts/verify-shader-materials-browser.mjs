// Real-browser integration of declarative shader materials through the official
// renderer and the production minified Three bundle (no mocked GPU/classes).
// Usage: node scripts/verify-shader-materials-browser.mjs [output-directory]
// Set UNONE_PLAYWRIGHT_MODULE when Playwright is outside Node's module path.
// Set UNONE_BROWSER_PATH or UNONE_BROWSER_CHANNEL to select an installed browser.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {extname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({chromium} = require(process.env.UNONE_PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_MODULE || 'playwright'));
} catch (error) {
  throw new Error('Playwright is required; install it or set UNONE_PLAYWRIGHT_MODULE. No browser verification was performed.', {cause: error});
}
const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(process.argv[2] || resolve(root, 'artifacts/shader-materials-browser'));
await mkdir(out, {recursive: true});
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    if (pathname === '/') {
      response.setHeader('content-type', 'text/html');
      response.end('<!doctype html><meta charset="utf-8"><style>canvas{width:96px;height:96px}</style><canvas id="view" width="96" height="96"></canvas>');
      return;
    }
    const path = resolve(root, `.${pathname}`);
    if (!path.startsWith(resolve(root) + sep)) { response.writeHead(403).end(); return; }
    response.setHeader('content-type', extname(path) === '.js' ? 'text/javascript' : 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });

let browser;
const errors = [];
const report = {ok: false, errors};
try {
  const selection = process.env.UNONE_BROWSER_PATH
    ? {executablePath: process.env.UNONE_BROWSER_PATH}
    : {channel: process.env.UNONE_BROWSER_CHANNEL || 'chrome'};
  browser = await chromium.launch({...selection, headless: true, args: ['--enable-webgl', '--enable-unsafe-swiftshader']});
  const page = await browser.newPage({viewport: {width: 320, height: 240}, deviceScaleFactor: 1});
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const {createThreeRenderer} = await import('/web/renderer/three.js');
    const checks = [], pixels = {}, previews = {};
    const check = (condition, message) => { if (!condition) throw new Error(message); checks.push(message); };
    let context;
    const canvas = document.querySelector('#view');
    const renderer = await createThreeRenderer(canvas, {
      kind: 'three-webgl', threeModuleUrl: '/web/vendor/three/three.player.min.js', bloom: false, ao: false,
      onReady(value) { context = value; },
    });
    const gl = context.renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const world = {
      frame: 30, time_seconds: 0.5,
      camera: {position: {x: 0, y: 0}, view_height: 2, zoom: 1},
      entities: {probe: {id: 'probe', transform: {x: 0, y: 0}, rotation: 0, scale: {x: 1, y: 1}, sprite: {asset: 'test-only-missing-texture', size: {x: 1.5, y: 1.5}, visible: true}}},
      shader_materials: {
        probe: {
          fragment: 'vec4 unoneShade(vec2 uv, vec4 color) { vec3 rgb = tint * strength + vec3(offset, 0.0) + veil.rgb * veil.a + vec3(unone_time * 0.1 + unone_frame * 0.001); return vec4(rgb, color.a); }',
          uniforms: {strength: 0.45, tint: [0.8, 0.12, 0.03], offset: [0, 0], veil: [0, 0, 0, 0]},
        },
      },
    };
    function probe(name, snapshot, capture = false) {
      renderer.draw(snapshot, {dt: 0});
      const pixel = new Uint8Array(4);
      gl.readPixels(48, 48, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      check(gl.getError() === gl.NO_ERROR, `${name}: no WebGL errors`);
      check(pixel[3] === 255 && pixel.slice(0, 3).some(value => value > 0), `${name}: nonempty opaque pixel`);
      pixels[name] = [...pixel];
      if (capture) previews[name] = canvas.toDataURL('image/png');
      return [...pixel];
    }
    let disposedMaterials = 0;
    let standard;
    try {
      check(renderer.backend === 'webgl', 'official WebGL renderer selected');
      check(typeof context.THREE.WebGLRenderer === 'function', 'production minified Three renderer exports loaded');
      standard = probe('standard', world);
      world.entities.probe.shader_material = 'probe';
      const base = probe('shader', world, true);
      check(renderer.metrics().shader_materials === 1, 'declarative material allocated by engine');
      context.root.children[0].material.addEventListener('dispose', () => disposedMaterials++);
      check(base.some((value, index) => Math.abs(value - standard[index]) > 20), 'declarative shader changes rendered sprite');

      const scalar = structuredClone(world); scalar.shader_materials.probe.uniforms.strength = 0.15;
      check(probe('scalar', scalar)[0] < base[0] - 30, 'scalar uniform update changes pixels');
      const vector = structuredClone(world); vector.shader_materials.probe.uniforms.tint = [0.05, 0.8, 0.03];
      const green = probe('vec3', vector, true);
      check(green[1] > base[1] + 45 && green[0] < base[0] - 50, 'vec3 uniform update changes color channels');
      const offset = structuredClone(world); offset.shader_materials.probe.uniforms.offset = [0.15, 0];
      check(probe('vec2', offset)[0] > base[0] + 15, 'vec2 uniform update changes pixels');
      const veil = structuredClone(world); veil.shader_materials.probe.uniforms.veil = [0, 0, 0.5, 0.6];
      check(probe('vec4', veil)[2] > base[2] + 70, 'vec4 uniform update changes pixels');

      probe('fixed_time_before', world);
      await new Promise(resolve => setTimeout(resolve, 80));
      const repeated = probe('fixed_time_after', world);
      check(repeated.every((value, index) => value === base[index]), 'fixed snapshot shader time is independent of wall clock');
      const later = structuredClone(world); later.frame = 90; later.time_seconds = 1.5;
      const animated = probe('simulation_time', later);
      check(animated.slice(0, 3).every((value, index) => value > base[index] + 10), 'unone_time and unone_frame follow simulation snapshot');
      check(disposedMaterials === 0, 'uniform updates reuse the compiled material');

      delete world.entities.probe.shader_material;
      const restored = probe('cleared', world, true);
      check(restored.every((value, index) => Math.abs(value - standard[index]) <= 1), 'clearMaterial snapshot restores standard sprite pixels');
      check(renderer.metrics().shader_materials === 0 && disposedMaterials === 1, 'clearMaterial releases the custom material');
    } finally { renderer.dispose(); }
    check(gl.getError() === gl.NO_ERROR, 'valid renderer disposal produces no WebGL error');

    // A real compiler rejection must escape the renderer as an engine diagnostic.
    // A separate context prevents a failed shader from masking earlier probes.
    const invalidCanvas = document.createElement('canvas'); invalidCanvas.width = invalidCanvas.height = 96;
    document.body.append(invalidCanvas);
    let invalidContext;
    const invalidRenderer = await createThreeRenderer(invalidCanvas, {
      kind: 'three-webgl', threeModuleUrl: '/web/vendor/three/three.player.min.js', bloom: false, ao: false,
      onReady(value) { invalidContext = value; },
    });
    let diagnostic = '';
    try {
      const invalid = structuredClone(world);
      invalid.entities.probe.shader_material = 'probe';
      invalid.shader_materials.probe.fragment = 'vec4 unoneShade(vec2 uv, vec4 color) { return vec4(UNONE_TEST_UNDEFINED_SYMBOL); }';
      try { invalidRenderer.draw(invalid); } catch (error) { diagnostic = error.message; }
      check(diagnostic.includes('SHADER_COMPILE_FAILED: probe'), 'malformed GLSL surfaces SHADER_COMPILE_FAILED with material ID');
    } finally { invalidRenderer.dispose(); }
    const invalidGl = invalidContext.renderer.getContext();
    check(invalidGl.getError() === invalidGl.NO_ERROR, 'failed-shader renderer disposal produces no WebGL error');
    invalidCanvas.remove();
    return {checks, pixels, previews, diagnostic, gpu, productionModule: '/web/vendor/three/three.player.min.js'};
  });
  for (const [name, data] of Object.entries(result.previews)) {
    await writeFile(resolve(out, `${name}.png`), Buffer.from(data.split(',')[1], 'base64'));
  }
  delete result.previews;
  Object.assign(report, result);
  assert.deepEqual(errors, [], `Unexpected browser errors: ${JSON.stringify(errors)}`);
  report.ok = true;
} catch (error) {
  errors.push(error.stack || String(error));
  throw error;
} finally {
  await writeFile(resolve(out, 'browser.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify({ok: report.ok, gpu: report.gpu, checks: report.checks.length, pixels: report.pixels, evidence: resolve(out, 'browser.json')}, null, 2));
