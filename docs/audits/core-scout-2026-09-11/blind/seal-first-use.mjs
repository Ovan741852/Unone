import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const sealPath = path.join(root, 'first-use-seal.json');
if (fs.existsSync(sealPath)) throw new Error('First-use evidence is already sealed; do not rewrite it.');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const requests = read('raw/009-session.stdin').trimEnd().split(/\r?\n/).map(JSON.parse);
const responses = read('raw/009-session.stdout').trimEnd().split(/\r?\n/).map(JSON.parse);
if (requests.length !== 22 || responses.length !== 22) throw new Error('Unexpected raw session count');
const pairs = requests.map((request, i) => ({ request_number: i + 1, operation_number_including_cli_launch: i + 10, request, response: responses[i] }));
fs.writeFileSync(path.join(root, 'first-use-session-pairs.json'), JSON.stringify(pairs, null, 2) + '\n');
const before = JSON.parse(read('fixture-before-session.json'));
const after = JSON.parse(read('fixture-after-session.json'));
const fixtureComparison = before.files.map(file => ({ path: file.path, sha256: file.sha256, unchanged: after.files.find(other => other.path === file.path)?.sha256 === file.sha256 }));
if (fixtureComparison.some(file => !file.unchanged)) throw new Error('Unexpected fixture change');
const summary = {
  utc: new Date().toISOString(),
  cli_processes: 9,
  session_requests: requests.length,
  operations_including_session_launch: 9 + requests.length,
  first_authoring_success: JSON.parse(read('raw/003-project-init.json')).end,
  fixtureComparison,
  replay: responses[15],
  perf: responses[13],
  cleanup: { runtime_close_succeeded: responses[21].ok && responses[21].value.closed, owned_idle_child_pid: 30216, parent_harness_pid: 22000, transport_terminated_after_runtime_close: true, both_processes_confirmed_absent: true },
  replay_probe_executed: false
};
fs.writeFileSync(path.join(root, 'first-use-summary.json'), JSON.stringify(summary, null, 2) + '\n');
const relatives = [
  'first-use-report.md', 'exploration-notes.md', 'events.jsonl', 'binary-identity.json',
  'fixture-before-session.json', 'fixture-after-session.json', 'first-use-session-pairs.json',
  'first-use-summary.json', 'capture.mjs', 'fixture-facts.mjs', 'plans.json', 'seal-first-use.mjs',
  ...fs.readdirSync(path.join(root, 'raw')).map(name => 'raw/' + name),
  ...before.files.map(file => 'game/' + file.path)
].sort();
const artifacts = relatives.map(relative => {
  const data = fs.readFileSync(path.join(root, relative));
  return { path: relative, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
});
const seal = { scope: 'Frozen first public Core exploration; subsequent probes are separate and excluded.', utc: new Date().toISOString(), artifacts };
fs.writeFileSync(sealPath, JSON.stringify(seal, null, 2) + '\n');
console.log(JSON.stringify({ sealPath, report: path.join(root, 'first-use-report.md'), artifactCount: artifacts.length, sessionPairs: requests.length, reportSha256: artifacts.find(x => x.path === 'first-use-report.md').sha256 }, null, 2));
