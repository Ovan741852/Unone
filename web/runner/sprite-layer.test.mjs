import assert from "node:assert/strict";

import { createSpriteLayer } from "./sprite-layer.js?v=3";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.className = "";
    this.textContent = "";
    this.src = "";
    this.alt = "";
    this.draggable = true;
  }

  replaceChildren(...children) {
    this.children = children;
  }
}

globalThis.document = {
  createElement: (tagName) => new FakeElement(tagName),
};

const root = new FakeElement("div");
const diagnostic = {
  code: "ASSET_CONTENT_CORRUPT",
  explanation: "The asset bytes do not match the declared content digest.",
};
const loadCalls = [];
let brokenAssetFails = true;
const loadAssetUrl = (asset) => {
  loadCalls.push(asset.id);
  if (asset.id === "asset://broken" && brokenAssetFails) {
    const error = new Error("asset bytes rejected");
    error.diagnostic = diagnostic;
    return Promise.reject(error);
  }
  return Promise.resolve(`blob:${asset.id}`);
};
const errorReports = [];
const layer = createSpriteLayer({
  element: root,
  loadAssetUrl,
  onAssetErrors: (errors) => errorReports.push(errors),
});

const camera = {
  position: { x: 4, y: -1 },
  zoom: 2,
  view_height: 8,
};
const sprite = (id, asset, layerNumber = 0, extras = {}) => ({
  id,
  transform: { x: 4, y: -1 },
  rotation: 0.5,
  scale: { x: 2, y: 0.5 },
  sprite: {
    asset,
    size: { x: 2, y: 4 },
    visible: true,
    layer: layerNumber,
  },
  ...extras,
});
const snapshot = {
  world: {
    camera,
    entities: {
      2: sprite("2", "asset://ok"),
      10: sprite("10", "asset://missing"),
      back: sprite("back", "asset://missing", -1),
      "é": sprite("é", "asset://broken"),
      "𐀀": sprite("𐀀", "asset://ok"),
      hidden: sprite("hidden", "asset://ok", 99, {
        sprite: { asset: "asset://ok", size: { x: 9, y: 9 }, visible: false, layer: 99 },
      }),
    },
  },
};
const manifest = {
  assets: [
    { id: "asset://ok", source: "ok.svg", kind: "texture2d" },
    { id: "asset://broken", source: "broken.svg", kind: "texture2d" },
  ],
};
const canvas = { clientWidth: 800, clientHeight: 600 };

layer.render(snapshot, manifest, canvas);
assert.deepEqual(
  root.children.map((child) => child.dataset.entityId),
  ["back", "10", "2", "é", "𐀀"],
  "one DOM layer must use signed layer then UTF-8 id order",
);
assert.equal(root.children.length, 5, "every visible ordinary sprite gets an image or fallback wrapper");
assert.ok(!root.children.some((child) => child.dataset.entityId === "hidden"), "hidden sprites stay hidden");
assert.equal(loadCalls.filter((id) => id === "asset://missing").length, 0, "undeclared assets do not get fetched");

const byId = (id) => root.children.find((child) => child.dataset.entityId === id);
const centered = byId("2");
assert.equal(centered.style.left, "50%");
assert.equal(centered.style.bottom, "50%");
assert.equal(centered.style.width, "75%", "scale is applied exactly once to width");
assert.equal(centered.style.height, "50%", "scale is applied exactly once to height");
assert.equal(centered.style.transform, "translate(-50%, 50%) rotate(-0.5rad)");
assert.equal(centered.style.transform.includes("scale("), false, "CSS must not apply scale a second time");
assert.equal(centered.children[0].className, "unone-asset-fallback");

await Promise.resolve();
await Promise.resolve();
assert.equal(byId("2").children[0].className, "unone-asset-image");
assert.equal(byId("𐀀").children[0].className, "unone-asset-image");
assert.equal(byId("10").children[0].className, "unone-asset-fallback");
assert.equal(byId("back").children[0].className, "unone-asset-fallback");
assert.equal(byId("é").children[0].className, "unone-asset-fallback");

const finalErrors = errorReports.at(-1);
assert.deepEqual(finalErrors.map(({ entity_id }) => entity_id), ["10", "back", "é"]);
const missing = finalErrors.find(({ entity_id }) => entity_id === "10");
assert.equal(missing.code, "ASSET_ID_NOT_DECLARED");
assert.equal(missing.diagnostic, null);
const broken = finalErrors.find(({ entity_id }) => entity_id === "é");
assert.equal(broken.code, diagnostic.code);
assert.equal(broken.message, diagnostic.explanation);
assert.deepEqual(broken.diagnostic, diagnostic, "asset diagnostics must remain visible beside the fallback");

const brokenCallsAfterFirstRender = loadCalls.filter((id) => id === "asset://broken").length;
layer.render(snapshot, manifest, canvas);
await Promise.resolve();
await Promise.resolve();
assert.equal(
  loadCalls.filter((id) => id === "asset://broken").length,
  brokenCallsAfterFirstRender,
  "a second render must not silently retry a failed declared asset",
);
assert.equal(byId("é").children[0].className, "unone-asset-fallback");
const secondRenderErrors = errorReports.at(-1);
const secondRenderBroken = secondRenderErrors.find(({ entity_id }) => entity_id === "é");
assert.equal(secondRenderBroken.code, diagnostic.code, "the second render must retain the machine-readable failure");
assert.deepEqual(secondRenderBroken.diagnostic, diagnostic);

brokenAssetFails = false;
await layer.retry();
assert.equal(byId("é").children[0].className, "unone-asset-image", "an explicit successful retry may replace the fallback");
assert.equal(
  loadCalls.filter((id) => id === "asset://broken").length,
  brokenCallsAfterFirstRender + 1,
);
assert.deepEqual(errorReports.at(-1).map(({ entity_id }) => entity_id), ["10", "back"]);

brokenAssetFails = true;
const changedManifest = {
  ...manifest,
  version: 2,
  assets: manifest.assets.map((asset) => ({ ...asset })),
};
layer.render(snapshot, changedManifest, canvas);
assert.equal(
  loadCalls.filter((id) => id === "asset://broken").length,
  brokenCallsAfterFirstRender + 2,
  "an explicit manifest change resets the failed declaration attempt",
);
await Promise.resolve();
await Promise.resolve();
assert.equal(byId("é").children[0].className, "unone-asset-fallback");
assert.equal(errorReports.at(-1).find(({ entity_id }) => entity_id === "é").code, diagnostic.code);

layer.clear();
assert.equal(root.children.length, 0);
assert.deepEqual(errorReports.at(-1), []);

const lateRoot = new FakeElement("div");
let resolveLateLoad;
const lateLoad = new Promise((resolve) => { resolveLateLoad = resolve; });
const lateErrors = [];
const lateLayer = createSpriteLayer({
  element: lateRoot,
  loadAssetUrl: () => lateLoad,
  onAssetErrors: (errors) => lateErrors.push(errors),
});
lateLayer.render({
  world: {
    camera,
    entities: { late: sprite("late", "asset://ok") },
  },
}, manifest, canvas);
lateLayer.clear();
resolveLateLoad("blob:stale-generation");
await Promise.resolve();
await Promise.resolve();
assert.equal(lateRoot.children.length, 0, "a cleared generation must not receive an old image completion");
assert.deepEqual(lateErrors.at(-1), [], "a cleared generation must not publish an old load error");

console.log("DOM sprite layer transform and fallback contract passed");
