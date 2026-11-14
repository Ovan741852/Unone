// Image-based environment light (docs/lighting.md#environment): a Radiance
// .hdr panorama from a data asset becomes Three's scene.environment, which
// lights MeshStandardMaterial meshes, and optionally the scene background.

// Radiance RGBE to linear RGBA floats, rows top first. Accepts the usual
// "-Y height +X width" orientation, flat or new-style run-length scanlines.
export function decodeHdr(buffer) {
  const bytes = new Uint8Array(buffer);
  let at = 0;
  const fail = message => { throw new Error(`ENVIRONMENT_MAP_INVALID: ${message}`); };
  const line = () => {
    let text = '';
    while (at < bytes.length && bytes[at] !== 10) text += String.fromCharCode(bytes[at++]);
    if (at >= bytes.length) fail('the header ends early');
    at++;
    return text;
  };
  if (!line().startsWith('#?')) fail('not a Radiance .hdr file');
  for (let text = line(); text !== ''; text = line()) {
    if (text.startsWith('FORMAT=') && text !== 'FORMAT=32-bit_rle_rgbe') fail(`unsupported ${text}`);
  }
  const size = /^-Y (\d+) \+X (\d+)$/.exec(line().trim());
  if (!size) fail('only the "-Y height +X width" orientation is supported');
  const height = Number(size[1]), width = Number(size[2]);
  if (!(width > 0 && height > 0 && width <= 16384 && height <= 16384)) fail(`size ${width}x${height} is outside 1..16384`);
  const rgbe = new Uint8Array(width * height * 4), row = new Uint8Array(width * 4);
  const next = () => { if (at >= bytes.length) fail('pixel data ends early'); return bytes[at++]; };
  for (let y = 0; y < height; y++) {
    const rle = width >= 8 && width < 32768 && bytes[at] === 2 && bytes[at + 1] === 2 && ((bytes[at + 2] << 8) | bytes[at + 3]) === width;
    if (rle) {
      at += 4;
      for (let channel = 0; channel < 4; channel++) {
        for (let x = 0; x < width;) {
          let count = next();
          const run = count > 128;
          if (run) count -= 128;
          if (count === 0 || x + count > width) fail('a run overflows its scanline');
          if (run) { const value = next(); for (let i = 0; i < count; i++) row[(x++) * 4 + channel] = value; }
          else for (let i = 0; i < count; i++) row[(x++) * 4 + channel] = next();
        }
      }
    } else {
      if (at + width * 4 > bytes.length) fail('pixel data ends early');
      row.set(bytes.subarray(at, at + width * 4));at += width * 4;
    }
    rgbe.set(row, y * width * 4);
  }
  const data = new Float32Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const exponent = rgbe[i * 4 + 3], scale = exponent ? 2 ** (exponent - 136) : 0;
    data[i * 4] = rgbe[i * 4] * scale;data[i * 4 + 1] = rgbe[i * 4 + 1] * scale;data[i * 4 + 2] = rgbe[i * 4 + 2] * scale;data[i * 4 + 3] = 1;
  }
  return {width, height, data};
}

// A half-float equirect texture, rows flipped so v = 1 is the panorama's top.
export function environmentTexture(THREE, {width, height, data}) {
  const half = new Uint16Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = y * width * 4, to = (height - 1 - y) * width * 4;
    for (let i = 0; i < width * 4; i++) half[to + i] = THREE.DataUtils.toHalfFloat(data[from + i]);
  }
  const texture = new THREE.DataTexture(half, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

// Loads the declared panorama once per map id and applies intensity,
// rotation and background every frame. Returns true while a map is loading.
export function createEnvironment(THREE, scene, loadAssetUrl) {
  let current = null; // {map, texture, error, promise}
  function release() { current?.texture?.dispose();current = null; }
  function sync(environment, specs) {
    if (!environment) {
      if (current) release();
      scene.environment = null;scene.background = null;
      return false;
    }
    if (current?.map !== environment.map) {
      release();
      const asset = specs.get(environment.map);
      if (asset?.kind !== 'data' || !/\.hdr$/i.test(asset.source ?? '')) {
        throw new Error(`ENVIRONMENT_MAP_INVALID: lighting.environment.map '${environment.map}' must be a declared data asset whose source is an .hdr file`);
      }
      const record = current = {map: environment.map, texture: null, error: null};
      record.promise = Promise.resolve(loadAssetUrl(asset)).then(url => fetch(url)).then(response => {
        if (!response.ok) throw new Error(`ENVIRONMENT_MAP_LOAD_FAILED: ${environment.map} (${response.status})`);
        return response.arrayBuffer();
      }).then(buffer => { if (current === record) record.texture = environmentTexture(THREE, decodeHdr(buffer)); })
        .catch(error => { if (current === record) record.error = error; });
    }
    if (current.error) throw current.error;
    const texture = current.texture, rotation = environment.rotation * Math.PI / 180;
    scene.environment = texture;
    scene.environmentIntensity = environment.intensity;
    scene.environmentRotation.set(0, rotation, 0);
    scene.background = environment.background ? texture : null;
    scene.backgroundIntensity = environment.intensity;
    scene.backgroundRotation.set(0, rotation, 0);
    return !texture;
  }
  return {sync, dispose: release, get loading() { return Boolean(current && !current.texture && !current.error); }};
}
