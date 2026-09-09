import assert from "node:assert/strict";
import test from "node:test";
import { createLottieHost, createLottiePlayer, validateLottieDocument } from "../runtime/lottie.mjs";

function documentFixture() {
  return {
    v: "5.13.0", fr: 10, ip: 0, op: 10, w: 100, h: 100, assets: [],
    layers: [{ ty: 4, ip: 0, op: 10, st: 0, ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [50, 50, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } }, shapes: [{ ty: "sh", ks: { a: 0, k: { i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]], v: [[-10, -10], [10, -10], [0, 10]], c: true } } }, { ty: "fl", c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } }] }],
    markers: [{ tm: 4, cm: "collect", dr: 0 }],
  };
}

function context() {
  return { canvas: { width: 100, height: 100 }, fills: 0, save() {}, restore() {}, setTransform() {}, clearRect() {}, scale() {}, translate() {}, rotate() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, bezierCurveTo() {}, fill() { this.fills += 1; } };
}

test("validates shape-only subset and reports paths for unsupported layers", () => {
  assert.deepEqual(validateLottieDocument(documentFixture()), []);
  const invalid = documentFixture(); invalid.layers[0].ty = 3;
  const issues = validateLottieDocument(invalid);
  assert.ok(issues.some((item) => item.code === "UNONE_LOTTIE_UNSUPPORTED" && item.path === "/layers/0/ty"));
});

test("player lifecycle deduplicates completion across seek/restart and generations", () => {
  const events = []; const player = createLottiePlayer({ data: documentFixture(), context: context(), instanceId: "reward", onEvent: (event) => events.push(event) });
  assert.equal(player.play({ mode: "once" }).ok, true);
  player.update(1.1);
  assert.equal(events.filter((event) => event.type === "complete").length, 1);
  player.seekFrame(10); player.update(1);
  assert.equal(events.filter((event) => event.type === "complete").length, 1, "terminal seek must not complete");
  player.restart(); player.update(1.1);
  assert.equal(events.filter((event) => event.type === "complete").length, 2);
  const generation = player.getState().generation;
  player.setSource(documentFixture());
  assert.equal(player.getState().generation, generation + 1);
  player.dispose();
  const count = events.length; player.play(); assert.equal(events.length, count, "disposed player cannot emit callbacks");
});

test("host provides passthrough mount, control commands and inspection", () => {
  const events = []; const host = createLottieHost({ assets: { "reward.big_win": documentFixture() }, createCanvas: () => ({ ...context(), getContext() { return this; } }), onEvent: (event) => events.push(event) });
  const mounted = host.mount({ instanceId: "overlay", asset: "reward.big_win", pointerEvents: "passthrough", rect: { x: 0, y: 0, w: 100, h: 100 } });
  assert.equal(mounted.ok, true); assert.equal(host.inspect("overlay").value.backend, "canvas-2d");
  host.play("overlay", { mode: "once" }); host.update(0.1); host.render();
  assert.ok(events.some((event) => event.type === "ready"));
  assert.equal(host.seekMarker("overlay", "collect").ok, true);
  assert.equal(host.dispose("overlay").value.disposed, true);
  host.disposeHost();
});

test("host fails closed when a Canvas2D context is unavailable", () => {
  const host = createLottieHost({ assets: { reward: documentFixture() } });
  const mounted = host.mount({ instanceId: "no-canvas", asset: "reward" });
  assert.equal(mounted.ok, false);
  assert.equal(mounted.error.code, "UNONE_LOTTIE_CONTEXT_MISSING");
  host.disposeHost();
});
