import test from 'node:test';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {sourceFingerprint} from './verify-runtime-modes.mjs';
import assert from 'node:assert/strict';
import {compareModes} from './verify-runtime-modes.mjs';
const pair=()=>{
 const a={schema:'unone.execution-probe.v1',engine_version:'test',project_sha256:'p',scenario_sha256:'s',seed:42,warmup:0,requested_frames:1,completed_frames:1,compiled_systems:[],tick_ms:[4],failure:null,checkpoints:[{tick:0,digest:'a'},{tick:1,digest:'b',failure_code:null}],execution:{rust_profile:'release',preview_tools:true,native_codegen_requested:false,luau_execution:'interpreter',target_arch:'x86_64',target_os:'windows'},measurement:{sampling:true},diagnosis:{}};
 const b={...structuredClone(a),tick_ms:[1],execution:{...a.execution,preview_tools:false,native_codegen_requested:true,native_codegen_supported:true,luau_execution:'native-codegen-eligible'},measurement:{sampling:false},diagnosis:null};return [a,b];
};
test('source fingerprint covers embedded JSON and Luau, not only Rust files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'unone-fingerprint-'));
 try{
  await mkdir(join(root,'crates/unone-engine/src'),{recursive:true});
  await mkdir(join(root,'crates/unone-engine/examples'),{recursive:true});
  for(const path of ['Cargo.toml','Cargo.lock','crates/unone-engine/Cargo.toml','crates/unone-engine/src/lib.rs','crates/unone-engine/src/ui-contract.json','crates/unone-engine/src/engine.d.luau'])await writeFile(join(root,path),'fixture');
  const original=await sourceFingerprint(root);
  for(const name of ['ui-contract.json','engine.d.luau']){
   const path=join(root,'crates/unone-engine/src',name);await writeFile(path,'changed');
   assert.notEqual(await sourceFingerprint(root),original);await writeFile(path,'fixture');
  }
  assert.equal(await sourceFingerprint(root),original);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('pair verifies exact behavior but does not claim speedup from diagnostic/production ratio',()=>{const r=compareModes(...pair());assert.equal(r.passed,true);assert.equal(r.production_mean_tick_ms,1);assert.equal(r.verdict,'paired-behavior-verified-not-an-optimization-verdict');});
test('failure or first changed tick blocks a production timing verdict',()=>{let [a,b]=pair();b.checkpoints[1].digest='different';assert.equal(compareModes(a,b).first_divergence.checkpoint,1);assert.equal(compareModes(a,b).production_mean_tick_ms,null);[a,b]=pair();a.failure=b.failure={tick:1};const r=compareModes(a,b);assert.equal(r.behavior_match,true);assert.equal(r.passed,false);});
test('mismatched payload, wrong release flags, unavailable codegen or sampling fail explicitly',()=>{for(const mutate of [b=>b.project_sha256='other',b=>b.execution.rust_profile='debug',b=>b.execution.native_codegen_supported=false,b=>b.measurement.sampling=true,b=>b.execution.target_arch='arm64',b=>b.tick_ms=[NaN]]){const [a,b]=pair();mutate(b);assert.throws(()=>compareModes(a,b),e=>Boolean(e.code&&e.fix));}});
test('malformed or incomplete success reports cannot masquerade as verified behavior',()=>{for(const mutate of [b=>delete b.execution,b=>delete b.failure,b=>b.checkpoints.pop(),b=>b.tick_ms=[],b=>b.checkpoints[1].tick=99]){const [a,b]=pair();mutate(b);assert.throws(()=>compareModes(a,b),e=>Boolean(e.code&&e.fix));}});
