// org.unone.render-effects: stylized render_extensions passes for the
// official Web player. One JSON request per stdin line, one EngineResult per
// stdout line (docs/plugin-protocol.md).
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const NAMES = ['crt', 'pixelate', 'grain', 'chromatic', 'posterize', 'ink'];
const TARGET = 'render/fx';
const SHARED = `${TARGET}/shared.js`;

const result = (value, diagnostics = [], effects = []) => ({ok: true, value, diagnostics, effects});
const diagnostic = (code, severity, summary, explanation, facts = {}) =>
  ({code, severity, summary, explanation, facts, likely_causes: [], suggested_actions: [], source: null});
const failure = (code, summary, explanation, facts) =>
  ({ok: false, value: null, diagnostics: [diagnostic(code, 'ERROR', summary, explanation, facts)], effects: []});

export async function loadEffects() {
  return Promise.all(NAMES.map(async name => {
    const module = await import(pathToFileURL(resolve(HERE, 'effects', `${name}.js`)).href);
    return {name, effect: module.effect, createPass: module.createPass};
  }));
}

function describe({name, effect}) {
  const defaults = Object.fromEntries(Object.entries(effect.params).map(([key, spec]) => [key, spec.default]));
  return {kind: effect.kind, name, title: effect.title, summary: effect.summary, keywords: effect.keywords, params: effect.params, defaults,
    module: `${TARGET}/${name}.js`, host: 'official Web player (WebGL); native rejects extension kinds'};
}

async function readText(path) {
  try { return await readFile(path, 'utf8'); } catch { return null; }
}

async function readJson(path, fallback) {
  const text = await readText(path);
  if (text === null) return {value: fallback, existed: false};
  return {value: JSON.parse(text), existed: true};
}

/** The files and JSON edits for installing `choices` into `project`. */
export async function plan(project, choices, {enabled = false} = {}) {
  const all = await loadEffects();
  if (!Array.isArray(choices) || !choices.length) return {error: failure('RENDER_EFFECTS_REQUIRED', 'Choose effects', 'Pass effects, such as ["fx.crt"] or ["crt"]; effects.list shows them.')};
  const chosen = [];
  for (const choice of choices) {
    const found = all.find(entry => entry.effect.kind === choice || entry.name === choice);
    if (!found) return {error: failure('RENDER_EFFECT_UNKNOWN', 'Unknown effect', `No effect '${choice}'. Known: ${all.map(entry => entry.effect.kind).join(', ')}.`, {choice})};
    if (!chosen.includes(found)) chosen.push(found);
  }
  const files = [];
  for (const [source, target] of [['shared.js', SHARED], ...chosen.map(entry => [`${entry.name}.js`, `${TARGET}/${entry.name}.js`])]) {
    const bytes = await readFile(resolve(HERE, 'effects', source), 'utf8');
    const existing = await readText(resolve(project, target));
    files.push({path: target, source, bytes, status: existing === null ? 'new' : existing === bytes ? 'unchanged' : 'changed'});
  }
  const presentationPath = resolve(project, 'player.presentation.json');
  const presentation = await readJson(presentationPath, {});
  const extensions = Array.isArray(presentation.value.render_extensions) ? [...presentation.value.render_extensions] : [];
  const addedExtensions = [];
  const conflicts = [];
  for (const entry of chosen) {
    const module = `${TARGET}/${entry.name}.js`;
    const existing = extensions.find(extension => extension.kind === entry.effect.kind);
    if (existing && existing.module !== module) conflicts.push(`render_extensions already maps ${entry.effect.kind} to ${existing.module}`);
    if (!existing) { const extension = {kind: entry.effect.kind, module, files: [SHARED]}; extensions.push(extension); addedExtensions.push(extension); }
  }
  const projectPath = resolve(project, 'project.unone.json');
  const config = await readJson(projectPath, null);
  if (!config.existed) return {error: failure('PROJECT_CONFIG_MISSING', 'No project.unone.json', `Run this from a Unone project; ${projectPath} was not found.`)};
  const notes = [];
  let pipeline = config.value.render_pipeline;
  const created = !pipeline;
  if (created) {
    pipeline = {version: 1, passes: [{id: 'world', kind: 'scene'}]};
    // A declared pipeline replaces presentation Bloom; keep the look.
    if (presentation.value.bloom === true) { pipeline.passes.push({id: 'glow', kind: 'bloom'}); notes.push('presentation bloom was on, so the new render_pipeline keeps a bloom pass'); }
  } else {
    pipeline = structuredClone(pipeline);
  }
  const addedPasses = [];
  for (const entry of chosen) {
    if (pipeline.passes.some(pass => pass.kind === entry.effect.kind)) continue;
    let id = entry.name;
    if (pipeline.passes.some(pass => pass.id === id)) id = `fx-${entry.name}`;
    const pass = {id, kind: entry.effect.kind, enabled, params: describe(entry).defaults};
    // Extensions run after the built-in post passes and before projected/ui.
    const at = pipeline.passes.findIndex(existing => existing.kind === 'projected' || existing.kind === 'ui');
    if (at < 0) pipeline.passes.push(pass); else pipeline.passes.splice(at, 0, pass);
    addedPasses.push(pass);
  }
  if (!enabled && addedPasses.length) notes.push(`passes are added disabled; turn one on with api.render.setPass("${addedPasses[0].id}", {enabled = true})`);
  notes.push('extension passes run in the official Web player only; native exports reject them (NATIVE_RENDER_PASS_UNSUPPORTED)');
  return {chosen, files, conflicts, notes,
    presentation: {path: 'player.presentation.json', value: {...presentation.value, render_extensions: extensions}, added: addedExtensions},
    pipeline: {path: 'project.unone.json', config: {...config.value, render_pipeline: pipeline}, created, added: addedPasses}};
}

function summary(planned) {
  return {
    effects: planned.chosen.map(entry => entry.effect.kind),
    files: planned.files.map(({path, status}) => ({path, status})),
    render_extensions_added: planned.presentation.added,
    render_pipeline: {created: planned.pipeline.created, passes_added: planned.pipeline.added},
    conflicts: planned.conflicts,
    notes: planned.notes,
  };
}

export async function call(tool, input = {}, project = process.env.UNONE_PROJECT_ROOT || process.cwd()) {
  if (tool === 'effects.list') return result({effects: (await loadEffects()).map(describe)});
  if (tool === 'plugin.test') {
    const problems = [];
    for (const entry of await loadEffects()) {
      const {effect} = entry;
      if (!/^fx\.[a-z]+$/.test(effect.kind)) problems.push(`${entry.name}: kind ${effect.kind}`);
      for (const [key, spec] of Object.entries(effect.params)) {
        if (spec.type === 'number' && !(spec.min <= spec.default && spec.default <= spec.max)) problems.push(`${entry.name}.${key}: default outside range`);
      }
      const recorded = [];
      const THREE = {
        ShaderMaterial: class { constructor(options) { Object.assign(this, options); } dispose() {} },
        Vector2: class { set(x, y) { this.x = x; this.y = y; return this; } },
        Color: class { set(value) { this.value = value; return this; } },
      };
      const pass = entry.createPass({THREE, id: entry.name, params: {}});
      pass.draw({input: 'input-texture', output: null, params: {}, width: 64, height: 32, fullscreen: (material, target) => recorded.push({material, target})});
      const material = recorded[0]?.material;
      if (!material || material.uniforms.image.value !== 'input-texture' || !material.fragmentShader.includes('#include <colorspace_fragment>')) problems.push(`${entry.name}: draw`);
      pass.dispose();
    }
    return problems.length ? failure('RENDER_EFFECTS_SELF_TEST_FAILED', 'Self-test failed', problems.join('; '), {problems}) : result({self_test: 'passed', effects: NAMES.length});
  }
  if (tool === 'effects.plan' || tool === 'effects.apply') {
    const planned = await plan(resolve(project), input.effects, {enabled: input.enabled === true});
    if (planned.error) return planned.error;
    if (tool === 'effects.plan') return result({...summary(planned), writes: false});
    const changed = planned.files.filter(file => file.status === 'changed');
    if (planned.conflicts.length) return failure('RENDER_EFFECT_CONFLICT', 'An effect kind is already declared', planned.conflicts.join('; '), {conflicts: planned.conflicts});
    if (changed.length && input.force !== true) return failure('RENDER_EFFECT_MODIFIED', 'An installed module was changed', `Refusing to overwrite ${changed.map(file => file.path).join(', ')}; review the edits, then pass force=true.`, {paths: changed.map(file => file.path)});
    const effects = [];
    for (const file of planned.files.filter(file => file.status !== 'unchanged')) {
      await mkdir(dirname(resolve(project, file.path)), {recursive: true});
      await writeFile(resolve(project, file.path), file.bytes, 'utf8');
      effects.push(`wrote ${file.path}`);
    }
    if (planned.presentation.added.length) {
      await writeFile(resolve(project, planned.presentation.path), `${JSON.stringify(planned.presentation.value, null, 2)}\n`, 'utf8');
      effects.push(`declared ${planned.presentation.added.map(extension => extension.kind).join(', ')} in player.presentation.json`);
    }
    if (planned.pipeline.added.length || planned.pipeline.created) {
      await writeFile(resolve(project, planned.pipeline.path), `${JSON.stringify(planned.pipeline.config, null, 2)}\n`, 'utf8');
      effects.push(`added ${planned.pipeline.added.map(pass => pass.id).join(', ')} to project.unone.json render_pipeline`);
    }
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
