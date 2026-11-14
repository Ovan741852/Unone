// A small CPU path tracer for stills of a Unone scene (plugins/org.unone.pathtrace).
// Same conventions as the official players: Lambert + GGX materials
// (docs/materials.md), lights where intensity 1 is full light
// (docs/lighting.md), the HDR environment in Three's equirect layout, and the
// static-mesh format. Deterministic for a seed.
import {inflateSync, deflateSync} from 'node:zlib';

// ---------- small vector helpers ----------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const mulv = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = a => Math.hypot(a[0], a[1], a[2]);
const normalize = a => { const l = length(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const srgbToLinear = v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
export const color = hex => [1, 3, 5].map(at => srgbToLinear(parseInt(hex.slice(at, at + 2), 16) / 255));

function random(seed) {
  let state = (seed ^ 0x9e3779b9) >>> 0 || 1;
  return () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 4294967296; };
}

// ---------- PNG (8-bit, non-interlaced) ----------
export function decodePng(bytes) {
  const data = Buffer.from(bytes);
  if (data.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let at = 8, width = 0, height = 0, type = 0, depth = 0, palette = null, transparency = null;
  const idat = [];
  while (at < data.length) {
    const len = data.readUInt32BE(at), name = data.toString('ascii', at + 4, at + 8), body = data.subarray(at + 8, at + 8 + len);
    if (name === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; if (body[12]) throw new Error('interlaced PNGs are not supported'); }
    if (name === 'PLTE') palette = body;
    if (name === 'tRNS') transparency = body;
    if (name === 'IDAT') idat.push(body);
    at += 12 + len;
  }
  if (depth !== 8) throw new Error('only 8-bit PNGs are supported');
  const channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[type], stride = width * channels, raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0, up = y ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0, p = left + up - upLeft;
      const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
      const predictor = [0, left, up, (left + up) >> 1, pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft][filter];
      pixels[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + predictor) & 255;
    }
  }
  const rgba = new Float32Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    let r, g, b, a = 255;
    if (type === 0) r = g = b = pixels[i];
    else if (type === 4) { r = g = b = pixels[i * 2]; a = pixels[i * 2 + 1]; }
    else if (type === 3) { const k = pixels[i]; r = palette[k * 3]; g = palette[k * 3 + 1]; b = palette[k * 3 + 2]; a = transparency?.[k] ?? 255; }
    else { r = pixels[i * channels]; g = pixels[i * channels + 1]; b = pixels[i * channels + 2]; if (channels === 4) a = pixels[i * 4 + 3]; }
    rgba.set([srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255), a / 255], i * 4);
  }
  return {width, height, rgba};
}

export function encodePng(width, height, rgb8) {
  const table = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (name, body) => { const len = Buffer.alloc(4); len.writeUInt32BE(body.length); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(Buffer.concat([Buffer.from(name), body]))); return Buffer.concat([len, Buffer.from(name), body, sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) rgb8.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- Radiance HDR ----------
export function decodeHdr(bytes) {
  const data = Buffer.from(bytes);
  let at = 0;
  const line = () => { const end = data.indexOf(10, at); if (end < 0) throw new Error('bad .hdr header'); const text = data.toString('latin1', at, end); at = end + 1; return text; };
  if (!line().startsWith('#?')) throw new Error('not a Radiance .hdr file');
  while (line() !== '');
  const size = /^-Y (\d+) \+X (\d+)$/.exec(line().trim());
  if (!size) throw new Error('only "-Y height +X width" .hdr files are supported');
  const height = +size[1], width = +size[2], rgb = new Float32Array(width * height * 3), row = Buffer.alloc(width * 4);
  for (let y = 0; y < height; y++) {
    if (width >= 8 && width < 32768 && data[at] === 2 && data[at + 1] === 2 && ((data[at + 2] << 8) | data[at + 3]) === width) {
      at += 4;
      for (let c = 0; c < 4; c++) for (let x = 0; x < width;) {
        let count = data[at++];
        if (count > 128) { count -= 128; const v = data[at++]; for (let i = 0; i < count; i++) row[(x++) * 4 + c] = v; }
        else for (let i = 0; i < count; i++) row[(x++) * 4 + c] = data[at++];
      }
    } else { data.copy(row, 0, at, at + width * 4); at += width * 4; }
    for (let x = 0; x < width; x++) {
      const e = row[x * 4 + 3], s = e ? 2 ** (e - 136) : 0;
      rgb.set([row[x * 4] * s, row[x * 4 + 1] * s, row[x * 4 + 2] * s], (y * width + x) * 3);
    }
  }
  return {width, height, rgb};
}

// ---------- geometry ----------
function boxMesh() {
  const faces = [[[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]], [[0.5, -0.5, 0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5]],
    [[-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5]], [[0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5]],
    [[-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]], [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [-0.5, -0.5, -0.5]]];
  const positions = [], uvs = [], indices = [];
  faces.forEach((corners, face) => { corners.forEach((p, i) => { positions.push(...p); uvs.push(...[[0, 0], [1, 0], [1, 1], [0, 1]][i]); }); indices.push(face * 4, face * 4 + 1, face * 4 + 2, face * 4, face * 4 + 2, face * 4 + 3); });
  return {positions, uvs, indices};
}

// Entity transform as Three composes it: scale, then Euler XYZ, then translate.
function transformOf(t) {
  const [x, y, z] = [t.rotation?.x ?? 0, t.rotation?.y ?? 0, t.rotation?.z ?? 0];
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  const r = [[c * e, -c * f, d], [af + be * d, ae - bf * d, -b * c], [bf - ae * d, be + af * d, a * c]];
  const s = [t.scale?.x ?? 1, t.scale?.y ?? 1, t.scale?.z ?? 1], p = [t.position?.x ?? 0, t.position?.y ?? 0, t.position?.z ?? 0];
  return {point: v => [r[0][0] * v[0] * s[0] + r[0][1] * v[1] * s[1] + r[0][2] * v[2] * s[2] + p[0], r[1][0] * v[0] * s[0] + r[1][1] * v[1] * s[1] + r[1][2] * v[2] * s[2] + p[1], r[2][0] * v[0] * s[0] + r[2][1] * v[1] * s[1] + r[2][2] * v[2] * s[2] + p[2]],
    inverse: v => { const q = sub(v, p); return [(r[0][0] * q[0] + r[1][0] * q[1] + r[2][0] * q[2]) / s[0], (r[0][1] * q[0] + r[1][1] * q[1] + r[2][1] * q[2]) / s[1], (r[0][2] * q[0] + r[1][2] * q[1] + r[2][2] * q[2]) / s[2]]; },
    inverseDirection: v => [(r[0][0] * v[0] + r[1][0] * v[1] + r[2][0] * v[2]) / s[0], (r[0][1] * v[0] + r[1][1] * v[1] + r[2][1] * v[2]) / s[1], (r[0][2] * v[0] + r[1][2] * v[1] + r[2][2] * v[2]) / s[2]],
    normal: n => normalize([r[0][0] * n[0] / s[0] + r[0][1] * n[1] / s[1] + r[0][2] * n[2] / s[2], r[1][0] * n[0] / s[0] + r[1][1] * n[1] / s[1] + r[1][2] * n[2] / s[2], r[2][0] * n[0] / s[0] + r[2][1] * n[1] / s[1] + r[2][2] * n[2] / s[2]])};
}

function buildBvh(triangles) {
  const nodes = [];
  const bounds = list => { const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; for (const t of list) for (const v of [t.a, t.b, t.c]) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]); } return {min, max}; };
  const build = list => {
    const node = {...bounds(list)};nodes.push(node);
    if (list.length <= 4) { node.items = list; return node; }
    const extent = sub(node.max, node.min), axis = extent[0] > extent[1] ? (extent[0] > extent[2] ? 0 : 2) : (extent[1] > extent[2] ? 1 : 2);
    list.sort((p, q) => p.centroid[axis] - q.centroid[axis]);
    const half = list.length >> 1;
    node.left = build(list.slice(0, half));node.right = build(list.slice(half));
    return node;
  };
  return triangles.length ? build(triangles) : null;
}

const hitBox = (node, origin, inverse, far) => {
  let near = 0;
  for (let k = 0; k < 3; k++) {
    let t0 = (node.min[k] - origin[k]) * inverse[k], t1 = (node.max[k] - origin[k]) * inverse[k];
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0);far = Math.min(far, t1);
    if (near > far) return false;
  }
  return true;
};

/** Build the tracer for a scene; `assets` resolves mesh/texture/hdr data by id. */
export function createScene(scene, assets) {
  const materials = scene.materials ?? {}, triangles = [], spheres = [];
  const materialOf = (name, texture) => {
    const m = name ? materials[name] : null;
    return {albedo: m ? color(m.color ?? '#ffffff') : [1, 1, 1], metallic: m?.metallic ?? 0, roughness: Math.max(m?.roughness ?? 1, 0.0525),
      emissive: m ? mul(color(m.emissive ?? '#000000'), m.emissive_intensity ?? 1) : [0, 0, 0], physical: Boolean(m), texture};
  };
  const grey = {width: 1, height: 1, rgba: new Float32Array([...color('#e6ecf5'), 1])};
  for (const entity of scene.entities ?? []) {
    const mesh = entity.mesh3d, t = entity.transform3d;
    if (!mesh || !t || mesh.visible === false) continue;
    const transform = transformOf(t);
    if (mesh.asset === 'mesh://primitive/sphere') { spheres.push({transform, material: materialOf(mesh.material, mesh.material ? null : grey)}); continue; }
    const data = mesh.asset === 'mesh://primitive/box' ? boxMesh() : assets.mesh(mesh.asset);
    const texture = mesh.asset === 'mesh://primitive/box' ? (mesh.material ? null : grey) : assets.texture(data.texture);
    const material = materialOf(mesh.material, texture);
    const world = Array.from({length: data.positions.length / 3}, (_, i) => transform.point(data.positions.slice(i * 3, i * 3 + 3)));
    for (let i = 0; i < data.indices.length; i += 3) {
      const [ia, ib, ic] = [data.indices[i], data.indices[i + 1], data.indices[i + 2]];
      const a = world[ia], b = world[ib], c = world[ic];
      const uv = k => [data.uvs[k * 2], data.uvs[k * 2 + 1]];
      triangles.push({a, b, c, e1: sub(b, a), e2: sub(c, a), normal: normalize(cross(sub(b, a), sub(c, a))), uva: uv(ia), uvb: uv(ib), uvc: uv(ic), material, centroid: mul(add(add(a, b), c), 1 / 3)});
    }
  }
  const root = buildBvh(triangles), lighting = scene.lighting ?? null;
  const environment = lighting?.environment ? {...lighting.environment, map: assets.hdr(lighting.environment.map)} : null;
  return {root, spheres, lighting, environment, triangles: triangles.length};
}

function intersect(world, origin, direction, far = Infinity) {
  let best = null;
  const inverse = direction.map(v => 1 / (v || 1e-12)), stack = world.root ? [world.root] : [];
  while (stack.length) {
    const node = stack.pop();
    if (!hitBox(node, origin, inverse, best ? best.t : far)) continue;
    if (node.items) for (const tri of node.items) {
      const p = cross(direction, tri.e2), det = dot(tri.e1, p);
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det, s = sub(origin, tri.a), u = dot(s, p) * inv;
      if (u < 0 || u > 1) continue;
      const q = cross(s, tri.e1), v = dot(direction, q) * inv;
      if (v < 0 || u + v > 1) continue;
      const t = dot(tri.e2, q) * inv;
      if (t > 1e-4 && t < (best ? best.t : far)) best = {t, tri, u, v};
    }
    else stack.push(node.left, node.right);
  }
  for (const sphere of world.spheres) {
    const o = sphere.transform.inverse(origin), d = sphere.transform.inverseDirection(direction);
    const a = dot(d, d), b = dot(o, d), c = dot(o, o) - 0.25, disc = b * b - a * c;
    if (disc < 0) continue;
    for (const t of [(-b - Math.sqrt(disc)) / a, (-b + Math.sqrt(disc)) / a]) if (t > 1e-4 && t < (best ? best.t : far)) { best = {t, sphere, local: add(o, mul(d, t))}; break; }
  }
  if (!best) return null;
  const point = add(origin, mul(direction, best.t));
  if (best.sphere) {
    const l = best.local, uv = [Math.atan2(l[2], l[0]) / (2 * Math.PI) + 0.5, Math.asin(Math.max(-1, Math.min(1, l[1] * 2))) / Math.PI + 0.5];
    return {point, normal: best.sphere.transform.normal(l), material: best.sphere.material, uv};
  }
  const {tri, u, v} = best, w = 1 - u - v;
  return {point, normal: tri.normal, material: tri.material, uv: [w * tri.uva[0] + u * tri.uvb[0] + v * tri.uvc[0], w * tri.uva[1] + u * tri.uvb[1] + v * tri.uvc[1]]};
}

const sample = (texture, uv) => {
  if (!texture) return [1, 1, 1];
  const x = Math.min(texture.width - 1, Math.max(0, Math.floor((uv[0] - Math.floor(uv[0])) * texture.width)));
  const y = Math.min(texture.height - 1, Math.max(0, Math.floor((1 - (uv[1] - Math.floor(uv[1]))) * texture.height)));
  const at = (y * texture.width + x) * 4;
  return [texture.rgba[at], texture.rgba[at + 1], texture.rgba[at + 2]];
};

// Radiance arriving from a direction that hits nothing: ambient and
// hemisphere as a uniform/graded sky, plus the HDR environment.
function sky(world, d) {
  const lighting = world.lighting;
  if (!lighting) return [0, 0, 0];
  let radiance = mul(color(lighting.ambient?.color ?? '#ffffff'), lighting.ambient?.intensity ?? 0.3);
  const h = lighting.hemisphere;
  if (h) { const t = 0.5 * d[1] + 0.5; radiance = add(radiance, mul(add(mul(color(h.ground), 1 - t), mul(color(h.sky), t)), h.intensity)); }
  const e = world.environment;
  if (e) {
    const a = -(e.rotation ?? 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), r = [c * d[0] + s * d[2], d[1], -s * d[0] + c * d[2]];
    const u = Math.atan2(r[2], r[0]) / (2 * Math.PI) + 0.5, v = 0.5 - Math.asin(Math.max(-1, Math.min(1, r[1]))) / Math.PI;
    const x = Math.min(e.map.width - 1, Math.floor(u * e.map.width)), y = Math.min(e.map.height - 1, Math.floor(v * e.map.height)), at = (y * e.map.width + x) * 3;
    radiance = add(radiance, mul([e.map.rgb[at], e.map.rgb[at + 1], e.map.rgb[at + 2]], e.intensity ?? 1));
  }
  return radiance;
}

function ggx(n, v, l, f0, roughness) {
  const h = normalize(add(v, l)), nl = Math.max(dot(n, l), 0), nv = Math.max(dot(n, v), 1e-4), nh = Math.max(dot(n, h), 0), vh = Math.max(dot(v, h), 0);
  const alpha = roughness * roughness, a2 = alpha * alpha, fresnel = 2 ** ((-5.55473 * vh - 6.98316) * vh);
  const f = add(mul(f0, 1 - fresnel), [fresnel, fresnel, fresnel]);
  const visibility = 0.5 / Math.max(nl * Math.sqrt(a2 + (1 - a2) * nv * nv) + nv * Math.sqrt(a2 + (1 - a2) * nl * nl), 1e-6);
  const dd = nh * nh * (a2 - 1) + 1;
  return mul(f, visibility * a2 / (Math.PI * dd * dd));
}

function trace(world, origin, direction, rand, depth) {
  const hit = intersect(world, origin, direction);
  if (!hit) return sky(world, direction);
  const m = hit.material, view = mul(direction, -1);
  let n = hit.normal;
  if (dot(n, view) < 0) n = mul(n, -1);
  const albedo = mulv(m.albedo, sample(m.texture, hit.uv));
  const diffuse = m.physical ? mul(albedo, 1 - m.metallic) : albedo;
  const f0 = add(mul([0.04, 0.04, 0.04], 1 - m.metallic), mul(albedo, m.metallic));
  let radiance = [...m.emissive];
  const offset = add(hit.point, mul(n, 1e-3)), lighting = world.lighting;
  // Direct light: sun and point lights, with shadow rays. A BRDF times the
  // light's irradiance (pi * intensity * n.l) reproduces the rasterizers.
  const direct = (l, light, distance) => {
    const nl = dot(n, l);
    if (nl <= 0 || intersect(world, offset, l, distance)) return;
    const brdf = add(mul(diffuse, 1 / Math.PI), m.physical ? ggx(n, view, l, f0, m.roughness) : [0, 0, 0]);
    radiance = add(radiance, mul(mulv(brdf, light), Math.PI * nl));
  };
  if (lighting?.sun) direct(normalize(mul([lighting.sun.direction.x, lighting.sun.direction.y, lighting.sun.direction.z], -1)), mul(color(lighting.sun.color ?? '#ffffff'), lighting.sun.intensity ?? 1), Infinity);
  for (const point of lighting?.points ?? []) {
    const to = sub([point.position.x, point.position.y, point.position.z], hit.point), d = length(to), window = Math.max(0, Math.min(1, 1 - (d / (point.range ?? 10)) ** 4));
    if (window > 0) direct(mul(to, 1 / d), mul(color(point.color ?? '#ffffff'), (point.intensity ?? 1) * window * window), d);
  }
  if (depth <= 0) return radiance;
  // One indirect bounce: specular by probability, else cosine-weighted diffuse.
  const specularChance = m.physical ? Math.min(0.9, Math.max(0.1, 0.04 + m.metallic * 0.9)) : 0;
  const tangent = normalize(Math.abs(n[0]) > 0.5 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0])), bitangent = cross(n, tangent);
  if (rand() < specularChance) {
    const alpha = m.roughness * m.roughness, u1 = rand(), u2 = rand();
    const theta = Math.atan(alpha * Math.sqrt(u1 / (1 - u1))), phi = 2 * Math.PI * u2;
    const h = normalize(add(add(mul(tangent, Math.sin(theta) * Math.cos(phi)), mul(bitangent, Math.sin(theta) * Math.sin(phi))), mul(n, Math.cos(theta))));
    const l = normalize(sub(mul(h, 2 * dot(view, h)), view));
    if (dot(n, l) > 0) {
      const vh = Math.max(dot(view, h), 0), fresnel = 2 ** ((-5.55473 * vh - 6.98316) * vh), f = add(mul(f0, 1 - fresnel), [fresnel, fresnel, fresnel]);
      radiance = add(radiance, mul(mulv(f, trace(world, offset, l, rand, depth - 1)), 1 / specularChance));
    }
  } else {
    const r = Math.sqrt(rand()), phi = 2 * Math.PI * rand();
    const l = normalize(add(add(mul(tangent, r * Math.cos(phi)), mul(bitangent, r * Math.sin(phi))), mul(n, Math.sqrt(Math.max(0, 1 - r * r)))));
    radiance = add(radiance, mul(mulv(diffuse, trace(world, offset, l, rand, depth - 1)), 1 / (1 - specularChance)));
  }
  return radiance;
}

/** Render a still: {width, height, samples, bounces, exposure, seed} -> {png, stats}. */
export function render(world, camera, {width = 480, height = 300, samples = 32, bounces = 3, exposure = 1, seed = 1} = {}) {
  const eye = [camera.position.x, camera.position.y, camera.position.z], target = [camera.target.x, camera.target.y, camera.target.z];
  const forward = normalize(sub(target, eye)), right = normalize(cross(forward, [0, 1, 0])), up = cross(right, forward);
  const tan = Math.tan((camera.fov_degrees ?? 60) * Math.PI / 360), aspect = width / height, rand = random(seed);
  const rgb8 = Buffer.alloc(width * height * 3), started = Date.now();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = [0, 0, 0];
    for (let s = 0; s < samples; s++) {
      const px = ((x + rand()) / width * 2 - 1) * tan * aspect, py = (1 - (y + rand()) / height * 2) * tan;
      sum = add(sum, trace(world, eye, normalize(add(add(forward, mul(right, px)), mul(up, py))), rand, bounces));
    }
    for (let k = 0; k < 3; k++) {
      const v = Math.max(0, Math.min(1, sum[k] / samples * exposure));
      rgb8[(y * width + x) * 3 + k] = Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
    }
  }
  return {png: encodePng(width, height, rgb8), stats: {width, height, samples, bounces, triangles: world.triangles, spheres: world.spheres.length, ms: Date.now() - started}};
}
