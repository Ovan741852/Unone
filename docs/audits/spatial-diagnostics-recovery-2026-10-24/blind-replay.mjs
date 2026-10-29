// Informed owner replay: copy only sealed headless inputs to a new temp project.
// The inspected JSON verifier reads one output file and spawns no subprocesses.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),fixture=resolve(here,'blind/scout-diagnostics-sdk');const env=JSON.parse(await readFile(resolve(here,'environment.json'),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');async function identities(){for(const f of [env.binary,env.analyzer])assert.equal(sha(await readFile(f.path)),f.sha256);}
await identities();
const config=JSON.parse(await readFile(resolve(fixture,'final-project/project.unone.json'),'utf8'));assert.equal(config.entry_script,'scripts/main.luau');assert.equal(config.main_scene,'scenes/main.scene.json');assert.deepEqual(config.test_files,[]);
const temp=await mkdtemp(resolve(tmpdir(),'unone-diagnostic-sealed-replay-'));await mkdir(resolve(temp,'scripts'));await mkdir(resolve(temp,'scenes'));
await writeFile(resolve(temp,'project.unone.json'),JSON.stringify(config));
for(const file of [config.entry_script,config.main_scene])await writeFile(resolve(temp,file),await readFile(resolve(fixture,'final-project',file)));
function cli(label,args){const argv=['--sdk',env.sdk,'--project',temp,...args,'--json'];const r=spawnSync(env.binary.path,argv,{cwd:temp,encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:4*1024*1024,env:{...process.env,UNONE_LUAU_ANALYZER:env.analyzer.path}});assert.ok(!r.error);assert.equal(r.status,0,r.stderr||r.stdout.slice(0,3000));const result=JSON.parse(r.stdout);assert.equal(result.ok,true);
 console.log(JSON.stringify({event:'command',label,argv:[env.binary.path,...argv],status:r.status,rawStdoutBytes:Buffer.byteLength(r.stdout),observed:args[0]==='run'?{status:result.value.status,frames:result.value.frames,observations:result.value.world.observations}:args[0]==='api'?{canonicalBytes:Buffer.byteLength(result.value.typings)}:result,stderr:r.stderr}));return {raw:r.stdout,result};}
const types=cli('canonical types',['api','typings']).result.value.typings;const normalize=s=>s.replaceAll('\r\n','\n');const source=await readFile(resolve(temp,config.entry_script),'utf8');assert.ok(normalize(source).includes(normalize(types).trimEnd()));
cli('official strict sealed project',['check','--types']);const run=cli('two-update sealed geometry',['run','--frames','2','--seed','42']);const output=resolve(temp,'actual-result.json');await writeFile(output,run.raw);
const verify=spawnSync(process.execPath,[resolve(fixture,'verify-json.mjs'),output],{cwd:temp,encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:30*1024});assert.equal(verify.status,0,verify.stdout+verify.stderr);const checked=JSON.parse(verify.stdout);assert.equal(checked.passed,13);assert.equal(checked.failed,0);
await identities();console.log(JSON.stringify({event:'task_result',complete:true,checked,temp,scope:'Informed replay of sealed SDK-only author input, official strict checking and reviewed independent13-check geometry/JSON/lifecycle/cost oracle. No benchmark, GPU authorship or rendered appearance claim.'}));
