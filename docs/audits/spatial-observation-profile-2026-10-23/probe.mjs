// Inspected informed public SDK regression, all project inputs inline.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const env=JSON.parse(await readFile(resolve(here,'environment.json'),'utf8'));
const temp=await mkdtemp(resolve(tmpdir(),'unone-array-profile-public-'));
async function identity(file){const h=createHash('sha256');for await(const b of createReadStream(file.path))h.update(b);assert.equal(h.digest('hex'),file.sha256);assert.equal((await stat(file.path)).size,file.bytes);}
await identity(env.binary);await identity(env.analyzer);
function cli(label,args){
 const argv=['--sdk',env.sdk,...args,'--json'];
 const r=spawnSync(env.binary.path,argv,{cwd:temp,encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:180*1024,env:{...process.env,UNONE_LUAU_ANALYZER:env.analyzer.path}});
 console.log(JSON.stringify({event:'command',label,argv:[env.binary.path,...argv],status:r.status,error:r.error?.message,stdout:r.stdout,stderr:r.stderr}));
 assert.ok(!r.error,label);assert.equal(r.status,0,label);
 const result=JSON.parse(r.stdout);assert.equal(result.ok,true,label);return result.value;
}
const types=cli('canonical types',['api','typings']).typings;assert.equal(typeof types,'string');
const source=String.raw`
local shouldRead = READ_PROFILE
local shouldPublish = PUBLISH_PROFILE
local emptyIndex: number = 0
local workIndex: number = 0
local emptyTicket: number = 0
local noHitTicket: number = 0
local workTicket: number = 0
local phase = 0
local queries: {SpatialQuery} = {}
return {
 start=function(api: EngineApi)
  api.observation.set('stable','preserved')
  local invalid: {number} = {[2]=1}
  local accepted=pcall(function() api.observation.setArray('stable',invalid) end)
  assert(not accepted)
  local numbers: {number} = {1,2,3}
  local marked = api.observation.array(numbers)
  assert(marked==numbers)
  local n: number = marked[1]
  assert(n==1)
  api.observation.setArray('numbers',marked)
  table.clear(marked)
  api.observation.setArray('cleared',marked)
  api.observation.set('explicit_empty',api.observation.array(nil))
  api.observation.set('plain',{})
  emptyIndex=api.spatial.create({})
  local bodies: {SpatialBody} = {}
  for i=0,4095 do bodies[i+1]={id=i,position={i%64,math.floor(i/64),0},radius=0} end
  for i=0,127 do queries[i+1]={kind='nearest',point={i%64,math.floor(i/64),0},max_distance=1} end
  workIndex=api.spatial.create(api.spatial.pack(bodies))
 end,
 update=function(api: EngineApi, _dt: number)
  phase+=1
  if phase==1 then
   emptyTicket=api.spatial.submit(emptyIndex,{})
   noHitTicket=api.spatial.submit(emptyIndex,{{kind='nearest',point={0,0,0},max_distance=1}})
   workTicket=api.spatial.submit(workIndex,queries)
   local early,message=pcall(api.spatial.take,workTicket)
   assert(not early and string.find(tostring(message),'NEXT_TICK'))
   api.spatial.destroy(workIndex)
  elseif phase==2 then
   local empty=api.spatial.take(emptyTicket)
   local noHits=api.spatial.take(noHitTicket)
   local work=api.spatial.take(workTicket)
   assert(#empty.results==0 and #noHits.results[1].hits==0)
   assert(#work.results==128)
   for i,result in work.results do assert(#result.hits==1 and result.hits[1].id==i-1) end
   api.observation.set('empty_batch',empty)
   api.observation.set('no_hits',noHits)
   api.observation.set('geometry',{first=work.results[1],last=work.results[128],count=#work.results})
   local consumed,message=pcall(api.spatial.take,workTicket)
   assert(not consumed and string.find(tostring(message),'UNKNOWN'))
   if shouldRead then
    local profile: SpatialProfile=api.spatial.profile()
    assert(profile.backend=='cpu' and profile.totals.completed_batches==3)
    assert(profile.totals.queries==129 and profile.totals.bodies==4096)
    assert(profile.totals.pair_tests_upper_bound==524288 and profile.totals.returned_hits==128)
    assert(profile.last and profile.last.bodies==4096 and profile.last.queries==128)
    assert(profile.last.executor and profile.last.executor.total_ms>0)
    assert(profile.last.executor.phases_ms.cpu_execute and profile.last.executor.phases_ms.cpu_execute>0)
    assert(profile.last.executor.phases_ms.gpu_kernel==nil and profile.last.executor.gpu_kernel_unavailable_reason)
    assert(profile.totals.upload_bytes==0 and profile.totals.readback_bytes==0)
    if shouldPublish then api.observation.set('spatial_profile',profile) end
   end
   local position=api.entity.getPosition('unrelated')
   assert(position.x==123 and position.y==456)
   api.observation.set('complete',true)
  end
 end,
}
`;
async function project(name,read,publish){
 const dir=resolve(temp,name);await mkdir(dir);
 await writeFile(resolve(dir,'project.unone.json'),JSON.stringify({name:'generic-array-profile',entry_script:'main.luau',main_scene:'scene.json'}));
 await writeFile(resolve(dir,'scene.json'),JSON.stringify({entities:[{id:'unrelated',transform:{x:123,y:456}}]}));
 await writeFile(resolve(dir,'main.luau'),'--!strict\n'+types+'\n'+source.replace('READ_PROFILE',String(read)).replace('PUBLISH_PROFILE',String(publish)));
 return dir;
}
const measured=await project('measured',true,true);
cli('official strict check',['--project',measured,'check','--types']);
const result=cli('bounded measured workload',['--project',measured,'run','--frames','2','--seed','42']);
const o=result.world.observations;
assert.equal(o.complete,true);assert.equal(o.stable,'preserved');
assert.deepEqual(o.numbers,[1,2,3]);for(const field of ['cleared','explicit_empty'])assert.deepEqual(o[field],[]);
assert.deepEqual(o.plain,{});assert.deepEqual(o.empty_batch.results,[]);assert.deepEqual(o.no_hits.results[0].hits,[]);
assert.equal(o.geometry.first.hits[0].id,0);assert.equal(o.geometry.last.hits[0].id,127);
assert.ok(o.spatial_profile.last.executor.phases_ms.cpu_execute>0);
const control=await project('control',false,false),readOnly=await project('read-only',true,false);
const a=cli('digest control',['--project',control,'run','--frames','2','--seed','42']);
const b=cli('digest profile read only',['--project',readOnly,'run','--frames','2','--seed','42']);
assert.equal(typeof a.observation_digest,'string');assert.ok(a.observation_digest.length>0);assert.equal(a.observation_digest,b.observation_digest);
for(const query of ['spatial profile','效能定位','empty JSON array']){
 const match=cli('discovery: '+query,['api','search',query]);
 assert.ok(match.matches.length>0,query);
}
await identity(env.binary);await identity(env.analyzer);
console.log(JSON.stringify({event:'task_result',complete:true,workload:{bodies:4096,queries:128,pair_tests_upper_bound:524288},profile:o.spatial_profile,digest:a.observation_digest,temp,scope:'informed SDK CPU authoring/cost regression; profile-read digest equality excludes published wall diagnostics; no speedup/rendering claim'}));
