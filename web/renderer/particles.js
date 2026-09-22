// Batched camera-facing particle quads. Geometry, textures and alpha groups are
// pooled by authored shape/blend; particles never allocate individual Sprites.
const SHAPES = ['soft_circle', 'diamond', 'ring', 'streak'];
const ALPHA_BINS = 8;
const COLOR_BINS = 8;

function makeTexture(THREE, shape) {
  const size = 32, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size * 2 - 1, v = (y + .5) / size * 2 - 1;
    const radius = Math.hypot(u, v);
    let alpha = 1 - smoothstep(.72, 1, radius);
    if (shape === 'ring') alpha = (1 - smoothstep(.10, .24, Math.abs(radius - .72))) * (1 - smoothstep(.90, 1, radius));
    else if (shape === 'diamond') alpha = 1 - smoothstep(.82, 1, Math.abs(u) + Math.abs(v));
    else if (shape === 'streak') alpha = 1 - smoothstep(.72, 1, Math.hypot(u * 2.6, v));
    const index = (y * size + x) * 4;
    pixels[index] = pixels[index + 1] = pixels[index + 2] = 255;
    pixels[index + 3] = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.flipY = false; texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
  return texture;
}

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function capacityFor(count) { return 2 ** Math.ceil(Math.log2(Math.max(1, count))); }
function colorBin(value) { return Math.max(0, Math.min(COLOR_BINS - 1, Math.round(Math.max(0, Math.min(1, value)) * (COLOR_BINS - 1)))); }

export function createParticleRenderer(THREE, scene) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const textures = new Map(SHAPES.map(shape => [shape, makeTexture(THREE, shape)]));
  const groups = new Map();
  const object = new THREE.Object3D(), identity = new THREE.Quaternion();
  let count = 0, disposed = false;

  function disposeGroup(group) {
    scene.remove(group.mesh); group.material.dispose();
  }
  function createGroup(key, shape, additive, alphaBin, tint, capacity) {
    const material = new THREE.MeshBasicMaterial({
      map: textures.get(shape), color: tint, vertexColors: false, transparent: true,
      opacity: alphaBin / (ALPHA_BINS - 1), alphaTest: 0.01, depthTest: true, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = (additive ? 100 : 0) + alphaBin;
    mesh.count = 0;
    scene.add(mesh);
    const group = {mesh, material, capacity, shape, additive, alphaBin};
    groups.set(key, group);
    return group;
  }

  function draw(samples = [], camera = null) {
    if (disposed) return;
    const pending = new Map(); count = 0;
    for (const particle of samples) {
      const alpha = Math.max(0, Math.min(1, Number(particle.color?.[3] ?? 1)));
      if (alpha <= 0 || !(particle.size > 0)) continue;
      const shape = SHAPES.includes(particle.sprite_shape) ? particle.sprite_shape : 'soft_circle';
      const alphaBin = Math.max(1, Math.min(ALPHA_BINS - 1, Math.round(alpha * (ALPHA_BINS - 1))));
      const additive = particle.additive === true;
      const rBin = colorBin(particle.color?.[0] ?? 1), gBin = colorBin(particle.color?.[1] ?? 1), bBin = colorBin(particle.color?.[2] ?? 1);
      const key = `${shape}|${additive ? 1 : 0}|${alphaBin}|${rBin}|${gBin}|${bBin}`;
      let list = pending.get(key); if (!list) pending.set(key, list = []);
      list.push(particle); count++;
    }

    const cameraPosition = camera?.position;
    const cameraQuaternion = camera?.quaternion;
    for (const [key, particles] of pending) {
      const [shape, blend, alphaText, rText, gText, bText] = key.split('|'), additive = blend === '1', alphaBin = Number(alphaText);
      const tint = new THREE.Color(Number(rText) / (COLOR_BINS - 1), Number(gText) / (COLOR_BINS - 1), Number(bText) / (COLOR_BINS - 1));
      if (!additive && cameraPosition) particles.sort((a, b) => {
        const da = (a.position.x-cameraPosition.x)**2+(a.position.y-cameraPosition.y)**2+(a.position.z-cameraPosition.z)**2;
        const db = (b.position.x-cameraPosition.x)**2+(b.position.y-cameraPosition.y)**2+(b.position.z-cameraPosition.z)**2;
        return db-da;
      });
      let group = groups.get(key);
      if (!group || group.capacity < particles.length) {
        if (group) disposeGroup(group);
        group = createGroup(key, shape, additive, alphaBin, tint, capacityFor(particles.length));
      }
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        object.position.set(p.position.x, p.position.y, p.position.z);
        object.quaternion.copy(cameraQuaternion ?? identity);
        object.rotateZ(p.rotation ?? 0);
        object.scale.set(p.size, p.size, 1);
        object.updateMatrix(); group.mesh.setMatrixAt(i, object.matrix);
      }
      group.mesh.count = particles.length;
      group.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const [key, group] of groups) if (!pending.has(key)) group.mesh.count = 0;
  }

  return {
    draw,
    get count() { return count; },
    get drawCalls() { let total=0; for (const group of groups.values()) if (group.mesh.count > 0) total++; return total; },
    get debugBatches() { return [...groups].map(([key,group])=>({key,count:group.mesh.count,firstMatrix:[...group.mesh.instanceMatrix.array.slice(0,16)]})); },
    dispose() {
      if (disposed) return; disposed = true;
      for (const group of groups.values()) disposeGroup(group);
      groups.clear(); geometry.dispose(); for (const texture of textures.values()) texture.dispose(); textures.clear(); count = 0;
    },
  };
}
