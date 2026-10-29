// Informed public CLI regression. Inputs are inline or declared in environment.json.
// Retains synthetic OS-temp projects; never touches an existing game.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const env=JSON.parse(await readFile(resolve(here,'environment.json'),'utf8'));
const directory=await mkdtemp(resolve(tmpdir(),'unone-spatial-p2-public-'));
function emit(value){process.stdout.write(JSON.stringify(value)+'\n');}
async function identity(path){
 const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);
 return {path,bytes:(await stat(path)).size,sha256:h.digest('hex')};
}
async function identities(){
 assert.deepEqual(await identity(env.binary.path),env.binary);
 assert.deepEqual(await identity(env.analyzer.path),env.analyzer);
}
function cli(label,args){
 const argv=['--sdk',env.sdk,...args,'--json'];
 const r=spawnSync(env.binary.path,argv,{cwd:directory,encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:150*1024,env:{...process.env,UNONE_LUAU_ANALYZER:env.analyzer.path}});
 emit({event:'command',label,argv:[env.binary.path,...argv],status:r.status,error:r.error?.message,stdout:r.stdout,stderr:r.stderr});
 assert.ok(!r.error,label);assert.equal(r.status,0,label);
 const parsed=JSON.parse(r.stdout);assert.equal(parsed.ok,true,label);return parsed.value;
}
await identities();
const types=cli('canonical types',['api','typings']).typings;
assert.equal(typeof types,'string');
const source=`--!strict\n${types}\n
local index: number = 0
local ticket: number? = nil
local tick = 0
return {
 start=function(api: EngineApi)
  api.observation.set('info',api.spatial.info())
  index=api.spatial.create(api.spatial.pack({
   {id=4294967295,position={2,0,0},radius=0,category=1},
   {id=10,position={3e-23,0,0},radius=0,category=2},
  }))
 end,
 update=function(api: EngineApi, _dt: number)
  tick += 1
  if tick==1 then
   local accepted,message=pcall(api.spatial.update,index,{{id=1,position={0,0,0},radius=-1}})
   assert(not accepted and string.find(tostring(message),'radius'))
   api.observation.set('validation',tostring(message))
   assert(api.spatial.update(index,{
    {id=4294967295,position={2,0,0},radius=0,category=1},
    {id=10,position={3e-23,0,0},radius=0,category=2},
   })==2)
   local nextTicket=api.spatial.submit(index,{
    {kind='nearest',point={0,0,0},max_distance=10,mask=1},
    {kind='nearest',point={0,0,0},max_distance=1,mask=2},
   })
   ticket=nextTicket
   local early,message=pcall(api.spatial.take,nextTicket)
   assert(not early and string.find(tostring(message),'NEXT_TICK'))
   api.spatial.destroy(index)
  elseif tick==2 then
   assert(ticket)
   local result: SpatialBatchResult=api.spatial.take(ticket)
   assert(result.version==2 and result.results[1].hits[1].id==4294967295)
   local normal=result.results[2].hits[1].normal
   assert(math.abs(normal[1]+1)<0.0001 and math.abs(normal[2])<0.0001 and math.abs(normal[3])<0.0001)
   api.observation.set('result',result)
   api.observation.set('query',result.results[1])
   api.observation.set('hit',result.results[1].hits[1])
   local consumed,message=pcall(api.spatial.take,ticket)
   assert(not consumed and string.find(tostring(message),'UNKNOWN'))
   api.observation.set('complete',true)
  end
 end,
}
`;
await mkdir(resolve(directory,'fixture'));
const project=resolve(directory,'fixture');
await writeFile(resolve(project,'project.unone.json'),JSON.stringify({name:'generic-spatial-p2',entry_script:'main.luau',main_scene:'scene.json'}));
await writeFile(resolve(project,'scene.json'),JSON.stringify({entities:[{id:'unrelated',name:'Synthetic boundary',transform:{x:123,y:456}}]}));
await writeFile(resolve(project,'main.luau'),source);
emit({event:'fixture',project,sourceSha256:createHash('sha256').update(source).digest('hex'),inputs:'inline, with current public canonical types'});
cli('strict check',['--project',project,'check','--types']);
const first=cli('first deterministic run',['--project',project,'run','--frames','2','--seed','42']);
const second=cli('second deterministic run',['--project',project,'run','--frames','2','--seed','42']);
assert.equal(typeof first.observation_digest,'string');
assert.ok(first.observation_digest.length>0);
assert.equal(first.observation_digest,second.observation_digest);
const observation=first.world.observations;
assert.equal(observation.complete,true);
assert.equal(observation.info.limits.safe_integer,9007199254740991);
assert.equal(observation.result.results[0].hits[0].id,4294967295);
assert.equal(observation.result.version,2);
assert.deepEqual(observation.hit,observation.query.hits[0]);
assert.equal(first.world.entities.find(e=>e.id==='unrelated').transform.x,123);
for(const query of ['batch collision','GPU collision','空間查詢','批次碰撞查詢']){
 const result=cli('discovery: '+query,['api','search',query]);
 assert.ok(JSON.stringify(result).includes('spatial.'),query);
}
await identities();
emit({event:'task_result',complete:true,checks:['strict types without adapters','full info numeric publication','full result and individual records','u32 ID','3e-23 geometry','invalid radius and repair','next tick and consumed ticket','destroyed frozen snapshot','same-seed digest','unrelated entity','collision and Chinese discovery'],project,digest:first.observation_digest,scope:'informed public SDK CLI CPU regression; no blind or GPU assertion'});
