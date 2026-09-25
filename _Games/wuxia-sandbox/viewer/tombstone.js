const npcList = snapshot => {
  const value = snapshot?.observations?.view_model?.npc;
  return Array.isArray(value) ? value : [];
};
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function deadResidents(snapshot) {
  return npcList(snapshot).filter(npc => npc.alive === false);
}

export function tombstonePosition(snapshot, npc) {
  const supplied = npc?.cemetery_position;
  if (finite(supplied?.x) && finite(supplied?.z)) return {x: supplied.x, z: supplied.z};
  const position = snapshot?.entities?.[npc?.id]?.transform3d?.position;
  if (!finite(position?.x) || !finite(position?.z)) return null;
  return {x: position.x, z: position.z};
}

export function presentationCopy(snapshot) {
  const copy = {...snapshot, entities: {...(snapshot?.entities ?? {})}};
  for (const npc of deadResidents(snapshot)) {
    const entity = copy.entities[npc.id];
    if (!entity?.mesh3d) continue;
    copy.entities[npc.id] = {...entity, mesh3d: {...entity.mesh3d, visible: false}};
  }
  return copy;
}

export function portraitAsset(snapshot, npc) {
  return snapshot?.entities?.[npc?.id]?.mesh3d?.asset ?? '';
}

export function createTombstone(THREE, position, palette) {
  const group = new THREE.Group();
  const base = new THREE.Mesh(palette.baseGeometry, palette.baseMaterial);
  base.position.y = .1;
  const stone = new THREE.Mesh(palette.stoneGeometry, palette.stoneMaterial);
  stone.position.y = .76;
  stone.scale.set(.82, 1, .5);
  group.add(base, stone);
  group.position.set(position.x, .04, position.z);
  group.userData.tombstone = true;
  return group;
}
