// org.unone.gltf: wire a .glb into the engine's import pipeline. The Luau
// importer (importer/unone-gltf.luau) does the conversion whenever the project
// runs, tests, verifies or exports; this plugin inspects models and writes the
// declarations. One JSON request per stdin line, one EngineResult per line.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {basename, dirname, extname, isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMPORTER_PATH = 'import/unone-gltf.luau';
const IMPORTER_ID = 'unone.gltf.mesh';
const UNSUPPORTED = {KHR_draco_mesh_compression: 'Draco compression', EXT_meshopt_compression: 'meshopt compression',
  KHR_texture_basisu: 'KTX2/Basis textures', KHR_mesh_quantization: 'quantized vertices'};

const result = (value, diagnostics = [], effects = []) => ({ok: true, value, diagnostics, effects});
const diagnostic = (code, severity, summary, explanation, facts = {}) => ({code, severity, summary, explanation, facts, likely_causes: [], suggested_actions: [], source: null});
const failure = (code, summary, explanation, facts) => ({ok: false, value: null, diagnostics: [diagnostic(code, 'ERROR', summary, explanation, facts)], effects: []});

/** The JSON chunk of a binary glTF, or an Error. */
export function readGlb(bytes) {
  const view = Buffer.from(bytes);
  if (view.length < 20 || view.readUInt32LE(0) !== 0x46546C67) throw new Error('not a binary glTF (.glb); export the model as GLB');
  if (view.readUInt32LE(4) !== 2) throw new Error('only glTF 2.0 is supported');
  const length = view.readUInt32LE(12);
  if (view.readUInt32LE(16) !== 0x4E4F534A) throw new Error('the first GLB chunk must be JSON');
  return JSON.parse(view.subarray(20, 20 + length).toString('utf8'));
}

// glTF factors are linear; scene materials take "#rrggbb" sRGB.
const hex = rgb => '#' + rgb.slice(0, 3).map(v => {
  const c = Math.max(0, Math.min(1, v));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(s * 255).toString(16).padStart(2, '0');
}).join('');

export function inspectGltf(gltf) {
  const warnings = [], accessors = gltf.accessors ?? [];
  const meshes = (gltf.meshes ?? []).map((mesh, index) => {
    let triangles = 0;
    for (const primitive of mesh.primitives ?? []) {
      if ((primitive.mode ?? 4) !== 4) warnings.push(`mesh ${mesh.name ?? index} has a non-triangle primitive, which the importer rejects`);
      const count = primitive.indices !== undefined ? accessors[primitive.indices]?.count : accessors[primitive.attributes?.POSITION]?.count;
      triangles += Math.floor((count ?? 0) / 3);
      if (!primitive.attributes?.TEXCOORD_0) warnings.push(`mesh ${mesh.name ?? index} has a primitive without UVs; it samples the texture's corner`);
    }
    return {name: mesh.name ?? `mesh ${index}`, primitives: mesh.primitives?.length ?? 0, triangles};
  });
  const materials = (gltf.materials ?? []).map((material, index) => {
    const pbr = material.pbrMetallicRoughness ?? {};
    return {name: material.name ?? `material ${index}`, color: hex(pbr.baseColorFactor ?? [1, 1, 1, 1]),
      metallic: pbr.metallicFactor ?? 1, roughness: pbr.roughnessFactor ?? 1, emissive: hex(material.emissiveFactor ?? [0, 0, 0]),
      texture: pbr.baseColorTexture !== undefined};
  });
  if (materials.filter(material => material.texture).length > 1) warnings.push('several materials have textures; the importer uses the first one for the whole mesh');
  if (gltf.skins?.length) warnings.push('skins are ignored: the mesh imports in its bind pose');
  if (gltf.animations?.length) warnings.push('animations are ignored');
  if (accessors.some(accessor => accessor.sparse)) warnings.push('sparse accessors are not supported');
  if ((gltf.images ?? []).some(image => image.uri)) warnings.push('external images are not supported; pack textures into the GLB');
  const blocked = (gltf.extensionsRequired ?? []).map(name => `${UNSUPPORTED[name] ?? name} (${name}) is required; export without it`);
  return {meshes, triangles: meshes.reduce((n, mesh) => n + mesh.triangles, 0), materials,
    textured: materials.some(material => material.texture), images: gltf.images?.length ?? 0,
    extensions_required: gltf.extensionsRequired ?? [], extensions_used: gltf.extensionsUsed ?? [],
    importable: blocked.length === 0, blocked, warnings};
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

/** What gltf.apply would write for the model at `path` into `project`. */
export async function plan(project, {path, name}) {
  if (typeof path !== 'string' || !path) return {error: failure('GLTF_PATH_REQUIRED', 'Name the model', 'Pass path: the .glb file to import.')};
  const model = resolve(project, path);
  let gltf;
  try { gltf = readGlb(await readFile(model)); } catch (error) {
    return {error: failure('GLTF_UNREADABLE', 'The model could not be read', `${model}: ${error.message}`)};
  }
  const inspection = inspectGltf(gltf);
  if (!inspection.importable) return {error: failure('GLTF_UNSUPPORTED', 'The model needs features the importer does not read', inspection.blocked.join('; '), {blocked: inspection.blocked})};
  const base = (name ?? basename(model, extname(model))).toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'model';
  const config = await readJson(resolve(project, 'project.unone.json'), null);
  if (!config) return {error: failure('PROJECT_CONFIG_MISSING', 'No project.unone.json', `Run this from a Unone project; ${project} has none.`)};
  // The model's folder becomes an import root; reuse one that already points there.
  const folder = dirname(model);
  const localRoots = await readJson(resolve(project, '.unone/import-roots.json'), {});
  const roots = config.import?.roots ?? {};
  let root = Object.keys(roots).find(key => localRoots[key] && resolve(localRoots[key]) === folder);
  if (!root) {
    root = 'models';
    for (let n = 2; roots[root] || (localRoots[root] && resolve(localRoots[root]) !== folder); n++) root = `models-${n}`;
  }
  const textureMime = gltf.images?.[gltf.textures?.[gltf.materials?.find(m => m.pbrMetallicRoughness?.baseColorTexture)?.pbrMetallicRoughness.baseColorTexture.index]?.source]?.mimeType;
  const textureSource = `assets/imported/${base}.${textureMime === 'image/jpeg' ? 'jpg' : 'png'}`;
  const input = `${root}:${basename(model)}`;
  const importDeclaration = product => ({importer: IMPORTER_ID, product, inputs: {model: input}, params: {texture: `texture://${base}`}});
  const assets = [
    {id: `mesh://${base}`, kind: 'mesh3d', source: `assets/imported/${base}.mesh.json`, import: importDeclaration('mesh')},
    {id: `texture://${base}`, kind: 'texture2d', source: textureSource, import: importDeclaration('texture')},
  ];
  const manifestPath = config.asset_manifest ?? 'assets.json';
  const manifest = await readJson(resolve(project, manifestPath), {version: 1, assets: []});
  const taken = assets.filter(asset => manifest.assets?.some(existing => existing.id === asset.id)).map(asset => asset.id);
  const firstMaterial = inspection.materials[0];
  const material = firstMaterial ? {color: firstMaterial.color, metallic: firstMaterial.metallic, roughness: firstMaterial.roughness,
    ...(firstMaterial.emissive !== '#000000' ? {emissive: firstMaterial.emissive} : {})} : null;
  const importer = await readFile(resolve(HERE, 'importer', 'unone-gltf.luau'), 'utf8');
  const existingImporter = await readFile(resolve(project, IMPORTER_PATH), 'utf8').catch(() => null);
  return {model, base, root, folder, input, assets, taken, manifestPath, manifest, config, localRoots, material, inspection, importer,
    importerStatus: existingImporter === null ? 'new' : existingImporter === importer ? 'unchanged' : 'changed'};
}

function summary(planned) {
  return {
    model: planned.model, root: {name: planned.root, folder: planned.folder, input: planned.input},
    importer: {module: IMPORTER_PATH, id: IMPORTER_ID, status: planned.importerStatus},
    assets: planned.assets.map(asset => ({id: asset.id, kind: asset.kind, source: asset.source})),
    asset_manifest: planned.manifestPath, already_declared: planned.taken,
    material: planned.material ? {name: planned.base, ...planned.material} : null,
    inspection: planned.inspection,
    next: `Spawn it with mesh3d = {asset = "mesh://${planned.base}"${planned.material ? `, material = "${planned.base}"` : ''}}; the engine converts the model on the next run, test, verify or export.`,
  };
}

export async function call(tool, input = {}, project = process.env.UNONE_PROJECT_ROOT || process.cwd()) {
  if (tool === 'plugin.test') {
    const importer = await readFile(resolve(HERE, 'importer', 'unone-gltf.luau'), 'utf8').catch(() => null);
    const json = Buffer.from(JSON.stringify({asset: {version: '2.0'}, meshes: [{primitives: [{attributes: {POSITION: 0}}]}], accessors: [{count: 3, type: 'VEC3', componentType: 5126}]}));
    const glb = Buffer.alloc(20 + json.length);
    glb.writeUInt32LE(0x46546C67, 0);glb.writeUInt32LE(2, 4);glb.writeUInt32LE(glb.length, 8);glb.writeUInt32LE(json.length, 12);glb.writeUInt32LE(0x4E4F534A, 16);json.copy(glb, 20);
    const inspection = inspectGltf(readGlb(glb));
    return importer?.includes('mesh = {') && inspection.triangles === 1 ? result({self_test: 'passed'}) : failure('GLTF_SELF_TEST_FAILED', 'Self-test failed', 'The importer module or GLB reading is broken.');
  }
  if (tool === 'gltf.inspect') {
    try { return result(inspectGltf(readGlb(await readFile(resolve(project, input.path ?? ''))))); }
    catch (error) { return failure('GLTF_UNREADABLE', 'The model could not be read', error.message); }
  }
  if (tool === 'gltf.plan' || tool === 'gltf.apply') {
    const planned = await plan(resolve(project), input);
    if (planned.error) return planned.error;
    if (tool === 'gltf.plan') return result({...summary(planned), writes: false});
    if (planned.taken.length && input.force !== true) return failure('GLTF_ASSET_EXISTS', 'The assets are already declared', `${planned.taken.join(', ')} exist; pass a different name, or force=true to replace them.`, {ids: planned.taken});
    if (planned.importerStatus === 'changed' && input.force !== true) return failure('GLTF_IMPORTER_MODIFIED', 'The importer module was changed', `Refusing to overwrite ${IMPORTER_PATH}; review it, then pass force=true.`);
    const effects = [];
    await mkdir(resolve(project, dirname(IMPORTER_PATH)), {recursive: true});
    if (planned.importerStatus !== 'unchanged') { await writeFile(resolve(project, IMPORTER_PATH), planned.importer, 'utf8');effects.push(`wrote ${IMPORTER_PATH}`); }
    const config = planned.config;
    config.import ??= {};
    config.import.importers = {...config.import.importers, [IMPORTER_ID]: {module: IMPORTER_PATH, node: 'mesh'}};
    config.import.roots = {...config.import.roots, [planned.root]: config.import.roots?.[planned.root] ?? {description: `glTF models from ${planned.folder}`, candidates: [planned.folder.split(sep).join('/')]}};
    config.asset_manifest ??= planned.manifestPath;
    const manifest = planned.manifest;
    manifest.assets = [...(manifest.assets ?? []).filter(asset => !planned.assets.some(next => next.id === asset.id)), ...planned.assets];
    await writeFile(resolve(project, planned.manifestPath), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    effects.push(`declared ${planned.assets.map(asset => asset.id).join(' and ')} in ${planned.manifestPath}`);
    // The root is machine-local: other machines set their own folder.
    await mkdir(resolve(project, '.unone'), {recursive: true});
    await writeFile(resolve(project, '.unone/import-roots.json'), `${JSON.stringify({...planned.localRoots, [planned.root]: planned.folder.split(sep).join('/')}, null, 2)}\n`, 'utf8');
    if (planned.material && config.main_scene) {
      const scenePath = resolve(project, config.main_scene), scene = await readJson(scenePath, null);
      if (scene && !scene.materials?.[planned.base]) {
        scene.materials = {...scene.materials, [planned.base]: planned.material};
        await writeFile(scenePath, `${JSON.stringify(scene, null, 2)}\n`, 'utf8');
        effects.push(`added material "${planned.base}" to ${config.main_scene}`);
      }
    }
    await writeFile(resolve(project, 'project.unone.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    effects.push(`registered ${IMPORTER_ID} and import root "${planned.root}" in project.unone.json`);
    return result({...summary(planned), writes: true}, [], effects);
  }
  return failure('PLUGIN_TOOL_NOT_FOUND', 'Tool not found', `Unknown tool: ${tool}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lines = createInterface({input: process.stdin, crlfDelay: Infinity});
  for await (const line of lines) {
    if (!line.trim()) continue;
    let response;
    try {
      const request = JSON.parse(line);
      response = await call(request.tool, request.input || {}, request.project || process.env.UNONE_PROJECT_ROOT || process.cwd());
    } catch (error) {
      response = failure('PLUGIN_REQUEST_INVALID', 'Plugin request invalid', error.message);
    }
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}
