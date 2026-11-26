// Batched camera-facing particle quads. Geometry, textures and alpha groups are
// pooled by authored shape or image/blend; particles never allocate individual Sprites.
// Image particles (emitter `texture`) borrow the sprite texture cache through
// options.imageTexture(id); until an image is ready its particles draw sprite_shape.
// A flipbook particle's `uv` cell is its own source: a Texture clone with offset/repeat
// that shares the image's GPU source, disposed here (the image itself is not ours).
const SHAPES = ['soft_circle', 'diamond', 'ring', 'streak'];
const ALPHA_BINS = 8;
const COLOR_BINS = 8;
const IDLE_GROUP_FRAMES = 120;

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

export function createParticleRenderer(THREE, scene, { imageTexture = null } = {}) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const textures = new Map(SHAPES.map(shape => [shape, makeTexture(THREE, shape)]));
  // Sources are the four shapes, then each image id in the order first drawn; a group's key holds its source index.
  const sources = [...SHAPES], sourceIndex = new Map(SHAPES.map((shape, i) => [shape, i])), frameImages = new Map(), cellTextures = new Map();
  const isImage = source => source.startsWith('image:');
  function sourceFor(particle) {
    const id = typeof particle.texture === 'string' && particle.texture ? particle.texture : null;
    if (id && imageTexture) {
      let ready = frameImages.get(id);
      if (ready === undefined) { ready = !!imageTexture(id); frameImages.set(id, ready); }
      if (ready) { const uv = Array.isArray(particle.uv) && particle.uv.length === 4 ? particle.uv : null; const source = 'image:' + id + (uv ? '#' + uv.join(',') : ''); let index = sourceIndex.get(source); if (index === undefined) { index = sources.length; sources.push(source); sourceIndex.set(source, index); } return index; }
    }
    return Math.max(0, SHAPES.indexOf(particle.sprite_shape));
  }
  function mapFor(source) {
    if (!isImage(source)) return textures.get(source);
    const hash = source.indexOf('#'), image = imageTexture(hash < 0 ? source.slice(6) : source.slice(6, hash));
    if (hash < 0 || !image) return image;
    let cell = cellTextures.get(source);
    if (!cell || cell.source !== image.source) {
      cell?.dispose(); const [u, v, w, h] = source.slice(hash + 1).split(',').map(Number);
      cell = image.clone(); cell.offset.set(u, image.flipY ? 1 - v - h : v); cell.repeat.set(w, h); cellTextures.set(source, cell);
    }
    return cell;
  }
  function cellAspect(source) { const hash = source.indexOf('#'); if (hash < 0) return 1; const [, , w, h] = source.slice(hash + 1).split(',').map(Number); return w > 0 && h > 0 ? w / h : 1; }
  function aspectOf(map) { const image = map?.image; const w = Number(image?.naturalWidth ?? image?.width), h = Number(image?.naturalHeight ?? image?.height); return w > 0 && h > 0 ? w / h : 1; }
  const groups = new Map(), pending = new Map();
  const object = new THREE.Object3D(), identity = new THREE.Quaternion();
  let count = 0, retainedCapacity = 0, compactions = 0, disposed = false;

  function disposeGroup(group) {
    scene.remove(group.mesh); group.mesh.dispose(); group.material.dispose();retainedCapacity-=group.capacity;
  }
  function createGroup(key, shape, additive, alphaBin, tint, capacity) {
    const map = mapFor(shape);
    const material = new THREE.MeshBasicMaterial({
      map, color: tint, vertexColors: false, transparent: true,
      opacity: alphaBin / (ALPHA_BINS - 1), alphaTest: 0.01, depthTest: true, depthWrite: false,
      // One pass: three.js otherwise draws transparent DoubleSide twice and re-flags the material before each pass.
      side: THREE.DoubleSide, forceSinglePass: true, toneMapped: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = (additive ? 100 : 0) + alphaBin;
    mesh.count = 0; mesh.visible = false;
    scene.add(mesh);
    const group = {mesh, material, capacity, shape, additive, alphaBin, idleFrames:0, aspect:isImage(shape)?aspectOf(map)*cellAspect(shape):1,
      debugKey:`${shape}|${additive?1:0}|${alphaBin}|${Math.round(tint.r*(COLOR_BINS-1))}|${Math.round(tint.g*(COLOR_BINS-1))}|${Math.round(tint.b*(COLOR_BINS-1))}`};
    groups.set(key, group);
    retainedCapacity+=capacity;
    return group;
  }

  function compactPool() {
    let planned=retainedCapacity;
    for(const [key,list] of pending)if(list.length){const old=groups.get(key)?.capacity??0;if(old<list.length)planned+=capacityFor(list.length)-old;}
    // Active bins need less than twice their live count after power-of-two rounding.
    // Keep short-term headroom; crossing the high-water budget compacts toward a separate
    // low-water budget, so a stable scene does not resize buffers on subsequent frames.
    const high=Math.max(4096,count*4),low=Math.max(2048,count*2);
    if(planned<=high)return;
    const candidates=[];
    for(const [key,group] of groups){const n=pending.get(key)?.length??0,needed=n?capacityFor(n):0;
      if(group.capacity>needed)candidates.push({key,group,needed,saving:group.capacity-needed});}
    candidates.sort((a,b)=>b.saving-a.saving);compactions++;
    for(const {key,group,needed,saving} of candidates){
      if(planned<=low)break;
      const tint=group.material.color;disposeGroup(group);groups.delete(key);
      if(needed)createGroup(key,group.shape,group.additive,group.alphaBin,tint,needed);
      else pending.delete(key);
      planned-=saving;
    }
  }

  function draw(samples = [], camera = null) {
    if (disposed) return;
    for(const list of pending.values())list.length=0;
    count = 0; frameImages.clear();
    for (const particle of samples) {
      const alpha = Math.max(0, Math.min(1, Number(particle.color?.[3] ?? 1)));
      if (alpha <= 0 || !(particle.size > 0)) continue;
      const shapeIndex=sourceFor(particle);
      const alphaBin = Math.max(1, Math.min(ALPHA_BINS - 1, Math.round(alpha * (ALPHA_BINS - 1))));
      const additive = particle.additive === true;
      const rBin = colorBin(particle.color?.[0] ?? 1), gBin = colorBin(particle.color?.[1] ?? 1), bBin = colorBin(particle.color?.[2] ?? 1);
      // Numeric bins avoid allocating a temporary string for every particle on every draw.
      const key=((((shapeIndex*2+(additive?1:0))*ALPHA_BINS+alphaBin)*COLOR_BINS+rBin)*COLOR_BINS+gBin)*COLOR_BINS+bBin;
      let list = pending.get(key); if (!list) pending.set(key, list = []);
      list.push(particle); count++;
    }

    compactPool();
    const cameraPosition = camera?.position;
    const cameraQuaternion = camera?.quaternion;
    for (const [key, particles] of pending) {
      if(!particles.length)continue;
      let group = groups.get(key);
      const additive=group?.additive??particles[0].additive===true;
      if (!additive && cameraPosition) particles.sort((a, b) => {
        const da = (a.position.x-cameraPosition.x)**2+(a.position.y-cameraPosition.y)**2+(a.position.z-cameraPosition.z)**2;
        const db = (b.position.x-cameraPosition.x)**2+(b.position.y-cameraPosition.y)**2+(b.position.z-cameraPosition.z)**2;
        return db-da;
      });
      if (!group || group.capacity < particles.length) {
        let packed=key;
        const bBin=packed%COLOR_BINS;packed=Math.floor(packed/COLOR_BINS);
        const gBin=packed%COLOR_BINS;packed=Math.floor(packed/COLOR_BINS);
        const rBin=packed%COLOR_BINS;packed=Math.floor(packed/COLOR_BINS);
        const alphaBin=packed%ALPHA_BINS,shape=sources[Math.floor(packed/ALPHA_BINS/2)];
        const tint = new THREE.Color(rBin / (COLOR_BINS - 1), gBin / (COLOR_BINS - 1), bBin / (COLOR_BINS - 1));
        if (group) disposeGroup(group);
        group = createGroup(key, shape, additive, alphaBin, tint, capacityFor(particles.length));
      }
      group.idleFrames=0;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        object.position.set(p.position.x, p.position.y, p.position.z);
        object.quaternion.copy(cameraQuaternion ?? identity);
        object.rotateZ(p.rotation ?? 0);
        object.scale.set(p.size * group.aspect, p.size, 1);
        object.updateMatrix(); group.mesh.setMatrixAt(i, object.matrix);
      }
      group.mesh.count = particles.length; group.mesh.visible = particles.length > 0;
      // Upload only the live instances, not the pooled capacity.
      const matrix = group.mesh.instanceMatrix;matrix.clearUpdateRanges();matrix.addUpdateRange(0, particles.length * 16);matrix.needsUpdate = true;
    }
    for (const [key, group] of groups) {
      const list=pending.get(key);
      if(!list?.length){
        group.mesh.count=0;group.mesh.visible=false; // an empty group is skipped, not set up and drawn with no instances
        if(++group.idleFrames>=IDLE_GROUP_FRAMES){disposeGroup(group);groups.delete(key);pending.delete(key);}
      }
      // Scratch capacity can be reused, but samples from the previous world must not stay alive.
      if(list)list.length=0;
    }
  }

  return {
    draw,
    contextLost(retire){retire(geometry);for(const texture of textures.values())retire(texture);for(const group of groups.values()){retire(group.mesh);retire(group.material);}},
    get count() { return count; },
    metrics(){return {groups:groups.size,capacity:retainedCapacity,instance_buffer_bytes:retainedCapacity*64,compactions};},
    get drawCalls() { let total=0; for (const group of groups.values()) if (group.mesh.count > 0) total++; return total; },
    get debugBatches() { return [...groups.values()].map(group=>({key:group.debugKey,count:group.mesh.count,firstMatrix:[...group.mesh.instanceMatrix.array.slice(0,16)]})); },
    dispose() {
      if (disposed) return; disposed = true;
      for (const group of groups.values()) disposeGroup(group);
      groups.clear();pending.clear(); geometry.dispose(); for (const texture of textures.values()) texture.dispose(); textures.clear();
      for (const cell of cellTextures.values()) cell.dispose(); cellTextures.clear(); count = 0;
    },
  };
}
