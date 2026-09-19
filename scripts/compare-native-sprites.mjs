// Compare complete, matching native runs; missing evidence is a failure.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: {
  before: { type: 'string' }, after: { type: 'string' }, out: { type: 'string' },
} });
if (!values.before || !values.after || !values.out) throw new Error('Use --before <summary.json> --after <summary.json> --out <new report.json>');
const before = JSON.parse(readFileSync(values.before)), after = JSON.parse(readFileSync(values.after));
for (const field of ['runs', 'frames', 'warmup']) assert.equal(after[field], before[field], field);
assert.equal(after.results.length, before.results.length);
assert.ok(after.results.length > 0);
const key = r => `${r.mode}:${r.count}:${r.run}`;
const previous = new Map(before.results.map(r => [key(r), r]));
assert.equal(previous.size, before.results.length, 'duplicate baseline runs');
assert.equal(new Set(after.results.map(key)).size, after.results.length, 'duplicate candidate runs');
for (const r of after.results) {
  const p = previous.get(key(r));
  assert.ok(p, `Missing baseline ${key(r)}`);
  for (const field of ['adapter', 'resolution', 'package_sha256', 'digest', 'screenshot_sha256'])
    assert.deepEqual(r[field], p[field], `${key(r)}: ${field}`);
  assert.equal(r.submitted, r.count, 'Capture must not double the sprite count');
  assert.equal(r.draws, r.mode === 'layering' ? 3 : 1);
  assert.equal(r.upload_bytes, r.mode === 'moving' ? r.count * 24 : 0);
}
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const scenarios = [...new Set(after.results.map(r => `${r.mode}:${r.count}`))].map(id => {
  const a = after.results.filter(r => `${r.mode}:${r.count}` === id);
  const b = before.results.filter(r => `${r.mode}:${r.count}` === id);
  assert.equal(a.length, after.runs);
  const metric = f => ({ before: median(b.map(f)), after: median(a.map(f)) });
  const prepare = metric(r => r.cpu.prepare.mean_ms);
  return { scenario: id, samples_per_variant: a.length * after.frames,
    prepare_mean_ms_median: prepare, prepare_reduction_percent: (1 - prepare.after / prepare.before) * 100,
    prepare_p95_ms_median: metric(r => r.cpu.prepare.p95_ms),
    encode_submit_mean_ms_median: metric(r => r.cpu.encode_submit.mean_ms),
    fps_median: metric(r => r.fps), after_draws: a[0].draws, after_upload_bytes: a[0].upload_bytes,
    package_sha256: a[0].package_sha256, snapshot_digest: a[0].digest, screenshot_sha256: a[0].screenshot_sha256 };
});
const report = { date: new Date().toISOString(), scope: after.scope, adapter: after.results[0].adapter,
  resolution: after.results[0].resolution, before_player_sha256: before.player_sha256,
  after_player_sha256: after.player_sha256, warmup: after.warmup, runs: after.runs,
  equivalent_end_frames: after.results.length, scenarios,
  limitations: [
    'Static freezes simulation; moving executes one actual Luau update per presentation, not real-time 60 Hz gameplay.',
    'No native-codegen; both builds use the same release interpreter configuration.',
    'FPS includes present/surface wait and is capped by this display near 180 Hz; CPU phases are measured separately.',
    'GPU time is unavailable. End-frame PNG hashes prove these samples, not every possible scene.',
    'Baseline capture doubles reported 2D draw/instance counts. Candidate corrects that telemetry bug; baseline raw counts are excluded from comparisons.',
  ] };
writeFileSync(values.out, JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
