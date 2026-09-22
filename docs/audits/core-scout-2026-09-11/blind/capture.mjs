import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const binary = 'D:/Projects/Unone/target/release/game.exe';
const game = path.join(root, 'game');
const logs = path.join(root, 'raw');
fs.mkdirSync(logs, { recursive: true });
const [mode, label] = process.argv.slice(2);
const plans = JSON.parse(fs.readFileSync(path.join(root, 'plans.json'), 'utf8'));
const plan = plans[label];
if (!plan) throw new Error('Unknown explicit plan label');
const argv = plan.argv.map(value => value === '$GAME' ? game : value);
const start = new Date().toISOString();
const base = path.join(logs, label);
const eventFile = path.join(root, 'events.jsonl');
const event = value => fs.appendFileSync(eventFile, JSON.stringify(value) + '\n');
event({ type: 'process_start', mode, label, utc: start, executable: binary, argv, cwd: root });
const child = spawn(binary, argv, { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
let input = '';
let timedOut = false;
const timeout = setTimeout(() => { timedOut = true; child.kill(); }, mode === 'interactive' ? 600000 : 20000);
child.stdout.on('data', b => {
  const value = b.toString('utf8');
  stdout += value;
  fs.appendFileSync(base + '.stdout', b);
  event({ type: 'stdout', label, utc: new Date().toISOString(), data: value });
  if (mode === 'interactive') process.stdout.write(value);
});
child.stderr.on('data', b => {
  const value = b.toString('utf8');
  stderr += value;
  fs.appendFileSync(base + '.stderr', b);
  event({ type: 'stderr', label, utc: new Date().toISOString(), data: value });
  if (mode === 'interactive') process.stderr.write(value);
});
child.on('error', error => {
  event({ type: 'spawn_error', label, message: error.message });
});
if (mode === 'interactive') {
  process.stdin.on('data', b => {
    const value = b.toString('utf8');
    input += value;
    fs.appendFileSync(base + '.stdin', b);
    event({ type: 'stdin', label, utc: new Date().toISOString(), data: value });
    child.stdin.write(b);
  });
  process.stdin.on('end', () => child.stdin.end());
} else {
  child.stdin.end();
}
child.on('close', (exitCode, signal) => {
  clearTimeout(timeout);
  const record = { label, mode, start, end: new Date().toISOString(), executable: binary, argv, cwd: root, exitCode, signal, timedOut, stdin: input, stdout, stderr };
  fs.writeFileSync(base + '.json', JSON.stringify(record, null, 2) + '\n');
  event({ type: 'process_close', label, utc: record.end, exitCode, signal, timedOut });
  if (mode !== 'interactive') {
    console.log(JSON.stringify({ label, exitCode, signal, timedOut, stdoutBytes: Buffer.byteLength(stdout), stderrBytes: Buffer.byteLength(stderr), record: base + '.json' }));
    if (Buffer.byteLength(stdout) < 12000) process.stdout.write(stdout);
    else console.log('Full stdout retained at ' + base + '.stdout');
    if (stderr) process.stderr.write(stderr);
  }
  process.stdin.destroy();
  process.exitCode = exitCode === 0 ? 0 : 1;
});

const identityPath = path.join(root, 'binary-identity.json');
if (!fs.existsSync(identityPath)) {
  const stat = fs.statSync(binary);
  fs.writeFileSync(identityPath, JSON.stringify({ path: binary, bytes: stat.size, lastWriteUtc: stat.mtime.toISOString(), sha256: crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'), host: process.platform, node: process.version }, null, 2) + '\n');
}
