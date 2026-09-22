import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const index = process.argv.indexOf('--root');
const projectRoot = resolve(index >= 0 ? process.argv[index + 1] : process.env.UNONE_PROJECT_ROOT ?? process.cwd());
const pluginDir = join(projectRoot, 'plugins', 'org.unone.ai-native');
const cli = join(pluginDir, 'cli.mjs');
const started = process.hrtime.bigint();
const child = spawnSync(process.execPath, [cli, 'describe', '--operation', 'ai_native.register'], {
  cwd: pluginDir,
  env: { ...process.env, UNONE_PROJECT_ROOT: projectRoot },
  encoding: 'utf8',
  timeout: 10_000,
  maxBuffer: 512 * 1024,
});

process.stdout.write(`${JSON.stringify({
  schema: 'org.unone.ai-native-audit.readonly-contract-observation.v1',
  projectRoot,
  command: [process.execPath, cli, 'describe', '--operation', 'ai_native.register'],
  cwd: pluginDir,
  environment: { UNONE_PROJECT_ROOT: projectRoot, node: process.version, platform: process.platform, arch: process.arch },
  stdout: child.stdout ?? '',
  stderr: child.stderr ?? '',
  exitCode: child.status,
  elapsedMs: Number(process.hrtime.bigint() - started) / 1_000_000,
  spawnError: child.error?.message ?? null,
})}\n`);
