// Portable static mesh interchange. Animation/skinning are deliberately separate.
export function validateMesh(data) {
  const fail = message => { throw new Error(`MESH_INVALID: ${message}`); };
  if (!data || Object.keys(data).some(k => !['version','positions','uvs','indices','texture'].includes(k))) fail('unknown field');
  if (data.version !== 1) fail('version must be 1');
  const {positions:p, uvs:u, indices:i, texture:t} = data;
  if (!Array.isArray(p) || p.length < 9 || p.length % 3 || p.length > 3000000 || !p.every(Number.isFinite)) fail('positions');
  if (!Array.isArray(u) || u.length !== p.length / 3 * 2 || !u.every(Number.isFinite)) fail('uvs');
  if (!Array.isArray(i) || !i.length || i.length % 3 || i.length > 6000000 || !i.every(n => Number.isSafeInteger(n) && n >= 0 && n < p.length / 3)) fail('indices');
  if (typeof t !== 'string' || !t.length) fail('texture asset id');
  return data;
}

export function meshGeometry(THREE, data) {
  validateMesh(data);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
  geometry.setIndex(data.indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
