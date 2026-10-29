// Informed replay of the sealed author's headless fixture. It does not mutate
// the blind directory or execute commands/scripts stored in the trial ledger.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
const here=dirname(fileURLToPath(import.meta.url));
const env=JSON.parse(await readFile(resolve(here,'environment.json'),'utf8'));
async function identity(){const h=createHash('sha256');for await(const b of createReadStream(env.binary.path))h.update(b);assert.equal(h.digest('hex'),env.binary.sha256);}
await identity();
const project=await mkdtemp(resolve(tmpdir(),'unone-spatial-blind-replay-'));
for(const path of ['project.unone.json','scenes/main.scene.json','scripts/main.luau']){
 const target=resolve(project,path);await mkdir(dirname(target),{recursive:true});
 await writeFile(target,await readFile(resolve(here,'blind/scout-sdk-blind-v2/final-project',path)));
}
function cli(label,args){
 const argv=['--sdk',env.sdk,'--project',project,'--json',...args];
 const r=spawnSync(env.binary.path,argv,{cwd:project,encoding:'utf8',windowsHide:true,timeout:12000,maxBuffer:140*1024,env:{...process.env,UNONE_LUAU_ANALYZER:env.analyzer.path}});
 console.log(JSON.stringify({event:'command',label,argv:[env.binary.path,...argv],status:r.status,error:r.error?.message,stdout:r.stdout,stderr:r.stderr}));
 assert.ok(!r.error);assert.equal(r.status,0,label);
 const result=JSON.parse(r.stdout);assert.equal(result.ok,true);return result.value;
}
const strict=cli('strict blind fixture replay',['check','--types']);
assert.equal(strict.type_check.passed,true);
const first=cli('first frame',['run','--frames','1','--seed','42']);
const second=cli('second frame',['run','--frames','2','--seed','42']);
const one=first.world.observations,two=second.world.observations;
assert.equal(one.frozen_batch,undefined);
assert.equal(first.world.spatial.tickets.length,2);
assert.equal(two.verification.passed,true);
assert.equal(two.frozen_batch.version,1);assert.equal(two.replacement_batch.version,2);
const r=two.frozen_batch.results;
assert.deepEqual(r.map(q=>q.hits.map(h=>h.id)),[[41],[17,41,4294967295],[73],[0]]);
// Independent scalar oracle for this collinear moving pair: 10t=12-4t-1.
const contact=11/14,hit=r[2].hits[0];
assert.ok(Math.abs(hit.fraction-contact)<2e-5);
assert.ok(Math.abs(hit.distance-10*contact)<2e-5);
assert.ok(Math.abs(hit.point[0]-(12-4*contact-.5))<2e-5);
assert.deepEqual(hit.normal,[-1,0,0]);
assert.equal(r[0].hits[0].distance,3);
assert.equal(two.spatial_info_complete.limits.safe_integer,9007199254740991);
assert.equal(two.spatial_info_complete.tickets,0);
assert.match(one.invalid_replacement.error,/duplicate body ID 9/);
assert.match(one.next_tick_boundary.error,/SPATIAL_RESULT_NEXT_TICK/);
assert.match(two.consumption_boundary.error,/SPATIAL_TICKET_UNKNOWN/);
assert.deepEqual(first.world.entities.unrelated,second.world.entities.unrelated);
assert.deepEqual(second.world.entities.unrelated.transform,{x:-23,y:47});
const emptyShapes=two.replacement_batch.results.map(q=>JSON.stringify(q.hits));
assert.ok(emptyShapes.every(s=>s==='{}'||s==='[]'));
await identity();
console.log(JSON.stringify({event:'task_result',complete:true,project,strict:true,ids:r.map(q=>q.hits.map(h=>h.id)),fraction:hit.fraction,analytic:contact,emptyShapes,limitation:'An empty Lua table loses array identity in generic observation JSON. This replay is informed, not a new blind author trial; it copies only the three headless inputs.'}));
