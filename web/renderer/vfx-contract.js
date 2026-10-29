// Declarative presentation values. Sampling never advances a simulation clock.
const fail = message => { throw new Error(`VFX_DECLARATION_INVALID: ${message}`); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9;
const fields = (value, allowed, name) => {
  if (!object(value)) fail(`${name} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${name}.${key} is unknown`);
};
const color = value => typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value);
function valueValid(value, parameters, name) {
  if (finite(value) || color(value)) return;
  if (Array.isArray(value) && value.length >= 2 && value.length <= 4 && value.every(finite)) return;
  if (!object(value)) fail(`${name} is not a finite value or expression`);
  if ('param' in value) {
    fields(value, ['param', 'multiply'], name);
    if (!parameters[value.param] || ('multiply' in value && !finite(value.multiply))) fail(`${name} has an invalid parameter`);
    return;
  }
  fields(value, ['keys', 'easing'], name);
  if (!Array.isArray(value.keys) || !value.keys.length || value.keys.length > 256) fail(`${name} needs curve keys`);
  if (value.easing !== undefined && !['linear', 'smooth', 'ease-in', 'ease-out'].includes(value.easing)) fail(`${name} easing`);
  let previous = -Infinity, signature;
  for (const key of value.keys) {
    if (!Array.isArray(key) || key.length !== 2 || !finite(key[0]) || key[0] <= previous) fail(`${name} keys must increase`);
    previous = key[0]; valueValid(key[1], parameters, name);
    if (object(key[1])) fail(`${name} keys cannot contain expressions`);
    const current = Array.isArray(key[1]) ? key[1].length : typeof key[1];
    if (signature !== undefined && signature !== current) fail(`${name} key types differ`);
    signature = current;
  }
}
export function validateEffect(definition) {
  const d = definition;
  fields(d, ['version', 'name', 'description', 'duration', 'scale', 'parameters', 'shaders', 'meshes', 'textures', 'layers'], 'effect');
  if (d.version !== 1 || !finite(d.duration) || d.duration <= 0 || d.duration > 120) fail('version 1 and duration in (0,120] required');
  const parameters = d.parameters ?? {};
  if (!object(parameters) || Object.keys(parameters).length > 64) fail('parameters');
  for (const [id, p] of Object.entries(parameters)) {
    if (!/^[A-Za-z][\w-]{0,63}$/.test(id)) fail('parameter name');
    fields(p, ['type', 'default', 'min', 'max', 'step', 'label', 'description'], `parameter ${id}`);
    if (!['number', 'color', 'vec2', 'vec3', 'vec4'].includes(p.type)) fail(`parameter ${id} type`);
    checkParameter(p, p.default, id);
    for (const key of ['min', 'max', 'step']) if (p[key] !== undefined && !finite(p[key])) fail(`parameter ${id}.${key}`);
    if (p.min !== undefined && p.max !== undefined && p.min > p.max) fail(`parameter ${id} bounds`);
  }
  if (d.scale !== undefined) valueValid(d.scale, parameters, 'scale');
  for (const [id, shader] of Object.entries(d.shaders ?? {})) {
    fields(shader, ['vertex', 'fragment', 'uniforms'], `shader ${id}`);
    for (const key of ['vertex', 'fragment']) if (typeof shader[key] !== 'string' || shader[key].length > 65536 || !/void\s+main\s*\(/.test(shader[key])) fail(`shader ${id}.${key}`);
    for (const [name, value] of Object.entries(shader.uniforms ?? {})) {
      if (!/^[A-Za-z_]\w{0,63}$/.test(name)) fail(`shader ${id} uniform name`);
      valueValid(value, parameters, `shader ${id}.${name}`);
    }
  }
  for (const [id, mesh] of Object.entries(d.meshes ?? {})) {
    fields(mesh, ['positions', 'normals', 'uvs', 'indices'], `mesh ${id}`);
    if (!Array.isArray(mesh.positions) || !mesh.positions.length || mesh.positions.length % (mesh.indices ? 3 : 9) || mesh.positions.length > 900000 || !mesh.positions.every(finite)) fail(`mesh ${id} positions`);
    if (mesh.indices && (!Array.isArray(mesh.indices) || mesh.indices.length % 3 || !mesh.indices.every(x => Number.isInteger(x) && x >= 0 && x < mesh.positions.length / 3))) fail(`mesh ${id} indices`);
    if (mesh.uvs && (mesh.uvs.length !== mesh.positions.length / 3 * 2 || !mesh.uvs.every(finite))) fail(`mesh ${id} UVs`);
    if (mesh.normals && (mesh.normals.length !== mesh.positions.length || !mesh.normals.every(finite))) fail(`mesh ${id} normals`);
  }
  for (const [id, texture] of Object.entries(d.textures ?? {})) {
    fields(texture, ['src', 'colorSpace', 'wrap'], `texture ${id}`);
    if (typeof texture.src !== 'string' || !texture.src || (texture.colorSpace !== undefined && !['srgb', 'linear'].includes(texture.colorSpace)) || (texture.wrap !== undefined && !['clamp', 'repeat'].includes(texture.wrap))) fail(`texture ${id}`);
  }
  if (!Array.isArray(d.layers) || !d.layers.length || d.layers.length > 128) fail('layers');
  const ids = new Set();
  for (const layer of d.layers) {
    fields(layer, ['id', 'label', 'kind', 'start', 'duration', 'geometry', 'material', 'position', 'rotation', 'scale', 'spin', 'repeat', 'from', 'to', 'width', 'jitter', 'segments', 'definition'], 'layer');
    if (typeof layer.id !== 'string' || !layer.id || ids.has(layer.id)) fail('unique layer IDs required'); ids.add(layer.id);
    if (!['mesh', 'ribbon', 'particles'].includes(layer.kind)) fail(`layer ${layer.id} kind`);
    if ((layer.start !== undefined && (!finite(layer.start) || layer.start < 0)) || !finite(layer.duration) || layer.duration <= 0) fail(`layer ${layer.id} time`);
    for (const key of ['position', 'rotation', 'scale', 'spin', 'from', 'to', 'width', 'jitter']) if (layer[key] !== undefined) valueValid(layer[key], parameters, `layer ${layer.id}.${key}`);
    if (layer.repeat) {
      fields(layer.repeat, ['count', 'radius', 'angle', 'arc'], 'repeat');
      if (!Number.isInteger(layer.repeat.count) || layer.repeat.count < 1 || layer.repeat.count > 256) fail('repeat count');
      for (const key of ['radius', 'angle', 'arc']) if (layer.repeat[key] !== undefined) valueValid(layer.repeat[key], parameters, `repeat.${key}`);
    }
    if (layer.kind === 'particles') {
      if (!object(layer.definition) || layer.definition.version !== 1 || !Array.isArray(layer.definition.emitters)) fail('native particle definition');
      continue; // The authoritative native particle parser validates its schema.
    }
    fields(layer.material, ['shader', 'color', 'opacity', 'intensity', 'texture', 'blend', 'depthWrite', 'side'], 'material');
    if (layer.material.shader !== undefined && !d.shaders?.[layer.material.shader]) fail(`unknown shader ${layer.material.shader}`);
    if (layer.material.texture && !d.textures?.[layer.material.texture]) fail(`unknown texture ${layer.material.texture}`);
    if (layer.material.blend !== undefined && !['normal', 'additive'].includes(layer.material.blend)) fail('material blend');
    for (const key of ['color', 'opacity', 'intensity']) if (layer.material[key] !== undefined) valueValid(layer.material[key], parameters, `material.${key}`);
    if (layer.kind === 'ribbon') {
      if (!Number.isInteger(layer.segments) || layer.segments < 1 || layer.segments > 256) fail('ribbon segments');
    } else {
      fields(layer.geometry, ['type', 'asset', 'radius', 'inner', 'height', 'width', 'segments'], 'geometry');
      if (!['mesh', 'plane', 'ring', 'sphere', 'cone', 'cylinder'].includes(layer.geometry.type)) fail('geometry type');
      if (layer.geometry.type === 'mesh' && !d.meshes?.[layer.geometry.asset]) fail('unknown mesh');
      for (const key of ['radius', 'inner', 'height', 'width', 'segments']) if (layer.geometry[key] !== undefined && (!finite(layer.geometry[key]) || layer.geometry[key] < 0)) fail(`geometry.${key}`);
    }
  }
  return d;
}
function checkParameter(p, value, name) {
  const valid = p.type === 'number' ? finite(value) : p.type === 'color' ? color(value) : Array.isArray(value) && value.length === Number(p.type.slice(3)) && value.every(finite);
  if (!valid) fail(`parameter ${name} value`);
}
export function parametersFor(definition, overrides = {}) {
  if (!object(overrides)) fail('parameter overrides');
  for (const key of Object.keys(overrides)) if (!definition.parameters?.[key]) fail(`unknown parameter ${key}`);
  return Object.fromEntries(Object.entries(definition.parameters ?? {}).map(([id, p]) => {
    const value = overrides[id] ?? p.default; checkParameter(p, value, id);
    return [id, Array.isArray(value) ? [...value] : value];
  }));
}
function interpolate(a, b, t) {
  if (Array.isArray(a)) return a.map((x, i) => x + (b[i] - x) * t);
  if (typeof a === 'number') return a + (b - a) * t;
  // Hex colors are also valid curve values.
  const channels = value => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
  return '#' + channels(a).map((x, i) => Math.round(x + (channels(b)[i] - x) * t).toString(16).padStart(2, '0')).join('');
}
export function sampleValue(value, parameters, phase) {
  if (!Number.isFinite(phase)) fail('sample phase');
  if (!object(value)) return Array.isArray(value) ? [...value] : value;
  if ('param' in value) {
    if (!(value.param in parameters)) fail(`unknown parameter ${value.param}`);
    const result = parameters[value.param], multiplier = value.multiply ?? 1;
    return Array.isArray(result) ? result.map(x => x * multiplier) : typeof result === 'number' ? result * multiplier : result;
  }
  const keys = value.keys;
  if (phase <= keys[0][0]) return structuredClone(keys[0][1]);
  for (let i = 1; i < keys.length; i++) if (phase <= keys[i][0]) {
    let t = (phase - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
    if (value.easing === 'smooth') t = t * t * (3 - 2 * t);
    if (value.easing === 'ease-in') t *= t;
    if (value.easing === 'ease-out') t = 1 - (1 - t) * (1 - t);
    return interpolate(keys[i - 1][1], keys[i][1], t);
  }
  return structuredClone(keys.at(-1)[1]);
}
export function layerPhase(layer, time) {
  if (!Number.isFinite(time)) fail('sample time');
  const start = layer.start ?? 0, duration = layer.duration;
  return {active: time >= start && time < start + duration, phase: Math.max(0, Math.min(1, (time - start) / duration))};
}
