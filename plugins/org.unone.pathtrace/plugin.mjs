// org.unone.pathtrace: path-traced stills of a project's scene, for store
// pages, trailers and lighting reference. One JSON request per stdin line.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createScene, decodeHdr, decodePng, render} from './tracer.mjs';

const result = (value, diagnostics = [], effects = []) => ({ok: true, value, diagnostics, effects});
const warning = (code, explanation) => ({code, severity: 'WARNING', summary: explanation, explanation, facts: {}, likely_causes: [], suggested_actions: [], source: null});
const failure = (code, summary, explanation) => ({ok: false, value: null, diagnostics: [{...warning(code, explanation), severity: 'ERROR', summary}], effects: []});

/** The scene's camera in the camera3d shape, from either scene form. */
export function cameraOf(scene) {
  if (scene.camera3d) return scene.camera3d;
  const c = scene.camera;
  if (c?.projection === 'perspective') return {position: c.position ?? {x: 0, y: 0, z: 10}, target: c.target, fov_degrees: c.fovDegrees ?? c.fov_degrees ?? 60};
  return null;
}

export function assetsFor(project, manifest, warnings) {
  const byId = new Map((manifest?.assets ?? []).map(asset => [asset.id, asset]));
  const file = id => {
    const asset = byId.get(id);
    if (!asset) throw new Error(`asset '${id}' is not declared`);
    return readFileSync(resolve(project, asset.source));
  };
  return {
    mesh: id => JSON.parse(file(id).toString('utf8')),
    texture: id => {
      try { return decodePng(file(id)); }
      catch (error) { warnings.push(warning('PATHTRACE_TEXTURE_SKIPPED', `${id}: ${error.message}; rendered white`)); return null; }
    },
    hdr: id => decodeHdr(file(id)),
  };
}

export async function call(tool, input = {}, project = process.env.UNONE_PROJECT_ROOT || process.cwd()) {
  if (tool === 'plugin.test') return result({self_test: typeof render === 'function' ? 'passed' : 'failed'});
  if (tool !== 'pathtrace.render') return failure('PLUGIN_TOOL_NOT_FOUND', 'Tool not found', `Unknown tool: ${tool}`);
  let config;
  try { config = JSON.parse(await readFile(resolve(project, 'project.unone.json'), 'utf8')); }
  catch { return failure('PROJECT_CONFIG_MISSING', 'No project.unone.json', `Run this from a Unone project; ${project} has none.`); }
  const scenePath = input.scene ?? config.main_scene;
  if (!scenePath) return failure('PATHTRACE_SCENE_REQUIRED', 'No scene', 'Pass scene, or declare main_scene in project.unone.json.');
  const scene = JSON.parse(await readFile(resolve(project, scenePath), 'utf8'));
  const camera = cameraOf(scene);
  if (!camera?.target) return failure('PATHTRACE_CAMERA_REQUIRED', 'No 3D camera', `${scenePath} needs a perspective camera (camera3d, or camera with projection "perspective").`);
  const manifest = config.asset_manifest ? JSON.parse(await readFile(resolve(project, config.asset_manifest), 'utf8')) : {assets: []};
  const warnings = [];
  let world;
  try { world = createScene(scene, assetsFor(project, manifest, warnings)); }
  catch (error) { return failure('PATHTRACE_SCENE_INVALID', 'The scene could not be read', error.message); }
  const options = {width: input.width ?? 320, height: input.height ?? 200, samples: input.samples ?? 16, bounces: input.bounces ?? 3, exposure: input.exposure ?? 1, seed: input.seed ?? 1};
  if (!(options.width > 0 && options.width <= 4096 && options.height > 0 && options.height <= 4096 && options.samples >= 1 && options.samples <= 4096 && options.bounces >= 0 && options.bounces <= 16)) {
    return failure('PATHTRACE_OPTIONS_INVALID', 'Options out of range', 'width/height 1..4096, samples 1..4096, bounces 0..16.');
  }
  const {png, stats} = render(world, camera, options);
  const output = resolve(project, input.output ?? 'renders/still.png');
  await mkdir(dirname(output), {recursive: true});
  await writeFile(output, png);
  return result({output, ...stats, note: 'Entities come from the scene file as declared; runtime spawns and api.lighting changes are not included.'}, warnings, [`wrote ${output}`]);
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
