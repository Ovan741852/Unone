import assert from "node:assert/strict";

// main.js is a browser entry module. These tiny host stubs let the pure
// semantic projection run without a DOM, WebGPU, IndexedDB or a browser.
const element = {
  addEventListener() {},
  replaceChildren() {},
};
globalThis.document = { querySelector: () => element };
globalThis.location = {
  origin: "http://127.0.0.1:8000",
  pathname: "/Unone/web/runner/",
  search: "",
};
globalThis.window = { addEventListener() {} };

const { semanticOutput } = await import("./main.js?semantic-output-test");

const observations = {
  score: 12,
  phase: "ready",
  nested: { selected: true },
  empty_list: [],
};
const digest = `sha256:${"a".repeat(64)}`;
const snapshot = {
  project: "WebSemanticOutputTest",
  observation_digest: digest,
  world: {
    frame: 17,
    entities: {},
    observations,
    camera: { position: { x: 0, y: 0 }, zoom: 1, view_height: 10 },
  },
};

const output = semanticOutput(snapshot, { position: { x: 1, y: 2 }, down: false });
assert.equal(output.project, snapshot.project);
assert.equal(output.frame, snapshot.world.frame);
assert.equal(output.observation_digest, digest);
assert.deepEqual(output.observations, observations);
assert.strictEqual(output.observations, observations, "observations must not be summarized or re-hashed");

const empty = semanticOutput({
  project: "EmptyObservations",
  observation_digest: "sha256:empty",
  world: { frame: 0, entities: {}, observations: {} },
});
assert.deepEqual(empty.observations, {}, "empty observations must remain an empty object");

console.log("semantic output regression passed");
