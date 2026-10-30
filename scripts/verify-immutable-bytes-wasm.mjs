// Run immutable bytes in the actual Wasm player under Node: the shared
// correctness fixture first, then per-read cost of frozen buffers against the
// alternatives. Usage:
//   node scripts/verify-immutable-bytes-wasm.mjs [--js <unone-player.js>] [--wasm <unone_player.wasm>]
// Defaults to the release player in target/player. Prints one JSON report.
// The browser counterpart is web/bench/immutable-bytes.html.
import {readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {loadProject, readObservation} from '../web/shared/load-project.js';
import {measureReads, verifyFixture} from '../web/bench/immutable-bytes.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const {values} = parseArgs({options: {js: {type: 'string'}, wasm: {type: 'string'}, ticks: {type: 'string'}, rounds: {type: 'string'}}});
const js = resolve(values.js ?? join(root, 'target/player/wasm32-unknown-emscripten/release/unone-player.js'));
const wasm = resolve(values.wasm ?? join(dirname(js), 'unone_player.wasm'));

const module = await new Promise((ready, reject) => {
  const options = {wasmBinary: new Uint8Array(readFileSync(wasm)), noInitialRun: true,
    onAbort: reason => reject(new Error(String(reason))), print: () => {}, printErr: message => process.stderr.write(`${message}\n`)};
  const context = {Module: options, crypto: webcrypto, window: {}, document: {currentScript: {src: pathToFileURL(js).href}},
    location: {href: pathToFileURL(js).href}, console, TextDecoder, TextEncoder, WebAssembly, setTimeout, clearTimeout, performance};
  options.onRuntimeInitialized = () => ready(context.Module);
  vm.runInNewContext(readFileSync(js, 'utf8'), context, {filename: js});
});

const fixtures = join(root, 'crates/unone-engine/tests/fixtures');
const host = {module, loadProject, readObservation, now: () => performance.now()};
const fixture = verifyFixture(host, readFileSync(join(fixtures, 'immutable-bytes.luau'), 'utf8'));
const reads = measureReads(host, readFileSync(join(fixtures, 'populous-readonly-bytes.luau'), 'utf8'),
  {ticks: Number(values.ticks ?? 40), rounds: Number(values.rounds ?? 3)});
console.log(JSON.stringify({ok: true, host: `node ${process.version}`, runtime: {js, wasm}, fixture, ...reads}, null, 2));
