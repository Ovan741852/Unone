// Reviewed owner replay of the sealed author's generic fixture. This is informed,
// not a second blind trial. No commands from the exploration ledger are executed.
import assert from 'node:assert/strict';
import {readFile,mkdir,mkdtemp,writeFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verify} from './blind/scout-arrays-profile/verify-report.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const fixture=resolve(here,'blind/scout-arrays-profile');
const env=JSON.parse(await readFile(resolve(here,'environment.json'),'utf8'));
async function identity(file){const h=createHash('sha256');for await(const b of createReadStream(file.path))h.update(b);assert.equal(h.digest('hex'),file.sha256);assert.equal((await stat(file.path)).size,file.bytes);}
await identity(env.binary);await identity(env.analyzer);
const config=JSON.parse(await readFile(resolve(fixture,'project.final.json'),'utf8'));
assert.equal(config.entry_script,'scripts/main.luau');assert.equal(config.main_scene,'scenes/main.scene.json');
assert.deepEqual(config.test_files,[]);
const scene=JSON.parse(await readFile(resolve(fixture,'scene.final.json'),'utf8'));
assert.deepEqual(scene,{entities:[{id:'unrelated_synthetic',transform:{x:37,y:-11}}]});
const source=await readFile(resolve(fixture,'main.final.luau'),'utf8');
assert.ok(source.startsWith('--!strict\n'));assert.ok(!source.includes(':: any'));
const temp=await mkdtemp(resolve(tmpdir(),'unone-sealed-author-replay-'));
await mkdir(resolve(temp,'scripts'));await mkdir(resolve(temp,'scenes'));
await writeFile(resolve(temp,'project.unone.json'),JSON.stringify(config));
await writeFile(resolve(temp,config.main_scene),JSON.stringify(scene));
await writeFile(resolve(temp,config.entry_script),source);
function cli(label,args){
 const argv=['--sdk',env.sdk,'--project',temp,...args,'--json'];
 const r=spawnSync(env.binary.path,argv,{cwd:temp,encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:4*1024*1024,env:{...process.env,UNONE_LUAU_ANALYZER:env.analyzer.path}});
 assert.ok(!r.error,r.error?.message);assert.equal(r.status,0,r.stderr||r.stdout.slice(0,2000));const result=JSON.parse(r.stdout);assert.equal(result.ok,true);
 // Run JSON also contains verbose per-tick snapshots. Parse the complete bounded
 // response, retaining final state and its digest instead of duplicating snapshots.
 const observed=args[0]==='run'?{status:result.value.status,frames:result.value.frames,digest:result.value.observation_digest,observations:result.value.world.observations}:args[0]==='api'?{canonicalTypeBytes:Buffer.byteLength(result.value.typings)}:result;
 console.log(JSON.stringify({event:'command',label,argv:[env.binary.path,...argv],status:r.status,rawStdoutBytes:Buffer.byteLength(r.stdout),observed,stderr:r.stderr}));
 return result;
}
const canonical=cli('canonical types',['api','typings']).value.typings;
// project init normalizes the embedded type block to LF, while api typings
// returns the canonical CRLF document. Compare content after newline normalization.
const normalize=value=>value.replaceAll('\r\n','\n');
assert.ok(normalize(source).includes('-- BEGIN UNONE API TYPES\n'+normalize(canonical).trimEnd()+'\n-- END UNONE API TYPES'));
cli('official strict check',['check','--types']);
const result=cli('sealed author six ticks',['run','--frames','6','--seed','12345']);
const checked=verify(result);
await identity(env.binary);await identity(env.analyzer);
console.log(JSON.stringify({event:'task_result',complete:true,checked,temp,scope:'informed replay of fresh blind author inputs; CPU bounded small and4096x256 cost case, independent reviewed geometric/JSON oracle; no GPU timing, speedup or rendering claim'}));
