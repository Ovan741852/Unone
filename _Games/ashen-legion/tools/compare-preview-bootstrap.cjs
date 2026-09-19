const fs = require('node:fs');
const assert = require('node:assert/strict');
const before = JSON.parse(fs.readFileSync('tests/first-screen/before-parallel-scene.json'));
const after = JSON.parse(fs.readFileSync('tests/first-screen/browser-report.json'));
const sceneRequest = r => /\/content\/assets\/.*\.mesh\.json$|\/content\/assets\/(palette|sky_forest)\.png$/.test(r.url);
function summarize(r) {
  const origin = r.at - r.loading.elapsedMs;
  const requests = r.requests.filter(sceneRequest);
  const modelsReady = origin + r.loading.models;
  return {
    readyMs: r.at,
    modelsReadyMs: modelsReady,
    sceneFirstRequestMs: Math.min(...requests.map(x => x.start)),
    sceneLastResponseMs: Math.max(...requests.map(x => x.end)),
    afterModelsToReadyMs: r.at - modelsReady,
    sceneRequests: requests,
    sceneBytes: requests.reduce((sum, x) => sum + x.bytes, 0),
    timingMarks: r.loading,
  };
}
const comparisons = after.reports.map(r => {
  const b = summarize(before.reports.find(x => x.delayMs === r.delayMs));
  const a = summarize(r);
  assert.deepEqual(a.sceneRequests.map(x => x.url).sort(), b.sceneRequests.map(x => x.url).sort());
  assert.equal(a.sceneRequests.length, 8);
  assert.equal(a.sceneBytes, b.sceneBytes);
  assert(a.sceneLastResponseMs < a.modelsReadyMs, 'scene should load alongside the roster');
  assert(r.loading.sceneReady < r.loading.models);
  assert(r.loading.firstDraw >= r.loading.sceneReady);
  assert(r.loading.firstDraw >= r.loading.models);
  assert(r.loading.firstDraw >= r.loading.firstImages);
  assert(!r.gateVisible);
  return {delayMs: r.delayMs, before: b, after: a, readyReductionMs: b.readyMs - a.readyMs};
});
fs.writeFileSync('tests/first-screen/parallel-scene-comparison.json', JSON.stringify({
  scope: 'One paired local cold-start sample at 0 ms and 80 ms per-request delay, without bandwidth throttling. Not a measurement of WAN load time.',
  verified: 'Same six scene mesh requests and two textures; no legacy prototype meshes; scene complete before roster; all assets ready before first visible frame.',
  comparisons,
}, null, 2) + '\n');
console.log(JSON.stringify(comparisons.map(x => ({delayMs: x.delayMs, beforeReadyMs: x.before.readyMs, afterReadyMs: x.after.readyMs, reductionMs: x.readyReductionMs, sceneRequests: x.after.sceneRequests.length})), null, 2));
