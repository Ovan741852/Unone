// CLI preflight only. Invalid synthetic metadata is rejected before any WASM
// initialization; these tests are not evidence of Core execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const run=args=>spawnSync(process.execPath,['scripts/profile-world-fields-wasm.mjs',...args],{cwd:root,encoding:'utf8',timeout:10000});
function fixture(){const base=fs.mkdtempSync(path.join(root,'.cache/world-field-profile-preflight-')),runtime=path.join(base,'runtime');fs.mkdirSync(runtime);return {base,runtime};}
test('help documents actual-runtime inputs without creating an output',()=>{const result=run(['--help']);assert.equal(result.status,0);assert.match(result.stdout,/input-sequence/);assert.match(result.stdout,/No GPU/);});
test('output inside runtime is rejected before reading or writing immutable artifact contents',()=>{
 const f=fixture(),manifest=path.join(f.runtime,'runtime.json');fs.writeFileSync(manifest,'intentionally not JSON');const out=path.join(f.runtime,'forbidden');
 const result=run(['--runtime',f.runtime,'--payload','unused','--input-sequence','unused','--out',out]);assert.notEqual(result.status,0);assert.match(result.stderr,/outside the immutable runtime/);
 assert.equal(fs.existsSync(out),false);assert.equal(fs.readFileSync(manifest,'utf8'),'intentionally not JSON');assert.deepEqual(fs.readdirSync(f.runtime),['runtime.json']);
});
test('invalid production metadata preserves a failed diagnostic before any VM or fake backend can run',()=>{
 const f=fixture();fs.writeFileSync(path.join(f.runtime,'runtime.json'),JSON.stringify({source_dirty:true}));const out=path.join(f.base,'failed');
 const result=run(['--runtime',f.runtime,'--payload','unused','--input-sequence','unused','--out',out]);assert.equal(result.status,1);
 const report=JSON.parse(fs.readFileSync(path.join(out,'result.json')));assert.equal(report.ok,false);assert.match(report.error,/clean production runtime/);assert.deepEqual(report.rows,[]);assert.equal(report.closed,undefined);assert.deepEqual(report.aborts,[]);
 assert(report.pins.some(pin=>pin.label==='runtime_manifest'));assert(!report.pins.some(pin=>pin.label==='runtime_wasm'));
});
