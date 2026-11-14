// A small textured GLB for tests: a unit quad under a node translated by
// (1, 2, 3) and scaled by 2, with an embedded 1x1 red PNG and a material.
import {deflateSync} from 'node:zlib';

const crcTable = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = bytes => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(Buffer.concat([Buffer.from(type), data])));
  return Buffer.concat([length, Buffer.from(type), data, sum]);
};
export function redPng() {
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))), chunk('IEND', Buffer.alloc(0))]);
}

export function makeGlb({extensionsRequired} = {}) {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  const uvs = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const png = redPng();
  const pad = buffer => Buffer.concat([buffer, Buffer.alloc((4 - (buffer.length % 4)) % 4)]);
  const parts = [Buffer.from(positions.buffer), Buffer.from(uvs.buffer), pad(Buffer.from(indices.buffer)), pad(png)];
  const offsets = []; let at = 0; for (const part of parts) { offsets.push(at); at += part.length; }
  const bin = Buffer.concat(parts);
  const gltf = {
    asset: {version: '2.0'}, scene: 0, scenes: [{nodes: [0]}],
    nodes: [{mesh: 0, translation: [1, 2, 3], scale: [2, 2, 2]}],
    meshes: [{name: 'Quad', primitives: [{attributes: {POSITION: 0, TEXCOORD_0: 1}, indices: 2, material: 0}]}],
    materials: [{name: 'Paint', pbrMetallicRoughness: {baseColorFactor: [1, 0.5, 0.25, 1], metallicFactor: 0.2, roughnessFactor: 0.6, baseColorTexture: {index: 0}}}],
    textures: [{source: 0}], images: [{bufferView: 3, mimeType: 'image/png'}],
    accessors: [
      {bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0]},
      {bufferView: 1, componentType: 5126, count: 4, type: 'VEC2'},
      {bufferView: 2, componentType: 5123, count: 6, type: 'SCALAR'},
    ],
    bufferViews: [
      {buffer: 0, byteOffset: offsets[0], byteLength: positions.byteLength},
      {buffer: 0, byteOffset: offsets[1], byteLength: uvs.byteLength},
      {buffer: 0, byteOffset: offsets[2], byteLength: indices.byteLength},
      {buffer: 0, byteOffset: offsets[3], byteLength: png.length},
    ],
    buffers: [{byteLength: bin.length}],
    ...(extensionsRequired ? {extensionsRequired, extensionsUsed: extensionsRequired} : {}),
  };
  const json = Buffer.from(JSON.stringify(gltf));
  const jsonChunk = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546C67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0); jsonHeader.writeUInt32LE(0x4E4F534A, 4);
  binHeader.writeUInt32LE(bin.length, 0); binHeader.writeUInt32LE(0x004E4942, 4);
  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, bin]);
}

if (process.argv[2]) {
  const {writeFileSync} = await import('node:fs');
  writeFileSync(process.argv[2], makeGlb());
}
