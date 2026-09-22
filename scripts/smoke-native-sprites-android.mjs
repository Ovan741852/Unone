// NativeActivity emulator smoke using the SAME packages as the Windows benchmark.
// Installs only the isolated com.unone.nativeplayer.spriteperf test application.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, cpSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: {
  source: { type: 'string' }, runtime: { type: 'string' }, cpp: { type: 'string' },
  out: { type: 'string' }, serial: { type: 'string', default: '127.0.0.1:5555' },
} });
for (const key of ['source', 'runtime', 'cpp', 'out']) if (!values[key]) throw new Error(`Missing --${key}`);
const out = resolve(values.out), source = resolve(values.source);
mkdirSync(out);
const run = (exe, args, options = {}) => {
  const r = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true, timeout: 120000, ...options });
  if (r.error || r.status !== 0) throw new Error(`${exe}: ${r.error?.message ?? r.stderr ?? r.stdout}`);
  return r.stdout;
};
const adb = (...args) => run('adb', ['-s', values.serial, ...args]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const runtime = join(out, 'runtime');
mkdirSync(runtime);
const files = [['libunone_native_player.so', values.runtime], ['libc++_shared.so', values.cpp]].map(([path, input]) => {
  copyFileSync(resolve(input), join(runtime, path));
  return { path, sha256: sha(readFileSync(join(runtime, path))) };
});
writeFileSync(join(runtime, 'runtime.json'), JSON.stringify({ target: 'android-x86_64', renderer: 'wgpu-native-instanced', files }));
const app = 'com.unone.nativeplayer.spriteperf';
const remote = `/sdcard/Android/data/${app}/files`;
const results = [];
for (const [name, count, draws, moving] of [['moving-10000', 10000, 1, true], ['layering-12', 12, 3, false]]) {
  const root = join(out, name);
  mkdirSync(root);
  cpSync(join(source, name, 'content'), join(root, 'content'), { recursive: true });
  copyFileSync(join(source, name, 'export.json'), join(root, 'export.json'));
  writeFileSync(join(root, 'native-player.json'), JSON.stringify({ seed: 42, frames: 180, warmup: 30,
    fixed_tick: moving, freeze_simulation: !moving }));
  writeFileSync(join(root, 'pack.log'), run('powershell.exe', ['-NoProfile', '-File',
    resolve('scripts/pack-native-android.ps1'), '-ContentRoot', root, '-RuntimeRoot', runtime,
    '-Target', 'android-x86_64', '-AppName', 'Unone Sprite Perf TEST', '-ApplicationId', app]));
  adb('install', '-r', join(root, 'game.apk'));
  adb('shell', 'am', 'force-stop', app);
  // Only our test application's two generated report files; prevent stale evidence.
  adb('shell', 'rm', '-f', `${remote}/benchmark.json`, `${remote}/benchmark.png`);
  adb('shell', 'am', 'start', '-W', '-n', `${app}/android.app.NativeActivity`);
  const deadline = Date.now() + 60000;
  while (spawnSync('adb', ['-s', values.serial, 'shell', 'test', '-f', `${remote}/benchmark.json`],
    { timeout: 5000, windowsHide: true }).status !== 0) {
    if (Date.now() > deadline) throw new Error(`Android report timed out: ${name}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  adb('pull', `${remote}/benchmark.json`, join(root, 'benchmark.json'));
  adb('pull', `${remote}/benchmark.png`, join(root, 'benchmark.png'));
  const report = JSON.parse(readFileSync(join(root, 'benchmark.json'), 'utf8'));
  const windows = JSON.parse(readFileSync(join(source, name, 'run-1.json'), 'utf8'));
  assert.equal(report.error, null);
  assert.equal(report.profile, 'release');
  assert.equal(report.host, 'android');
  assert.equal(report.drawn, 210);
  assert.equal(report.submitted_instances_last_frame, count);
  assert.equal(report.draw_calls_last_frame, draws);
  assert.equal(report.upload_bytes_last_frame, moving ? count * 24 : 0);
  assert.equal(report.package_sha256, windows.package_sha256);
  assert.equal(report.observation_digest, windows.observation_digest);
  results.push({ name, adapter: report.adapter, resolution: report.resolution, fps: report.fps,
    package_sha256: report.package_sha256, observation_digest: report.observation_digest,
    draws, submitted: count, upload_bytes: report.upload_bytes_last_frame,
    screenshot_sha256: sha(readFileSync(join(root, 'benchmark.png'))), error: report.error });
  writeFileSync(join(out, 'summary.json'), JSON.stringify({ serial: values.serial, application_id: app,
    runtime_files: files, scope: 'Android emulator correctness smoke; no Android before/after FPS claim', results }, null, 2));
  console.log(JSON.stringify(results.at(-1)));
}
