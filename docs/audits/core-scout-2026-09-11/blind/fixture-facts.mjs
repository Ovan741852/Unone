import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const paths = ['project.unone.json', 'scenes/main.scene.json', 'scripts/main.luau', 'tests/bootstrap-idle.test.json', 'tests/bootstrap-input.test.json'];
const files = paths.map(relative => {
  const data = fs.readFileSync(path.join(root, 'game', relative));
  return { path: relative, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), contents: data.toString('utf8') };
});
const phase = process.argv[2];
if (!['before-session', 'after-session'].includes(phase)) throw new Error('Unknown phase');
const result = { phase, utc: new Date().toISOString(), files };
fs.writeFileSync(path.join(root, 'fixture-' + phase + '.json'), JSON.stringify(result, null, 2) + '\n');
fs.appendFileSync(path.join(root, 'events.jsonl'), JSON.stringify({ type: 'fixture_snapshot', phase, utc: result.utc, files: files.map(({contents, ...facts}) => facts) }) + '\n');
console.log(JSON.stringify(result, null, 2));
