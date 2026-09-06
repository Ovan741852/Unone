import assert from "node:assert/strict";

import {
  compareUtf8Ids,
  semanticSummary,
  verticesFor,
  worldSizeToView,
  worldToView,
} from "./webgpu-snapshot.js?v=5";

function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} !== ${expected}`);
}

const camera = {
  position: { x: 4, y: -2 },
  zoom: 2,
  view_height: 8,
};

const entity = (id, layer = 0, extras = {}) => ({
  id,
  transform: { x: 4, y: -2 },
  rotation: 0.25,
  scale: { x: 2, y: 0.5 },
  sprite: {
    asset: `asset://${id}`,
    size: { x: 2, y: 4 },
    visible: true,
    layer,
  },
  ...extras,
});

assert.ok(compareUtf8Ids("10", "2") < 0, "UTF-8 ordering must not use numeric-looking object-key order");
assert.ok(compareUtf8Ids("é", "𐀀") < 0, "supplementary Unicode must use UTF-8 bytes");

const summary = semanticSummary({
  project: "SnapshotContract",
  observation_digest: "sha256:contract",
  world: {
    frame: 11,
    camera,
    entities: {
      2: entity("2"),
      10: entity("10"),
      "é": entity("é"),
      "𐀀": entity("𐀀"),
    },
  },
});
assert.deepEqual(summary.entities.map(({ id }) => id), ["10", "2", "é", "𐀀"]);
assert.deepEqual(summary.entities[1].rotation, 0.25);
assert.deepEqual(summary.entities[1].scale, { x: 2, y: 0.5 });
assert.equal(summary.entities[1].layer, 0);

const center = worldToView(camera.position, camera, 4 / 3);
assertClose(center.x, 50, "camera-centered x projection");
assertClose(center.y, 50, "camera-centered y projection");
const extent = worldSizeToView({ x: 2, y: 4 }, camera, 4 / 3, { x: 2, y: 0.5 });
assertClose(extent.x, 75, "scaled width projection");
assertClose(extent.y, 50, "scaled height projection");

const sprite = entity("sprite", 0, {
  rotation: Math.PI / 2,
  scale: { x: 2, y: 1 },
  sprite: { asset: "asset://sprite", size: { x: 2, y: 4 }, visible: true, layer: 0 },
});
const debugOnly = {
  id: "z-debug",
  transform: { x: 4, y: -2 },
  sprite: null,
};
const hidden = entity("hidden", 0, {
  sprite: { asset: "asset://hidden", size: { x: 9, y: 9 }, visible: false, layer: 0 },
});
const twoD = { world: { camera, entities: { sprite, "z-debug": debugOnly, hidden } } };
const all2d = verticesFor(twoD, 4 / 3);
const suppressed2d = verticesFor(twoD, 4 / 3, { suppress2dSprites: true });
assert.equal(all2d.length, 72, "visible sprite and sprite-less debug quad must both render");
assert.equal(suppressed2d.length, 36, "runner suppression removes only ordinary 2D sprite quads");
assertClose(all2d[0], 0.75, "rotated world corner x is projected after rotation");
assertClose(all2d[1], -1, "rotated world corner y is projected after rotation");

const threeD = {
  world: {
    camera3d: {
      position: { x: 0, y: 0, z: 0 },
      target: { x: 0, y: 0, z: 4 },
      fov_degrees: 60,
    },
    entities: {
      cube: {
        id: "cube",
        transform3d: {
          position: { x: 0, y: 0, z: 4 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        mesh3d: { visible: true },
      },
    },
  },
};
const standalone3d = verticesFor(threeD, 4 / 3);
const runner3d = verticesFor(threeD, 4 / 3, { suppress2dSprites: true });
assert.ok(standalone3d.length > 0, "standalone WebGPU must retain 3D sprite/mesh rendering");
assert.deepEqual([...runner3d], [...standalone3d], "2D suppression must not alter the 3D path");

console.log("WebGPU snapshot transform contract passed");
