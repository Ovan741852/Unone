// Public SDK CPU benchmark. Uses a new synthetic temp project, no game inputs.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {performance} from 'node:perf_hooks';
const options={bodies:4096,queries:128,warmup:3,samples:9};
const usage='Usage: node benchmark-spatial.mjs --sdk <SDK> [--bodies 4096 --queries 128 --warmup 3 --samples 9 --output <new.json> --analyzer <luau-analyze>]';
if(process.argv.includes('--help')){console.log(usage);process.exit(0);}
for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i]?.slice(2),value=process.argv[i+1];if(!['sdk','bodies','queries','warmup','samples','output','analyzer'].includes(key)||value===undefined)throw Error(usage);options[key]=['bodies','queries','warmup','samples'].includes(key)?Number(value):value;}
assert.ok(options.sdk,'--sdk required');for(const [key,min,max]of [['bodies',1,65536],['queries',1,1024],['warmup',0,20],['samples',3,31]])assert.ok(Number.isInteger(options[key])&&options[key]>=min&&options[key]<=max,key+' out of range');
const sdk=resolve(options.sdk),manifest=JSON.parse(await readFile(join(sdk,'sdk.json'),'utf8'));
assert.ok(['bin/game.exe','bin/game'].includes(manifest.cli),'supported local SDK CLI required');
const binary=resolve(sdk,manifest.cli);
const identity=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
const binaryHash=await identity(binary);assert.equal(binaryHash,manifest.files.find(f=>f.path===manifest.cli)?.sha256);
const temp=await mkdtemp(join(tmpdir(),'unone-spatial-benchmark-'));
function cli(args){const r=spawnSync(binary,['--sdk',sdk,'--project',temp,...args,'--json'],{cwd:temp,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:8*1024*1024,env:{...process.env,...(options.analyzer?{UNONE_LUAU_ANALYZER:resolve(options.analyzer)}:{})}});assert.ok(!r.error,r.error?.message);assert.equal(r.status,0,r.stderr||r.stdout.slice(0,3000));const v=JSON.parse(r.stdout);assert.equal(v.ok,true);return v.value;}
const types=cli(['api','typings']).typings;
const source=`
type Sample = {batch: SpatialProfileBatch, submit_boundary: SpatialBindingSample, take_boundary: SpatialBindingSample, [string]: ObservationValue}
local index=0
local ticket=0
local tick=0
local occurrence=0
local samples: {Sample}={}
local queries: {SpatialQuery}={}
local submitBoundary: SpatialBindingSample?=nil
return {
 start=function(api: EngineApi)
  local bodies: {SpatialBody}={}
  for i=1,${options.bodies} do bodies[i]={id=i,position={(i-1)%256,math.floor((i-1)/256),0},radius=0} end
  for i=1,${options.queries} do local j=(i-1)%${options.bodies};local q: SpatialNearestQuery={kind='nearest',point={j%256,math.floor(j/256),0},max_distance=0};queries[i]=q end
  index=api.spatial.create(bodies)
 end,
 update=function(api: EngineApi,_dt: number)
  tick+=1
  if tick%2==1 then
   ticket=api.spatial.submit(index,queries)
   submitBoundary=api.spatial.profile().bindings.last
  else
   local result=api.spatial.take(ticket)
   for i,r in result.results do assert(#r.hits==1 and r.hits[1].id==(i-1)%${options.bodies}+1) end
   local p=api.spatial.profile();local batch=p.last;local takeBoundary=p.bindings.last;local input=submitBoundary
   assert(batch and takeBoundary and input)
   occurrence+=1
   if occurrence>${options.warmup} then local sample: Sample={batch=batch,submit_boundary=input,take_boundary=takeBoundary};table.insert(samples,sample) end
   if occurrence==${options.warmup+options.samples} then api.spatial.destroy(index);api.observation.setArray('samples',samples);api.observation.set('profile',api.spatial.profile()) end
  end
 end,
}
`;
await writeFile(join(temp,'project.unone.json'),JSON.stringify({name:'Generic spatial benchmark',entry_script:'main.luau',systems:{physics2d:false,physics3d:false,ui:false,audio:false,save:false,jobs:false,random:false,particle:false,effekseer:false,spine:false,camera2d:false,camera3d:false}}));
await writeFile(join(temp,'main.luau'),'--!strict\n'+types+'\n'+source);
cli(['check','--types']);
const started=performance.now();const result=cli(['run','--frames',String(2*(options.warmup+options.samples)),'--seed','42']);const processTotal=performance.now()-started;
const samples=result.world.observations.samples;assert.ok(Array.isArray(samples));assert.equal(samples.length,options.samples);
function distribution(values){const sorted=[...values].sort((a,b)=>a-b);assert.ok(sorted.length>0&&sorted.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0));return {samples:sorted.length,min:sorted[0],p50:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1),mean:sorted.reduce((s,v)=>s+v,0)/sorted.length};}
const summary={executor_ms:distribution(samples.map(s=>s.batch.executor.total_ms)),input_decode_ms:distribution(samples.map(s=>s.submit_boundary.input_decode_ms+s.take_boundary.input_decode_ms)),output_encode_ms:distribution(samples.map(s=>s.submit_boundary.output_encode_ms+s.take_boundary.output_encode_ms)),manager_ms:Object.fromEntries(['snapshot','validation','result_validation','result_apply'].map(k=>[k,distribution(samples.map(s=>s.batch.manager_ms[k]))]))};
assert.equal(await identity(binary),binaryHash);
const report={schema:'unone.spatial.benchmark.v1',ok:true,backend:'cpu',clock:'host_monotonic',configuration:{bodies:options.bodies,queries:options.queries,warmup:options.warmup,samples:options.samples},summary,process_total_ms:processTotal,identity:{sdk,binary_sha256:binaryHash,node:process.version,platform:process.platform,arch:process.arch},samples,profile:result.world.observations.profile,limitations:['Nearest-rank quantiles from bounded samples in one process; warmups excluded from per-batch distributions, included in process_total_ms.','process_total_ms includes CLI process, project/VM startup, all ticks, final observation serialization and parsing; it is not per-batch latency or GPU time.','Manager/executor/binding phases have separate scopes; do not sum nested phases. No rendering, gameplay, cross-device determinism, GPU speedup or automatic crossover claim.'],temp};
if(options.output)await writeFile(resolve(options.output),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report,null,2));
