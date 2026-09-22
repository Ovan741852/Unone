import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const projectRoot = resolve(readArg('--root') ?? process.env.UNONE_PROJECT_ROOT ?? process.cwd());
const pluginDir = join(projectRoot, 'plugins', 'org.unone.ai-native');
const cli = join(pluginDir, 'cli.mjs');
const relativeSubjects = [
  'plugins/org.unone.ai-native/README.md',
  'plugins/org.unone.ai-native/docs/discovery.md',
  'plugins/org.unone.ai-native/docs/report.md',
  'plugins/org.unone.ai-native/package.json',
  'plugins/org.unone.ai-native/plugin.json',
  'plugins/org.unone.ai-native/cli.mjs',
  'plugins/org.unone.ai-native/plugin.mjs',
];
const query = 'Assess Scout itself for AI-native usability and give it an evidence-based score';
const commands = [
  ['recommend', '--query', query],
  ['describe', '--operation', 'ai_native.init'],
  ['init', '--id', 'org.unone.ai-native', '--name', 'Unone AI-native Audit', '--surface', 'plugin', '--root', projectRoot],
  ['describe', '--operation', 'ai_native.evaluate'],
  ['catalog'],
  ['snapshot', '--root', projectRoot, ...relativeSubjects.flatMap((path) => ['--path', path])],
];

const runs = commands.map((args, index) => {
  const argv = [cli, ...args];
  const started = process.hrtime.bigint();
  const child = spawnSync(process.execPath, argv, {
    cwd: pluginDir,
    env: { ...process.env, UNONE_PROJECT_ROOT: projectRoot },
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return {
    step: index + 1,
    command: [process.execPath, ...argv],
    cwd: pluginDir,
    environment: {
      UNONE_PROJECT_ROOT: projectRoot,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    stdout: child.stdout ?? '',
    stderr: child.stderr ?? '',
    exitCode: child.status,
    signal: child.signal,
    elapsedMs: Number(process.hrtime.bigint() - started) / 1_000_000,
    spawnError: child.error?.message ?? null,
  };
});

process.stdout.write(`${JSON.stringify({
  schema: 'org.unone.ai-native-audit.cli-observation.v1',
  projectRoot,
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  commands: runs,
})}\n`);
