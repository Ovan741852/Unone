// Mesh3D entities drawn as one instanced batch per mesh asset, so draw calls
// and GPU state scale with distinct assets rather than entity count. Matrices
// are packed in place each draw; nothing per entity is allocated. Primitive
// geometry/material are shared engine resources; asset meshes stay owned by
// the renderer's mesh asset records.
const PRIMITIVES = new Set(['mesh://primitive/box', 'mesh://primitive/sphere']);
const IDLE_DRAWS = 120;

export function createMeshEntityRenderer(THREE, scene, meshAssetFor) {
  const groups = new Map(), counts = new Map(), primitives = new Map();
  const object = new THREE.Object3D();
  let instances = 0, batches = 0;

  function primitive(asset) {
    let shared = primitives.get(asset);
    if (!shared) {
      shared = {geometry: asset.endsWith('/sphere') ? new THREE.SphereGeometry(0.5, 16, 12) : new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshNormalMaterial()};
      primitives.set(asset, shared);
    }
    return shared;
  }
  function retireGroup(asset, group) { scene.remove(group.mesh); group.mesh.dispose(); groups.delete(asset); }
  // A batch grows by powers of two and is rebuilt only when it outgrows its
  // capacity or its asset's geometry changes.
  function groupFor(asset, needed, specs) {
    const source = PRIMITIVES.has(asset) ? primitive(asset) : meshAssetFor(asset, specs);
    if (source.error) throw source.error;
    if (!source.geometry) return null;
    let group = groups.get(asset);
    if (group && group.capacity >= needed && group.mesh.geometry === source.geometry && group.mesh.material === source.material) return group;
    if (group) retireGroup(asset, group);
    const capacity = 2 ** Math.ceil(Math.log2(Math.max(16, needed)));
    const mesh = new THREE.InstancedMesh(source.geometry, source.material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled = false;mesh.count = 0;
    scene.add(mesh);
    group = {mesh, capacity, count: 0, idle: 0};groups.set(asset, group);
    return group;
  }
  // Returns true while a mesh asset is still loading.
  function draw(world, visible, specs) {
    let pending = false;
    const entities = world.entities ?? {};
    counts.clear();
    if (visible) for (const id in entities) {
      const mesh = entities[id].mesh3d;
      if (mesh?.visible && entities[id].transform3d) counts.set(mesh.asset, (counts.get(mesh.asset) ?? 0) + 1);
    }
    for (const [asset, needed] of counts) if (!groupFor(asset, needed, specs)) {pending = true;counts.delete(asset);}
    for (const group of groups.values()) group.count = 0;
    if (counts.size) {
      const bodies = world.physics3d?.bodies;
      for (const id in entities) {
        const entity = entities[id], mesh = entity.mesh3d, t = entity.transform3d;
        if (!mesh?.visible || !t || !counts.has(mesh.asset)) continue;
        const group = groups.get(mesh.asset), rotation = bodies?.[id]?.rotation;
        object.position.set(t.position.x, t.position.y, t.position.z);
        if (rotation) object.quaternion.set(rotation[0], rotation[1], rotation[2], rotation[3]);
        else object.rotation.set(t.rotation.x, t.rotation.y, t.rotation.z);
        object.scale.set(t.scale.x, t.scale.y, t.scale.z);object.updateMatrix();
        group.mesh.setMatrixAt(group.count++, object.matrix);
      }
    }
    instances = 0;batches = 0;
    for (const [asset, group] of groups) {
      group.mesh.count = group.count;group.mesh.visible = group.count > 0;
      if (group.count) {
        group.idle = 0;instances += group.count;batches++;
        const matrix = group.mesh.instanceMatrix;matrix.clearUpdateRanges();matrix.addUpdateRange(0, group.count * 16);matrix.needsUpdate = true;
      } else if (++group.idle > IDLE_DRAWS) retireGroup(asset, group);
    }
    return pending;
  }
  function clear() {
    for (const [asset, group] of groups) retireGroup(asset, group);
    for (const shared of primitives.values()) {shared.geometry.dispose();shared.material.dispose();}
    primitives.clear();instances = batches = 0;
  }
  return {
    draw, clear,
    contextLost(retire) {for (const group of groups.values()) retire(group.mesh);for (const shared of primitives.values()) {retire(shared.geometry);retire(shared.material);}},
    get count() {return instances;},
    get batches() {return batches;},
  };
}
