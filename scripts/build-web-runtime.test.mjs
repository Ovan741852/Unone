import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {officialPlayerContract,selectedSystems,buildEnvironment,destination,checkWasm,main} from './build-web-runtime.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ps=fs.readFileSync(path.join(root,'scripts/build-web-live.ps1'),'utf8');

test('extracts the existing official player ABI, conditional particle ABI and linker policy',()=>{
 const production=officialPlayerContract(ps),diagnostic=officialPlayerContract(ps,{diagnostic:true});
 assert(production.exports.includes('sprite_resources_request'));
 assert(production.exports.includes('set_ui_transport'));
 assert(production.exports.includes('particle_sample'));
 assert(!production.exports.includes('developer_request'));
 assert(diagnostic.exports.includes('developer_request'));
 assert(!officialPlayerContract(ps,{particle:false}).exports.includes('particle_sample'));
 assert.deepEqual(production.linker,['-C','link-arg=-sENVIRONMENT=web','-C','link-arg=-sALLOW_MEMORY_GROWTH=1','-C','link-arg=-sASSERTIONS=1']);
});
test('contract extraction rejects ambiguous future arrays rather than silently building an old ABI',()=>{
 assert.throws(()=>officialPlayerContract(ps+"\n$exports = @('typo')"),/one official/);
 assert.throws(()=>officialPlayerContract(ps.replace("'init','alloc'","'init','init'")),/Duplicate official/);
 assert.throws(()=>officialPlayerContract(ps.replace('-sENVIRONMENT=web','-sENVIRONMENT=node')),/Web environment/);
});
test('systems report must be current all-system capabilities, not merely project enabled systems',()=>{
 const report={ok:true,value:{systems:[{id:'world',compiled:true,enabled:false},{id:'ui',compiled:true,enabled:true}]}};
 assert.deepEqual(selectedSystems(report),['ui','world']);
 assert.throws(()=>selectedSystems({ok:false}),/report/);
 assert.throws(()=>selectedSystems({ok:true,value:{systems:[{id:'ui',compiled:false}]}}),/every reported system/);
 assert.throws(()=>selectedSystems({ok:true,value:{systems:[{id:'ui',compiled:true},{id:'ui',compiled:true}]}}),/Duplicate/);
});
test('binary-format/ABI preflight does not accept JSON metadata as a substitute',()=>{
 const empty=Uint8Array.from([0,97,115,109,1,0,0,0]);
 assert.deepEqual(checkWasm(empty,{exports:[]},false),[]);
 assert.throws(()=>checkWasm(empty,{exports:['tick']},false),/Missing actual ABI/);
 assert.throws(()=>checkWasm(empty,{exports:[]},true),/Developer ABI isolation/);
 assert.throws(()=>checkWasm(Buffer.from('{}'),{exports:[]},false));
});
test('environment matches official export/linker settings and prevents encoded-flag override',()=>{
 const contract=officialPlayerContract(ps);
 const env=buildEnvironment({repo:root,emsdk:'/sdk',binaryen:'/binaryen',emscripten:'/sdk/upstream/emscripten',python:'/python3.11',contract,
  env:{RUSTFLAGS:'bad',CARGO_ENCODED_RUSTFLAGS:'bad',RUSTC_WRAPPER:'unrelated'}});
 assert.equal(env.CXXFLAGS_wasm32_unknown_emscripten,'-fwasm-exceptions');
 assert.equal(env.EM_BINARYEN_ROOT,'/binaryen');assert.equal(env.EMSDK_PYTHON,'/python3.11');
 assert.equal(env.RUSTFLAGS,[...contract.exports.flatMap(name=>['-C',`link-arg=--export=unone_web_${name}`]),...contract.linker].join(' '));
 assert(!Object.hasOwn(env,'CARGO_ENCODED_RUSTFLAGS'));assert(!Object.hasOwn(env,'RUSTC_WRAPPER'));
});
test('destination admission is read-only and rejects overwriting existing evidence',()=>{
 const temporary=fs.mkdtempSync(path.join(tmpdir(),'web-runtime-preflight-'));
 try{
  const candidate=path.join(temporary,'not-created','runtime');
  assert.equal(destination(candidate,{fresh:true}),candidate);
  assert(!fs.existsSync(path.dirname(candidate)),'Admission must not create output parents');
  assert.throws(()=>destination(temporary,{fresh:true}),/Refuse overwrite/);
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
test('Windows fails before reading a path or executing any command',async()=>{
 await assert.rejects(main(['--repo','must-not-be-read'],'win32'),/does not execute on Windows/);
});
