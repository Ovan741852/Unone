// Uses the installed unone-shader protocol without relabelling GLSL as WGSL.
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const plugin=resolve(process.argv[2]),out=resolve(process.argv[3]);
function call(tool,input){
  const r=spawnSync(process.execPath,[plugin],{input:JSON.stringify({tool,input})+'\n',encoding:'utf8',env:{...process.env,UNONE_PROJECT_ROOT:process.cwd()}});
  assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
}
const source=await readFile('web/shared/webgpu-snapshot.js','utf8');
const wgsl=[...source.matchAll(/createShaderModule\(\{ code: `([\s\S]*?)` \}\)/g)].map(m=>m[1]);
assert.equal(wgsl.length,2);
const checks=wgsl.map((source,i)=>{
  const input={source,manifest:{id:`shader://yessir/raw/${i===0?'color':'texture'}`,language:'wgsl',stage:'fragment',entry_points:{vertex:'vs',fragment:'fs'},preview:{mode:'external'}}};
  const inspect=call('shader.inspect',input),preview=call('shader.preview',input);
  assert.ok(inspect.ok);assert.ok(preview.ok);assert.equal(preview.value.preview.compilation,'not_checked');
  return {inspect,preview};
});
const unsupported=call('shader.inspect',{source:'void main(){gl_FragColor=vec4(1.);}',manifest:{language:'glsl'}});
assert.equal(unsupported.ok,false);
const profiles={};
for(const phase of ['before','after']){
  const data=JSON.parse(await readFile(resolve(out,phase,'browser.json'),'utf8'));
  profiles[phase]=call('shader.profile',{frame_budget_ms:16.67,samples:data.samples});
  assert.ok(profiles[phase].ok);
}
await writeFile(resolve(out,'unone-shader.json'),JSON.stringify({checks,glslUnsupported:unsupported,profiles},null,2));
console.log('PASS 2 WGSL inspect + external preview contracts; GLSL correctly rejected; real GPU samples profiled');
for(const [phase,result]of Object.entries(profiles))console.log(phase,JSON.stringify(result.value.hotspots.map(x=>({mode:x.pass,p95_gpu_ms:x.gpu_ms,samples:x.gpu_samples,status:x.status}))));
