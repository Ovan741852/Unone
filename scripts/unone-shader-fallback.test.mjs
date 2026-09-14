import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import vm from 'node:vm';

// Explicit external dependency: never silently substitute a fake plugin implementation.
const pluginRoot=process.env.UNONE_SHADER_ROOT;
function call(tool,input){
  const r=spawnSync(process.execPath,[resolve(pluginRoot,'plugin.mjs')],{encoding:'utf8',input:JSON.stringify({tool,input})+'\n',env:{...process.env,UNONE_PROJECT_ROOT:pluginRoot}});
  assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
}
test('no navigator.gpu reports preview unavailable while real plugin inspection works',{skip:!pluginRoot&&'Set UNONE_SHADER_ROOT to test the installed plugin'},async()=>{
  const handlers={},status={style:{}},source={value:''};
  const elements={'#source':source,'#status':status,'#canvas':{getContext(){assert.fail('No GPU: must not render');}},'#render':{addEventListener:(_,fn)=>handlers.compile=fn},'#load':{addEventListener(){}}};
  const example=await readFile(resolve(pluginRoot,'examples/fullscreen.wgsl'),'utf8');
  const context=vm.createContext({document:{querySelector:id=>elements[id]},navigator:{},performance:{now:()=>0},fetch:async()=>({text:async()=>example}),requestAnimationFrame(){assert.fail('No GPU: must not start a render loop');}});
  vm.runInContext(await readFile(resolve(pluginRoot,'preview/app.mjs'),'utf8'),context);
  await new Promise(setImmediate);await handlers.compile();
  assert.match(status.textContent,/WebGPU is unavailable/i);assert.match(status.textContent,/no pixels are claimed/i);
  assert.doesNotMatch(status.textContent,/WGSL compiled|Rendering live preview/i);
  const inspected=call('shader.inspect',{source:example});assert.equal(inspected.ok,true);
  const preview=call('shader.preview',{source:example});assert.equal(preview.ok,true);
  assert.equal(preview.value.preview.compilation,'not_checked');assert.equal(preview.value.preview.renderable,undefined);
});
test('CPU-only plugin profile keeps GPU null and rejects samples with no timing',{skip:!pluginRoot&&'Set UNONE_SHADER_ROOT to test the installed plugin'},()=>{
  const profile=call('shader.profile',{samples:[{pass:'fallback',cpu_ms:2}]});assert.equal(profile.ok,true);
  assert.equal(profile.value.hotspots[0].gpu_ms,null);assert.equal(profile.value.hotspots[0].gpu_samples,0);
  assert.equal(profile.value.hotspots[0].cpu_ms,2);assert.equal(profile.value.timing_source,'cpu_only');
  assert.equal(call('shader.profile',{samples:[{pass:'fallback',draws:5}]}).ok,false);
});
