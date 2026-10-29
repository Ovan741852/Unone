import {createVfxBatch} from './vfx-batch.js';
import {parametersFor, sampleValue, layerPhase} from './vfx-contract.js';
import {createParticleRenderer} from './particles.js';

// A shared player for externally clocked declarations; simulation remains in Luau.
export function createVfxPlayer({THREE: T, scene, camera, capacity = 2048, nativeSampler} = {}) {
  const batch = createVfxBatch({THREE: T, scene, capacity}), definitions = new Map();
  const particles = createParticleRenderer(T, scene), snapshots = [], root = new T.Object3D(), point = new T.Vector3();
  let disposed = false, particleDrops = 0;
  function register(id, definition, options) { if (definition.layers.some(layer => layer.kind === 'particles') && !nativeSampler?.sample) throw Error('VFX_NATIVE_SAMPLER_REQUIRED'); batch.register(id, definition, options); definitions.set(id, definition); }
  function begin() { batch.begin(); snapshots.length = 0; particleDrops = 0; }
  function submit(id, sample = {}) {
    batch.submit(id, sample); const definition = definitions.get(id), parameters = parametersFor(definition, sample.parameters ?? {}), time = sample.time ?? 0;
    const v3 = (value, fallback) => value === undefined ? fallback : Array.isArray(value) ? value : [value, value, value];
    root.position.fromArray(v3(sample.origin, [0, 0, 0])); root.rotation.fromArray([...v3(sample.rotation, [0, 0, 0]), 'XYZ']);
    const size = v3(sample.scale, [1, 1, 1]), assetSize = v3(sampleValue(definition.scale ?? 1, parameters, time / definition.duration), [1, 1, 1]); root.scale.set(...size.map((v, i) => v * assetSize[i])); root.updateMatrix();
    for (const layer of definition.layers) {
      const phase = layerPhase(layer, time); if (layer.kind !== 'particles' || !phase.active) continue;
      const local = new T.Object3D(); local.position.fromArray(v3(sampleValue(layer.position ?? [0, 0, 0], parameters, phase.phase), [0, 0, 0])); local.rotation.fromArray([...v3(sampleValue(layer.rotation ?? [0, 0, 0], parameters, phase.phase), [0, 0, 0]), 'XYZ']); local.scale.set(...v3(sampleValue(layer.scale ?? 1, parameters, phase.phase), [1, 1, 1])); local.updateMatrix(); local.matrix.premultiply(root.matrix);
      const rows = nativeSampler.sample(layer.definition, {seed: sample.seed ?? 0, frame: Math.floor((time - (layer.start ?? 0)) * 60 + 1e-8), position: [0, 0, 0]});
      const scale = Math.max(...root.scale.toArray().map(Math.abs)) * Math.max(...local.scale.toArray().map(Math.abs));
      for (const row of rows) {
        if (snapshots.length >= capacity * 2) { particleDrops++; continue; }
        point.set(row.position.x, row.position.y, row.position.z).applyMatrix4(local.matrix);
        snapshots.push({...row, position: {x: point.x, y: point.y, z: point.z}, size: row.size * scale});
      }
    }
  }
  function inspect() { const mesh = batch.inspect(); return {...mesh, drawCalls: mesh.drawCalls + particles.drawCalls, nativeParticles: snapshots.length, droppedParticles: particleDrops}; }
  function end() { batch.end(); particles.draw(snapshots, camera); return inspect(); }
  function preflight(renderer, selectedCamera = camera) {
    if (!renderer?.compile || !selectedCamera) throw Error('VFX_PREFLIGHT_RENDERER_REQUIRED');
    const debug = renderer.debug, previous = debug?.onShaderError, check = debug?.checkShaderErrors;
    if (debug) { debug.checkShaderErrors = true; debug.onShaderError = (gl, program, vertex, fragment) => { throw Error(`VFX_SHADER_COMPILE_FAILED: ${gl.getProgramInfoLog(program)} ${gl.getShaderInfoLog(vertex)} ${gl.getShaderInfoLog(fragment)}`); }; }
    const visibility = scene.children.map(child => [child, child.visible]);
    try { for (const [child] of visibility) if (child.name.startsWith('vfx-batch:')) child.visible = true; renderer.compile(scene, selectedCamera); }
    finally { for (const [child, visible] of visibility) child.visible = visible; if (debug) { debug.onShaderError = previous; debug.checkShaderErrors = check; } }
  }
  function dispose() { if (disposed) return; disposed = true; batch.dispose(); particles.dispose(); definitions.clear(); snapshots.length = 0; }
  return {register, begin, submit, end, inspect, preflight, dispose};
}
