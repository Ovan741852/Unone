// Actual native GPU runs, with deterministic end-frame screenshots/digests.
// Build the player in release before running; output directories must be new.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  player: { type: 'string' }, out: { type: 'string' },
  counts: { type: 'string', default: '1000,10000' },
  runs: { type: 'string', default: '3' }, frames: { type: 'string', default: '180' },
  warmup: { type: 'string', default: '30' },
} });
if (!values.player || !values.out) throw new Error('Use --player <release exe> --out <new directory>');
const counts = values.counts.split(',').map(Number);
const runs = Number(values.runs), frames = Number(values.frames), warmup = Number(values.warmup);
if ([...counts, runs, frames].some(n => !Number.isInteger(n) || n < 1 || n > 100000)
    || !Number.isInteger(warmup) || warmup < 0 || warmup > 100000) throw new Error('Invalid benchmark bounds');
const player = resolve(values.player), out = resolve(values.out);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
mkdirSync(out, { recursive: false });
const summary = { player, player_sha256: sha(readFileSync(player)), runs, frames, warmup,
  scope: 'Windows native GPU Sprite renderer; synthetic scenes, not game FPS or mobile evidence', results: [] };
const cases = counts.flatMap(count => ['static', 'moving'].map(mode => ({ mode, count })));
cases.push({ mode: 'layering', count: 12 });
for (const { mode, count } of cases) {
  const root = join(out, `${mode}-${count}`);
  mkdirSync(join(root, 'content'), { recursive: true });
  const cols = Math.ceil(Math.sqrt(count * 16 / 9));
  const rows = Math.ceil(count / cols);
  const entities = Array.from({ length: count }, (_, i) => ({
    id: String(i),
    transform: { x: mode === 'layering' ? (i % 3 - 1) * 0.7 : ((i % cols + 0.5) / cols - 0.5) * 16,
      y: mode === 'layering' ? (Math.floor(i / 3) - 1.5) * 0.35 : (Math.floor(i / cols) + 0.5) / rows * 9 - 4.5 },
    rotation: mode === 'layering' ? i * 0.15 : 0,
    sprite: { asset: `asset://${mode === 'layering' && i % 3 === 1 ? 'coral' : 'mint'}`,
      size: { x: mode === 'layering' ? 3 : 15 / cols, y: mode === 'layering' ? 2 : 8 / rows },
      layer: mode === 'layering' ? i % 3 : 0 },
  }));
  const script = mode === 'moving' ? `
local t = 0
return { start = function(api) end, update = function(api, dt)
  t += dt
  for i = 0, ${count - 1} do
    api.entity.setPosition(tostring(i), {
      x = ((i % ${cols} + 0.5) / ${cols} - 0.5) * 16 + math.sin(t + i) * 0.01,
      y = (math.floor(i / ${cols}) + 0.5) / ${rows} * 9 - 4.5,
    })
  end
end }` : 'return { start = function(api) end, update = function(api, dt) end }';
  const files = {
    'content/project.json': JSON.stringify({ config: { name: 'Native sprite performance', entry_script: 'main.luau', systems: { physics2d: false } },
      script, scene: { camera: { projection: 'orthographic', orthographicSize: 10 }, entities } }),
    'content/assets.json': JSON.stringify({ assets: ['mint', 'coral'].map(id => ({ id: `asset://${id}`, kind: 'texture2d', source: `${id}.svg` })) }),
    'content/presentation.json': JSON.stringify({ bloom: false }),
    'content/mint.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#9ce5c8" fill-opacity="0.7"/><path d="M0 0 L32 32" stroke="#123a40" stroke-width="4"/></svg>',
    'content/coral.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="#f97373" fill-opacity="0.6"/></svg>',
  };
  for (const [path, bytes] of Object.entries(files)) writeFileSync(join(root, path), bytes);
  const manifest = JSON.stringify({ files: Object.entries(files).map(([path, bytes]) => ({ path, bytes: Buffer.byteLength(bytes), sha256: sha(bytes) })) });
  writeFileSync(join(root, 'export.json'), manifest);
  for (let run = 1; run <= runs; run++) {
    const reportPath = join(root, `run-${run}.json`);
    const args = ['--root', root, '--frames', String(frames), '--warmup', String(warmup),
      '--seed', '42', '--report', reportPath, mode === 'moving' ? '--fixed-tick' : '--freeze-simulation'];
    const child = spawnSync(player, args, { encoding: 'utf8', timeout: 180000, windowsHide: true });
    writeFileSync(join(root, `run-${run}.log`), `${child.stdout ?? ''}\n${child.stderr ?? ''}`);
    if (child.error || child.status !== 0) throw new Error(child.error?.message ?? `Player failed (${child.status}): ${child.stderr}`);
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    if (report.error || report.profile !== 'release' || !report.adapter || report.drawn !== frames + warmup)
      throw new Error(`Invalid native measurement: ${reportPath}`);
    const row = { mode, count, run, report: reportPath, package_sha256: report.package_sha256,
      adapter: report.adapter, resolution: report.resolution, digest: report.observation_digest,
      screenshot_sha256: sha(readFileSync(reportPath.replace(/\.json$/, '.png'))),
      draws: report.draw_calls_last_frame, upload_bytes: report.upload_bytes_last_frame,
      submitted: report.submitted_instances_last_frame, fps: report.fps,
      render: report.render_submit, cpu: report.renderer_cpu_phases, tick: report.tick };
    summary.results.push(row);
    writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(row));
  }
}
