// Mesh3D entities drawn as one instanced batch per mesh asset and material,
// so draw calls and GPU state scale with distinct pairs rather than entity
// count. Matrices are packed in place each draw; nothing per entity is
// allocated. Primitive geometry/material are shared engine resources; asset
// meshes stay owned by the renderer's mesh asset records. A batch with a
// material (docs/materials.md) owns its two Three materials.
const PRIMITIVES = new Set(['mesh://primitive/box', 'mesh://primitive/sphere']);
const IDLE_DRAWS = 120;
const SEPARATOR = '\u0001';

// lighting (lighting.js) switches lit scenes to each source's litMaterial.
export function createMeshEntityRenderer(THREE, scene, meshAssetFor, lighting = null) {
  const groups = new Map(), counts = new Map(), primitives = new Map();
  const object = new THREE.Object3D();
  let instances = 0, batches = 0;

  function primitive(asset) {
    let shared = primitives.get(asset);
    if (!shared) {
      // Lit primitives use native's flat primitive colour (230, 236, 245).
      shared = {geometry: asset.endsWith('/sphere') ? new THREE.SphereGeometry(0.5, 16, 12) : new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshNormalMaterial(),
        litMaterial: new THREE.MeshLambertMaterial({color: 0xe6ecf5})};
      primitives.set(asset, shared);
    }
    return shared;
  }
  // A material multiplies the mesh texture; primitives with one start from
  // white. Unlit scenes show the colour only; lit ones shade it physically.
  function materialPair(source) {
    const map = source.material?.map ?? null, side = map ? THREE.DoubleSide : THREE.FrontSide;
    const alphaTest = map ? 0.05 : 0;
    return {unlit: new THREE.MeshBasicMaterial({map, side, alphaTest}), lit: new THREE.MeshStandardMaterial({map, side, alphaTest})};
  }
  function applyMaterial(pair, definition) {
    pair.unlit.color.set(definition.color);
    pair.lit.color.set(definition.color);
    pair.lit.metalness = definition.metallic;
    pair.lit.roughness = definition.roughness;
    pair.lit.emissive.set(definition.emissive);
    pair.lit.emissiveIntensity = definition.emissive_intensity;
  }
  function retireGroup(key, group) {
    scene.remove(group.mesh); group.mesh.dispose();
    if (group.pair) {group.pair.unlit.dispose();group.pair.lit.dispose();}
    groups.delete(key);
  }
  // A batch grows by powers of two and is rebuilt only when it outgrows its
  // capacity or its asset's geometry changes.
  function groupFor(key, needed, specs) {
    const [asset, materialName] = key.split(SEPARATOR);
    const source = PRIMITIVES.has(asset) ? primitive(asset) : meshAssetFor(asset, specs);
    if (source.error) throw source.error;
    if (!source.geometry) return null;
    let group = groups.get(key);
    if (group && group.capacity >= needed && group.mesh.geometry === source.geometry && group.source === source && group.material === source.material) return group;
    if (group) retireGroup(key, group);
    const capacity = 2 ** Math.ceil(Math.log2(Math.max(16, needed)));
    const pair = materialName ? materialPair(source) : null;
    const mesh = new THREE.InstancedMesh(source.geometry, pair?.unlit ?? source.material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled = false;mesh.count = 0;
    scene.add(mesh);
    group = {mesh, source, material: source.material, pair, materialName, capacity, count: 0, idle: 0};groups.set(key, group);
    return group;
  }
  const keyOf = mesh => mesh.material ? mesh.asset + SEPARATOR + mesh.material : mesh.asset;
  // Returns true while a mesh asset is still loading.
  function draw(world, visible, specs) {
    let pending = false;
    const entities = world.entities ?? {}, materials = world.materials ?? {};
    counts.clear();
    if (visible) for (const id in entities) {
      const mesh = entities[id].mesh3d;
      if (mesh?.visible && entities[id].transform3d) counts.set(keyOf(mesh), (counts.get(keyOf(mesh)) ?? 0) + 1);
    }
    for (const [key, needed] of counts) if (!groupFor(key, needed, specs)) {pending = true;counts.delete(key);}
    for (const group of groups.values()) group.count = 0;
    if (counts.size) {
      const bodies = world.physics3d?.bodies;
      for (const id in entities) {
        const entity = entities[id], mesh = entity.mesh3d, t = entity.transform3d;
        if (!mesh?.visible || !t || !counts.has(keyOf(mesh))) continue;
        const group = groups.get(keyOf(mesh)), rotation = bodies?.[id]?.rotation;
        object.position.set(t.position.x, t.position.y, t.position.z);
        if (rotation) object.quaternion.set(rotation[0], rotation[1], rotation[2], rotation[3]);
        else object.rotation.set(t.rotation.x, t.rotation.y, t.rotation.z);
        object.scale.set(t.scale.x, t.scale.y, t.scale.z);object.updateMatrix();
        group.mesh.setMatrixAt(group.count++, object.matrix);
      }
    }
    instances = 0;batches = 0;
    for (const [key, group] of groups) {
      group.mesh.count = group.count;group.mesh.visible = group.count > 0;
      const definition = group.materialName ? materials[group.materialName] : null;
      if (group.pair && definition) {
        applyMaterial(group.pair, definition);
        if (lighting) lighting.dress(group.mesh, group.pair.unlit, group.pair.lit); else group.mesh.material = group.pair.unlit;
      } else lighting?.dress(group.mesh, group.source.material, group.source.litMaterial ?? group.source.material);
      if (group.count) {
        group.idle = 0;instances += group.count;batches++;
        const matrix = group.mesh.instanceMatrix;matrix.clearUpdateRanges();matrix.addUpdateRange(0, group.count * 16);matrix.needsUpdate = true;
      } else if (++group.idle > IDLE_DRAWS) retireGroup(key, group);
    }
    return pending;
  }
  function clear() {
    for (const [key, group] of groups) retireGroup(key, group);
    for (const shared of primitives.values()) {shared.geometry.dispose();shared.material.dispose();shared.litMaterial.dispose();}
    primitives.clear();instances = batches = 0;
  }
  return {
    draw, clear,
    contextLost(retire) {
      for (const group of groups.values()) {retire(group.mesh);if (group.pair) {retire(group.pair.unlit);retire(group.pair.lit);}}
      for (const shared of primitives.values()) {retire(shared.geometry);retire(shared.material);retire(shared.litMaterial);}
    },
    get count() {return instances;},
    get batches() {return batches;},
  };
}
