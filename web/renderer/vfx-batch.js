import {validateEffect, parametersFor, sampleValue, layerPhase} from './vfx-contract.js';

const vector = (value, fallback) => value === undefined ? [...fallback] : Array.isArray(value) ? [...value] : [value, value, value];
const fail = message => { throw new Error(`VFX_SAMPLE_INVALID: ${message}`); };
function geometryFor(T, definition, layer) {
  if (layer.kind === 'ribbon') {
    const positions = [], uvs = [], indices = [], n = layer.segments;
    for (let i = 0; i <= n; i++) { positions.push(0, 0, 0, 0, 0, 0); uvs.push(0, i / n, 1, i / n); if (i < n) { const a = i * 2; indices.push(a, a + 1, a + 3, a, a + 3, a + 2); } }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(positions.map((_, i) => i % 3 === 2 ? 1 : 0), 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2)); g.setIndex(indices); return g;
  }
  const g = layer.geometry, radius = g.radius ?? 1;
  if (g.type === 'plane') return new T.PlaneGeometry(g.width ?? radius * 2, g.height ?? radius * 2);
  if (g.type === 'ring') return new T.RingGeometry(g.inner ?? radius * .8, radius, g.segments ?? 48);
  if (g.type === 'sphere') return new T.SphereGeometry(radius, g.segments ?? 16, 12);
  if (g.type === 'cone') return new T.ConeGeometry(radius, g.height ?? 1, g.segments ?? 8);
  if (g.type === 'cylinder') return new T.CylinderGeometry(radius, radius, g.height ?? 1, g.segments ?? 12);
  const source = definition.meshes[g.asset], result = new T.BufferGeometry();
  result.setAttribute('position', new T.Float32BufferAttribute(source.positions, 3));
  if (source.indices) result.setIndex(source.indices);
  if (source.uvs) result.setAttribute('uv', new T.Float32BufferAttribute(source.uvs, 2));
  else result.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(source.positions.length / 3 * 2), 2));
  if (source.normals) result.setAttribute('normal', new T.Float32BufferAttribute(source.normals, 3)); else result.computeVertexNormals();
  return result;
}
function shaderFor(T, definition, layer, geometry, capacity, textures) {
  const shader = definition.shaders[layer.material.shader] ?? {
    vertex: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragment: 'uniform vec3 uColor;uniform float uOpacity,uIntensity;void main(){gl_FragColor=vec4(uColor*uIntensity,uOpacity);}',
  }, uniforms = new Map();
  const declaration = /uniform\s+(float|vec[234]|sampler2D)\s+([^;]+);/g;
  for (const source of [shader.vertex, shader.fragment]) for (const match of source.matchAll(declaration)) for (const name of match[2].split(',').map(x => x.trim())) {
    if (!/^[A-Za-z_]\w*$/.test(name)) fail('unsupported uniform declaration');
    if (uniforms.has(name) && uniforms.get(name) !== match[1]) fail(`uniform ${name} type differs`);
    uniforms.set(name, match[1]);
  }
  if (layer.kind === 'ribbon') for (const [id, type] of [['vfxFrom', 'vec3'], ['vfxTo', 'vec3'], ['vfxWidth', 'float'], ['vfxJitter', 'float']]) uniforms.set(id, type);
  let offset = 0; const channels = new Map();
  for (const [name, type] of uniforms) if (type !== 'sampler2D') { const size = type === 'float' ? 1 : Number(type.slice(3)); channels.set(name, {offset, size}); offset += size; }
  const packs = Array.from({length: Math.ceil(offset / 4)}, (_, index) => {
    const attribute = new T.InstancedBufferAttribute(new Float32Array(capacity * 4), 4); attribute.setUsage(T.DynamicDrawUsage); geometry.setAttribute(`vfxA${index}`, attribute); return attribute;
  });
  const varying = packs.map((_, i) => `varying vec4 vfxV${i};`).join('\n');
  const macros = [...channels].map(([name, {offset: at, size}]) => {
    const entries = Array.from({length: size}, (_, k) => `vfxV${Math.floor((at + k) / 4)}.${'xyzw'[(at + k) % 4]}`);
    return `#define ${name} ${size === 1 ? entries[0] : `vec${size}(${entries.join(',')})`}`;
  }).join('\n');
  const attributes = packs.map((_, i) => `attribute vec4 vfxA${i};`).join('\n');
  const assignments = packs.map((_, i) => `vfxV${i}=vfxA${i};`).join('');
  let vertex = shader.vertex.replace(declaration, (whole, type) => type === 'sampler2D' ? whole : '');
  let fragment = shader.fragment.replace(declaration, (whole, type) => type === 'sampler2D' ? whole : '');
  if (layer.kind === 'ribbon') vertex = vertex.replace(/\bposition\b/g, 'vfxRibbon(uv)');
  vertex = vertex.replace(/\bmodelViewMatrix\b/g, '(modelViewMatrix*instanceMatrix)').replace(/\bnormalMatrix\b/g, 'vfxNormalMatrix()');
  const normal = `mat3 vfxNormalMatrix(){return normalMatrix*mat3(instanceMatrix[0].xyz/max(dot(instanceMatrix[0].xyz,instanceMatrix[0].xyz),1e-12),instanceMatrix[1].xyz/max(dot(instanceMatrix[1].xyz,instanceMatrix[1].xyz),1e-12),instanceMatrix[2].xyz/max(dot(instanceMatrix[2].xyz,instanceMatrix[2].xyz),1e-12));}`;
  const ribbon = layer.kind === 'ribbon' ? `vec3 vfxRibbon(vec2 st){vec3 d=vfxTo-vfxFrom;vec3 side=cross(normalize(d+vec3(0.,0.,1e-6)),vec3(0.,1.,0.));if(length(side)<.001)side=vec3(1.,0.,0.);side=normalize(side);float q=st.y;float j=sin(q*91.73+uSeed*.13)*sin(q*3.14159265)*vfxJitter;return mix(vfxFrom,vfxTo,q)+side*((st.x-.5)*vfxWidth+j);}` : '';
  // Ribbon seeds are useful even when an authored shader has no uSeed uniform.
  const ribbonSource = layer.kind === 'ribbon' && !channels.has('uSeed') ? ribbon.replace('uSeed*.13', '0.') : ribbon;
  vertex = `${attributes}\n${varying}\n${macros}\n${normal}\n${ribbonSource}\n${vertex.replace(/void\s+main\s*\(\s*\)\s*\{/, match => match + assignments)}`;
  fragment = `${varying}\n${macros}\n${fragment}`;
  const materialUniforms = {};
  for (const [name, type] of uniforms) if (type === 'sampler2D') {
    const texture = textures[layer.material.texture]; if (!texture) fail(`texture ${layer.material.texture} missing`); materialUniforms[name] = {value: texture};
  }
  const material = new T.ShaderMaterial({name: `vfx:${layer.id}`, uniforms: materialUniforms, vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: layer.material.depthWrite === true, side: T.DoubleSide, blending: layer.material.blend === 'normal' ? T.NormalBlending : T.AdditiveBlending});
  return {material, packs, channels, shader};
}
export function createVfxBatch({THREE: T, scene, capacity = 2048} = {}) {
  if (!T?.InstancedMesh || !scene || !Number.isInteger(capacity) || capacity < 1 || capacity > 65536) fail('THREE, scene and capacity required');
  const assets = new Map(), pools = []; let disposed = false, droppedCopies = 0;
  const root = new T.Object3D(), local = new T.Object3D(), matrix = new T.Matrix4();
  function register(id, definition, {textures = {}} = {}) {
    if (disposed || assets.has(id) || typeof id !== 'string' || !id) fail('asset ID invalid or already registered');
    validateEffect(definition); const records = [];
    try {
      for (const layer of definition.layers) {
        if (layer.kind === 'particles') continue;
        const geometry = geometryFor(T, definition, layer); let shader;
        try { shader = shaderFor(T, definition, layer, geometry, capacity, textures); } catch (error) { geometry.dispose(); throw error; }
        const mesh = new T.InstancedMesh(geometry, shader.material, capacity); mesh.name = `vfx-batch:${id}:${layer.id}`; mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); mesh.frustumCulled = false; mesh.count = 0; mesh.visible = false;
        const pool = {layer, mesh, geometry, ...shader, used: 0}; records.push(pool);
      }
    } catch (error) { for (const record of records) { record.geometry.dispose(); record.material.dispose(); } throw error; }
    for (const pool of records) { scene.add(pool.mesh); pools.push(pool); }
    assets.set(id, {definition, records}); return id;
  }
  function begin() { if (disposed) fail('batch disposed'); droppedCopies = 0; for (const p of pools) { p.used = 0; p.mesh.count = 0; p.mesh.visible = false; } }
  function submit(id, sample = {}) {
    if (disposed) fail('batch disposed'); const asset = assets.get(id); if (!asset) fail(`unknown asset ${id}`);
    const time = sample.time ?? 0, elapsed = sample.elapsed ?? time, seed = sample.seed ?? 0;
    if (![time, elapsed, seed].every(Number.isFinite)) fail('finite time, elapsed and seed required');
    for (const key of ['origin', 'rotation', 'scale']) if (sample[key] !== undefined && !(typeof sample[key] === 'number' ? Number.isFinite(sample[key]) : Array.isArray(sample[key]) && sample[key].length === 3 && sample[key].every(Number.isFinite))) fail(`finite ${key} required`);
    const parameters = parametersFor(asset.definition, sample.parameters ?? {}), scale = vector(sample.scale, [1, 1, 1]), definitionScale = sampleValue(asset.definition.scale ?? 1, parameters, time / asset.definition.duration);
    const globalScale = vector(definitionScale, [1, 1, 1]);
    root.position.fromArray(vector(sample.origin, [0, 0, 0])); root.rotation.fromArray([...vector(sample.rotation, [0, 0, 0]), 'XYZ']); root.scale.set(...scale.map((x, i) => x * globalScale[i])); root.updateMatrix();
    for (const p of asset.records) {
      const timing = layerPhase(p.layer, time); if (!timing.active) continue;
      const at = value => sampleValue(value, parameters, timing.phase), repeat = p.layer.repeat, count = repeat?.count ?? 1;
      const position = vector(at(p.layer.position ?? [0, 0, 0]), [0, 0, 0]), rotation = vector(at(p.layer.rotation ?? [0, 0, 0]), [0, 0, 0]), spin = vector(at(p.layer.spin ?? [0, 0, 0]), [0, 0, 0]), layerScale = vector(at(p.layer.scale ?? 1), [1, 1, 1]);
      const radius = at(repeat?.radius ?? 0), startAngle = at(repeat?.angle ?? 0), arc = at(repeat?.arc ?? Math.PI * 2);
      for (let i = 0; i < count; i++) {
        if (p.used >= capacity) { droppedCopies++; continue; }
        const angle = startAngle + (count > 1 ? i * arc / (arc < Math.PI * 2 ? count - 1 : count) : 0), n = p.used++;
        local.position.set(position[0] + Math.sin(angle) * radius, position[1], position[2] + Math.cos(angle) * radius);
        local.rotation.set(rotation[0] + spin[0] * timing.phase * p.layer.duration, rotation[1] + spin[1] * timing.phase * p.layer.duration + (repeat ? angle : 0), rotation[2] + spin[2] * timing.phase * p.layer.duration); local.scale.set(...layerScale); local.updateMatrix(); matrix.multiplyMatrices(root.matrix, local.matrix);
        if (!matrix.elements.every(Number.isFinite)) fail('matrix overflow'); p.mesh.setMatrixAt(n, matrix);
        const values = {uColor: at(p.layer.material.color ?? '#ffffff'), uOpacity: at(p.layer.material.opacity ?? 1), uIntensity: at(p.layer.material.intensity ?? 1), uTime: elapsed, uPhase: timing.phase, uSeed: seed, vfxFrom: at(p.layer.from ?? [0, 0, 0]), vfxTo: at(p.layer.to ?? [0, 0, 1]), vfxWidth: at(p.layer.width ?? .05), vfxJitter: at(p.layer.jitter ?? 0)};
        for (const [name, expression] of Object.entries(p.shader.uniforms ?? {})) values[name] = at(expression);
        for (const [name, channel] of p.channels) {
          let value = values[name]; if (value === undefined) fail(`uniform ${name} has no declaration value`);
          if (typeof value === 'string') { const c = new T.Color(value); value = [c.r, c.g, c.b]; }
          const numbers = Array.isArray(value) ? value : [value]; if (numbers.length !== channel.size || !numbers.every(Number.isFinite)) fail(`uniform ${name} type`);
          numbers.forEach((number, index) => { const offset = channel.offset + index; p.packs[Math.floor(offset / 4)].array[n * 4 + offset % 4] = number; });
        }
      }
    }
  }
  function inspect() { return {assets: assets.size, pools: pools.length, drawCalls: pools.filter(p => p.used > 0).length, copies: pools.reduce((sum, p) => sum + p.used, 0), droppedCopies, capacity}; }
  function end() { for (const p of pools) { p.mesh.count = p.used; p.mesh.visible = p.used > 0; p.mesh.instanceMatrix.needsUpdate = true; for (const attribute of p.packs) attribute.needsUpdate = true; } return inspect(); }
  function dispose() { if (disposed) return; disposed = true; for (const p of pools) { p.mesh.removeFromParent(); p.geometry.dispose(); p.material.dispose(); } pools.length = 0; assets.clear(); }
  return {register, begin, submit, end, inspect, dispose};
}
