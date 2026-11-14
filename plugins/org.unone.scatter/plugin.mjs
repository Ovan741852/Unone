// org.unone.scatter: installs a pure Luau scatter module beside the project's
// entry script. One JSON request per stdin line, one EngineResult per line.
import {readFile, writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE = resolve(HERE, 'scatter', 'unone-scatter.luau');
const result = (value, diagnostics = [], effects = []) => ({ok: true, value, diagnostics, effects});
const failure = (code, summary, explanation) => ({ok: false, value: null, diagnostics: [{code, severity: 'ERROR', summary, explanation, facts: {}, likely_causes: [], suggested_actions: [], source: null}], effects: []});

const DESCRIPTION = {
  require: 'local Scatter = require("./unone-scatter")',
  functions: {
    'Scatter.points(options)': 'Evenly spaced random points {x, y, z, yaw, scale} (Poisson-disk), filtered; deterministic for a seed.',
    'Scatter.heightAt(field, x, z)': 'World height on a heightfield definition at (x, z), on the triangles the engine draws; nil outside.',
    'Scatter.pack(points)': '40-byte instance records for api.instances3d.set(id, asset, records).',
  },
  options: {
    area: '{x, z, width, depth}; defaults to the heightfield extent',
    spacing: 'minimum distance between points (required)',
    seed: 'integer, default 1',
    heightfield: 'the definition passed to api.heightfield.set; places points on it',
    minHeight: 'world height', maxHeight: 'world height', maxSlope: 'degrees from flat (needs heightfield)',
    scale: '{min, max} uniform scale, default 1', yaw: 'random rotation around up, default true',
    limit: 'at most this many points, default 100000', accept: 'function(x, y, z) -> boolean, your own rule',
  },
  example: 'local trees = Scatter.points({heightfield = terrain, spacing = 3, seed = 7, maxSlope = 30, scale = {min = 0.8, max = 1.3}})\napi.instances3d.set("trees", "mesh://tree", Scatter.pack(trees))',
};

export async function call(tool, input = {}, project = process.env.UNONE_PROJECT_ROOT || process.cwd()) {
  if (tool === 'plugin.test') {
    const source = await readFile(MODULE, 'utf8').catch(() => null);
    return source?.includes('function Scatter.points') ? result({self_test: 'passed'}) : failure('SCATTER_SELF_TEST_FAILED', 'Module missing', MODULE);
  }
  if (tool === 'scatter.describe') return result(DESCRIPTION);
  if (tool === 'scatter.install') {
    let config;
    try { config = JSON.parse(await readFile(resolve(project, 'project.unone.json'), 'utf8')); }
    catch { return failure('PROJECT_CONFIG_MISSING', 'No project.unone.json', `Run this from a Unone project; ${project} has none.`); }
    const target = resolve(project, dirname(config.entry_script ?? 'main.luau'), 'unone-scatter.luau');
    const source = await readFile(MODULE, 'utf8');
    const existing = await readFile(target, 'utf8').catch(() => null);
    if (existing === source) return result({path: target, status: 'unchanged', require: DESCRIPTION.require});
    if (existing !== null && input.force !== true) return failure('SCATTER_MODULE_MODIFIED', 'The installed module was changed', `Refusing to overwrite ${target}; review it, then pass force=true.`);
    await writeFile(target, source, 'utf8');
    return result({path: target, status: existing === null ? 'new' : 'replaced', require: DESCRIPTION.require}, [], [`wrote ${target}`]);
  }
  return failure('PLUGIN_TOOL_NOT_FOUND', 'Tool not found', `Unknown tool: ${tool}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lines = createInterface({input: process.stdin, crlfDelay: Infinity});
  for await (const line of lines) {
    if (!line.trim()) continue;
    let response;
    try { const request = JSON.parse(line); response = await call(request.tool, request.input || {}, request.project || process.env.UNONE_PROJECT_ROOT || process.cwd()); }
    catch (error) { response = failure('PLUGIN_REQUEST_INVALID', 'Plugin request invalid', error.message); }
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}
