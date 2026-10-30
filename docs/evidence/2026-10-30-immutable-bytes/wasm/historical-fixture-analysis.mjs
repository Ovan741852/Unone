import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root='D:/Projects/Unone',out=path.join(root,'.cache/immutable-bytes-fixture-transition-905e20e-run1');
assert(!fs.existsSync(out));fs.mkdirSync(out);
const sha=data=>createHash('sha256').update(data).digest('hex');
const nativeFile=path.join(root,'.cache/immutable-bytes-native-final-r1.json');
const wasmFile=path.join(root,'.cache/immutable-bytes-wasm-functional-905e20e-run1/report.json');
const finalFile=path.join(root,'crates/unone-engine/tests/fixtures/immutable-bytes.luau');
const nativeBytes=fs.readFileSync(nativeFile),wasmBytes=fs.readFileSync(wasmFile),finalBytes=fs.readFileSync(finalFile);
const native=JSON.parse(nativeBytes),wasm=JSON.parse(wasmBytes),final=finalBytes.toString('utf8');
const oldComment='-- check (scripts/verify-immutable-bytes-wasm.mjs): both must observe the same.';
const newComment='-- check (scripts/verify-immutable-bytes-functional-wasm.mjs): both observe the same.';
const oldMessage='assert(not ok, "expected a failure containing " .. needle)';
const newMessage='assert(not ok, "expected a failure containing " .. needle .. "; ok=" .. tostring(ok) .. "; result=" .. tostring(err))';
const report={schema:'unone.immutable-bytes.fixture-transition.v1',ok:false,
 scope:'Exact historical fixture reconstruction plus read-only comparison of independently executed Native R1 and final WASM reports; no native report mutation or exact-pair gate waiver',
 pins:{native_report:{path:nativeFile,sha256:sha(nativeBytes)},wasm_report:{path:wasmFile,sha256:sha(wasmBytes)},final_fixture:{path:finalFile,sha256:sha(finalBytes)}},
 changes:[{kind:'comment-only',from:oldComment,to:newComment},{kind:'assertion-diagnostic-expression',from:oldMessage,to:newMessage}],
 limitations:[
 'FinalNativeR2 was blocked before execution; this record does not relabel that attempt as passed.',
 'The functional verifier exact fixture-hash gate remains unchanged. These two executed reports have distinct fixture hashes.',
 'Lua evaluates assert arguments eagerly: the expanded diagnostic builds extra strings/calls tostring even when rejection assertions pass. No allocation or performance equivalence is inferred.',
 'Parent source owner reports VM C++ unchanged between Native R1 and finalWASM; report files alone do not prove an entire binary/source identity.',
 'Default development R2 passing tests have no canonical checkpoint report here; no canonical pairing is inferred from them.',
 'No runtime, Native executable, browser or collector executes in this analysis.'
 ],checkpoints:[]};
fs.copyFileSync(import.meta.filename,path.join(out,'analysis-script.mjs'));
try{
 assert.equal(sha(finalBytes),'f1165619a599cbba98835b4b5ce1fb9c0a863cb22dfdbead72a5dc8551881848');
 assert.equal(final.split(newComment).length-1,1);assert.equal(final.split(newMessage).length-1,1);
 const r2=final.replace(newComment,oldComment),r1=r2.replace(newMessage,oldMessage);
 assert.equal(sha(r2),'a8b742a96bf90a7a30851fa688354e99c7e4d1a3b599afaa577f87023fbcfe8c');
 assert.equal(sha(r1),'65a7557ea5d325a22b79816c64e7b4deaeb5aed1a7b6e0b089d7ab712d8b7c38');
 assert.equal(sha(r1),native.fixture_sha256);
 fs.writeFileSync(path.join(out,'historical-native-r1-65a7557.luau'),r1);
 fs.writeFileSync(path.join(out,'historical-development-r2-a8b742a.luau'),r2);
 fs.writeFileSync(path.join(out,'final-f1165619.luau'),finalBytes);
 report.reconstructed={native_r1:{sha256:sha(r1),bytes:Buffer.byteLength(r1)},development_r2:{sha256:sha(r2),bytes:Buffer.byteLength(r2)}};
 assert.equal(native.ok,true);assert.equal(wasm.ok,true);assert.equal(native.seed,42);
 assert.deepEqual(native.config,{name:'immutable-bytes',entry_script:'main.luau'});
 assert.equal(wasm.pins.fixture.sha256,sha(finalBytes));assert.equal(native.checkpoints.length,4);
 for(let i=0;i<4;i++){
  const old=native.checkpoints[i],current=wasm.checkpoints[i];
  assert.equal(old.frame,i);assert.equal(current.frame,i);
  assert.equal(current.observation_digest,old.observation_digest);
  assert.deepEqual(current.world,old.world);assert.deepEqual(current.observations,old.observations);
  assert.deepEqual(current.save_payload,old.save_payload);
  report.checkpoints.push({frame:i,digest:old.observation_digest,full_world_equal:true,all_observations_equal:true,save_equal:true,allowlist:[]});
 }
 report.ok=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{
 assert.equal(sha(fs.readFileSync(nativeFile)),sha(nativeBytes),'Historical report changed');
 assert.equal(sha(fs.readFileSync(wasmFile)),sha(wasmBytes),'Actual WASM report changed');
 assert.equal(sha(fs.readFileSync(finalFile)),sha(finalBytes),'Final fixture changed');
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({ok:report.ok,report:path.join(out,'report.json'),reconstructed:report.reconstructed,canonical_checkpoints:report.checkpoints.length,error:report.error}));
}
