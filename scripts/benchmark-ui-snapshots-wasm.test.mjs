// Preflight/contract tests only. No synthetic VM or Core API implements the
// benchmark here; actual emitted-runtime execution is recorded separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {settings,validatePair,fixtureSource,scheduleVariants,compareRuns,closeRuntime} from './benchmark-ui-snapshots-wasm.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const run=args=>spawnSync(process.execPath,['scripts/benchmark-ui-snapshots-wasm.mjs',...args],{cwd:root,encoding:'utf8',timeout:10000});
function metadata(source='a',wasm='b'){
 return {source_commit:source.repeat(40),source_dirty:false,profile:'release',bytecode_optimization_level:2,
  dev_tools:false,preview_tools:false,phase_profile:false,sampling_profile:false,runtime_packages:{'@unone/ui':'0.6.0'},
  compiled_systems:['world','ui','input'],cargo_features:['ui'],wasm_sha256:wasm.repeat(64)};
}
function temporary(t){fs.mkdirSync(path.join(root,'.cache'),{recursive:true});const base=fs.mkdtempSync(path.join(root,'.cache/ui-snapshots-preflight-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));return base;}

test('help states actual artifact pins and measurement boundaries',()=>{
 const result=run(['--help']);assert.equal(result.status,0);assert.match(result.stdout,/before-pins/);assert.match(result.stdout,/fresh process\/VM/);
 assert.match(result.stdout,/profiling OFF/);assert.match(result.stdout,/never isolated clone/);assert.match(result.stdout,/NO A\/B improvement claim/);
});

test('bounded settings reject empty, duplicate, fractional, excessive and unknown case choices',()=>{
 assert.deepEqual(settings({}).sizes,[0,256,2048,8192]);assert.deepEqual(settings({modes:'changing',ticks:'1',warmup:'0','diagnostic-ticks':'0'}).modes,['changing']);
 for(const values of [{sizes:''},{sizes:'256,256'},{sizes:'257'},{sizes:'8192,2048,256,0,0'},{modes:''},{modes:'static,static'},{modes:'mock'},
  {ticks:'0'},{ticks:'2.5'},{ticks:'2001'},{warmup:'-1'},{rounds:'4'},{'diagnostic-ticks':'2001'},{'timeout-ms':'999'}])assert.throws(()=>settings(values));
});

test('each production round counterbalances ABBA with reverse order; identical artifacts are functional-only',()=>{
 assert.deepEqual(scheduleVariants(),['before','after','after','before','after','before','before','after']);
 assert.deepEqual(scheduleVariants(true),['before','after']);const selected=metadata();
 assert.throws(()=>validatePair(selected,selected),/Different pinned sources/);assert.doesNotThrow(()=>validatePair(selected,selected,true));
 const differentSource=metadata('c','b');assert.throws(()=>validatePair(selected,differentSource),/One artifact/);
});

test('production pair requires identical actual capabilities, opt2 and exact UI package contract',()=>{
 const before=metadata(),after=metadata('c','d');assert.doesNotThrow(()=>validatePair(before,after));
 assert.doesNotThrow(()=>validatePair(before,{...after,compiled_systems:[...after.compiled_systems].reverse()}));
 for(const key of ['source_dirty','dev_tools','preview_tools','phase_profile','sampling_profile'])assert.throws(()=>validatePair(before,{...after,[key]:true}));
 for(const delta of [{profile:'debug'},{bytecode_optimization_level:0},{runtime_packages:{'@unone/ui':'0.5.0'}},
  {compiled_systems:['world','input']},{cargo_features:['ui','random']},{runtime_packages:{'@unone/ui':'0.6.0',other:'1'}}])assert.throws(()=>validatePair(before,{...after,...delta}));
});

test('fixtures use real bundled constructors and publish one static root or one changed leaf',()=>{
 for(const size of [0,256,2048,8192])for(const mode of ['static','changing']){
  const source=fixtureSource(size,mode);assert.match(source,/api\.ui\.components\.create\(\)/);assert.match(source,new RegExp(`local count=${size};`));
  assert.match(source,/kit\.imageBatch\(/);assert.match(source,/kit\.screen\(/);assert.match(source,/max_nodes=16384/);
  const update=source.slice(source.indexOf('function Game.update'));
  if(mode==='static'){assert(!update.includes('api.ui.setRoot('));assert(!update.includes('screen('));}
  else{assert.match(update,/root=screen\(tostring\(turn%2\)\)/);assert.match(update,/api\.ui\.setRoot\(root\)/);}
  assert(!source.includes('collectgarbage'));assert(!source.includes('setmetatable'));assert(!source.includes('api={'));
 }
 assert.throws(()=>fixtureSource(1,'static'));assert.throws(()=>fixtureSource(256,'fake'));
});

test('parity rejects a single earlier digest or final field difference, not only endpoint/count equality',()=>{
 const reference={digests:['load','warmup','first','last'],final_world_canonical:'{"entities":[],"observations":{"key":1},"ui":{}}',final_save_canonical:'null',
  final:{frame:3,core_digest:'last',world_sha256:'world',ui_sha256:'ui',save_sha256:'save'},final_counts:{logical_nodes:258,image_quads:256}};
 assert.doesNotThrow(()=>compareRuns(structuredClone(reference),reference));
 const early=structuredClone(reference);early.digests[1]='changed warmup';assert.throws(()=>compareRuns(early,reference),/Every Core digest/);
 for(const key of ['final_world_canonical','final_save_canonical'])assert.throws(()=>compareRuns({...reference,[key]:'different'},reference));
 for(const key of ['ui_sha256','world_sha256','core_digest','save_sha256'])assert.throws(()=>compareRuns({...reference,final:{...reference.final,[key]:'different'}},reference));
 assert.throws(()=>compareRuns({...reference,final_counts:{logical_nodes:257,image_quads:256}},reference));
});

test('immutable runtime output containment rejects before reading pins or writing artifacts',t=>{
 const base=temporary(t),before=path.join(base,'before'),after=path.join(base,'after');fs.mkdirSync(before);fs.mkdirSync(after);
 fs.writeFileSync(path.join(before,'runtime.json'),'must not be parsed');fs.writeFileSync(path.join(after,'runtime.json'),'also not parsed');
 for(const runtime of [before,after]){
  const out=path.join(runtime,'forbidden');const result=run(['--before',before,'--after',after,'--before-pins','absent','--after-pins','absent','--out',out]);
  assert.notEqual(result.status,0);assert.match(result.stderr,/outside immutable runtimes/);assert(!fs.existsSync(out));
 }
 assert.deepEqual(fs.readdirSync(before),['runtime.json']);assert.equal(fs.readFileSync(path.join(before,'runtime.json'),'utf8'),'must not be parsed');
});

test('pin mismatch rejects before creating an output or instantiating any runtime',t=>{
 const base=temporary(t),runtime=path.join(base,'runtime'),out=path.join(base,'output'),pins=path.join(base,'pins.json');fs.mkdirSync(runtime);
 fs.writeFileSync(path.join(runtime,'runtime.json'),'not matching pinned metadata');
 fs.writeFileSync(pins,JSON.stringify({manifest:'0'.repeat(64),source:'a'.repeat(40),javascript:'1'.repeat(64),wasm:'2'.repeat(64)}));
 const result=run(['--before',runtime,'--after',runtime,'--before-pins',pins,'--after-pins',pins,'--out',out]);
 assert.notEqual(result.status,0);assert.match(result.stderr,/Pin mismatch/);assert(!fs.existsSync(out));assert.deepEqual(fs.readdirSync(runtime),['runtime.json']);
});

test('cleanup unloads an initialized module if Core construction fails and does not claim uninitialized closure',()=>{
 let unloads=0,closes=0;const module={_unone_web_unload_project(){unloads++;return 0;}};
 const failedConstructor={};closeRuntime(undefined,module,failedConstructor);assert.equal(unloads,1);assert.equal(failedConstructor.closed,true);assert.match(failedConstructor.cleanup_via,/construction-failure/);
 const successfulCore={};closeRuntime({close(){closes++;}},module,successfulCore);assert.equal(closes,1);assert.equal(unloads,1);assert.equal(successfulCore.cleanup_via,'runtime-core.close');
 const uninitialized={};closeRuntime(undefined,undefined,uninitialized);assert.equal(uninitialized.closed,false);assert.equal(uninitialized.cleanup_via,'not-initialized');
 const failedClose={};assert.throws(()=>closeRuntime({close(){throw Error('close failed');}},module,failedClose),/close failed/);assert.notEqual(failedClose.closed,true);
 const rejectedUnload={};assert.throws(()=>closeRuntime(undefined,{_unone_web_unload_project:()=>1},rejectedUnload),/Emitted unload failed/);assert.notEqual(rejectedUnload.closed,true);
});
