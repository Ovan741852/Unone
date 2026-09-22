import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const projectRoot = resolve(readArg('--root') ?? process.env.UNONE_PROJECT_ROOT ?? process.cwd());
const pluginDir = join(projectRoot, 'plugins', 'org.unone.ai-native');
const entry = join(pluginDir, 'plugin.mjs');
const runs = [];

function invoke(tool, input) {
  const request = {
    protocol: 'unone.plugin.v1',
    action: 'call',
    plugin: 'org.unone.ai-native',
    tool,
    input,
  };
  const stdin = `${JSON.stringify(request)}\n`;
  const started = process.hrtime.bigint();
  const child = spawnSync(process.execPath, [entry], {
    cwd: pluginDir,
    env: { ...process.env, UNONE_PROJECT_ROOT: projectRoot },
    input: stdin,
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 512 * 1024,
  });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  const run = {
    step: runs.length + 1,
    command: [process.execPath, entry],
    cwd: pluginDir,
    environment: {
      UNONE_PROJECT_ROOT: projectRoot,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    stdin,
    stdout: child.stdout ?? '',
    stderr: child.stderr ?? '',
    exitCode: child.status,
    signal: child.signal,
    elapsedMs,
    spawnError: child.error?.message ?? null,
  };
  runs.push(run);
  return run;
}

function result(run) {
  try {
    return JSON.parse(run.stdout.trim());
  } catch {
    return null;
  }
}

const recommendation = result(invoke('ai_native.recommend', {
  query: 'Assess this plugin itself for AI-native usability and produce an evidence-based score',
}));
const initDescription = result(invoke('ai_native.describe', { operation: 'ai_native.init' }));
const initHash = initDescription?.value?.contractHash;
if (initHash) {
  invoke('ai_native.call', {
    operation: 'ai_native.init',
    contractHash: initHash,
    arguments: { id: 'org.unone.ai-native', name: 'Unone AI-native Audit', surface: 'plugin' },
  });
}
const evaluateDescription = result(invoke('ai_native.describe', { operation: 'ai_native.evaluate' }));
const evaluateHash = evaluateDescription?.value?.contractHash;
if (evaluateHash) {
  invoke('ai_native.call', {
    operation: 'ai_native.evaluate',
    contractHash: '0'.repeat(64),
    arguments: { report: {} },
  });
  invoke('ai_native.call', {
    operation: 'ai_native.evaluate',
    contractHash: evaluateHash,
    arguments: { report: {} },
  });
  invoke('ai_native.call', {
    operation: 'ai_native.evaluate',
    contractHash: evaluateHash,
    arguments: { report_path: '../../Cargo.lock' },
  });
}

process.stdout.write(`${JSON.stringify({
  schema: 'org.unone.ai-native-audit.probe-observation.v1',
  projectRoot,
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  recommendationSelected: recommendation?.value?.candidates?.map((item) => item.operation) ?? [],
  operations: runs,
})}\n`);
