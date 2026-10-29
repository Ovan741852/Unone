// End-to-end Luau -> freshly built WASM -> real WebGPU -> Luau verification.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,relative,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url);
const args=process.argv.slice(2),runtime=resolve(root,args[0]??'artifacts/spatial-v1-runtime');
const manifest=JSON.parse(await readFile(resolve(runtime,'runtime.json'),'utf8'));
assert.ok(manifest.exports.includes('spatial_request'),'fresh spatial WASM ABI required');
async function verifyRuntimeFiles(){
 for(const [file,expected] of [[manifest.javascript,manifest.javascript_sha256],[manifest.wasm,manifest.wasm_sha256]]){
  assert.equal(typeof expected,'string','runtime hash required');
  assert.equal(createHash('sha256').update(await readFile(resolve(runtime,file))).digest('hex'),expected,'runtime changed: '+file);
 }
}
await verifyRuntimeFiles();
const runtimeURL='/'+relative(root,resolve(runtime,manifest.javascript)).replaceAll('\\','/');
assert.ok(!runtimeURL.includes('..'),'runtime must reside under the repository');
let chromium;
for(const candidate of [process.env.PLAYWRIGHT_MODULE,'C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright','playwright'].filter(Boolean)){
  try{({chromium}=require(candidate));break;}catch{}
}
assert.ok(chromium,'set PLAYWRIGHT_MODULE to an existing Playwright installation');
const script=`local index,pending,emptyIndex,emptyTicket,noHitTicket,workIndex,workTicket
local workQueries={}
return {
 start=function(api)
  emptyIndex=api.spatial.create({})
  local workBodies={}
  for i=0,4095 do workBodies[i+1]={id=i,position={i%64,math.floor(i/64),0},radius=0} end
  for i=0,127 do workQueries[i+1]={kind="nearest",point={i%64,math.floor(i/64),0},max_distance=1} end
  workIndex=api.spatial.create(workBodies)
  index=api.spatial.create(api.spatial.pack({
   {id=10,position={2,0,0},radius=.5,category=1},
   {id=20,position={8,0,0},radius=1,category=2},
   {id=4294967295,position={6,0,0},radius=0,category=8},
   {id=4294967294,position={3e-23,0,0},radius=0,category=16},
  }))
  api.observation.set("info",api.spatial.info())
 end,
 update=function(api,dt)
  if pending then
   local r=api.spatial.take(pending)
   assert(r.version==1 and r.results[1].hits[1].id==10)
   assert(r.results[2].hits[1].id==20)
   assert(r.results[3].hits[1].id==10)
   assert(r.results[4].hits[1].id==4294967295)
   assert(r.results[5].hits[1].id==4294967294)
   local normal=r.results[5].hits[1].normal
   assert(math.abs(normal[1]+1)<0.0001 and math.abs(normal[2])<0.0001 and math.abs(normal[3])<0.0001)
   api.observation.set("result",r)
   api.observation.set("empty_batch",api.spatial.take(emptyTicket))
   api.observation.set("no_hits",api.spatial.take(noHitTicket))
   local work=api.spatial.take(workTicket)
   assert(#work.results==128 and work.results[1].hits[1].id==0 and work.results[128].hits[1].id==127)
   api.observation.setArray("custom_empty")
   api.observation.set("plain_object",{})
   local profile=api.spatial.profile()
   assert(profile.totals.completed_batches==4 and profile.last.bodies==4096 and profile.last.queries==128)
   assert(profile.last.pair_tests_upper_bound==4096*128)
   assert(profile.last.executor and profile.last.executor.total_ms>=0)
   assert(profile.last.executor.phases_ms.gpu_kernel==nil and profile.last.executor.gpu_kernel_unavailable_reason)
   api.observation.set("profile",profile)
   api.observation.set("info",api.spatial.info())
   api.observation.set("nearest",r.results[1].hits[1].id)
   api.observation.set("overlap",r.results[2].hits[1].id)
   api.observation.set("sweep",r.results[3].hits[1].fraction)
   api.observation.set("backend",api.spatial.info().backend)
   pending=nil
  else
   local invalidUpdate=pcall(function()
    api.spatial.update(index,{{id=10,position={200,0,0},radius=-1}})
   end)
   assert(not invalidUpdate)
   local invalidDiagnostic=api.spatial.lastDiagnostic()
   assert(invalidDiagnostic and invalidDiagnostic.code=="SPATIAL_INPUT_INVALID")
   assert(invalidDiagnostic.operation=="spatial.update" and invalidDiagnostic.path=="bodies[1].radius")
   assert(invalidDiagnostic.actual==-1 and invalidDiagnostic.expected.finite==true)
   assert(invalidDiagnostic.expected.min==0 and invalidDiagnostic.expected.max==1000000)
   assert(invalidDiagnostic.context.index==index and invalidDiagnostic.context.frame==0)
   assert(invalidDiagnostic.recovery.retry=="after_correction" and invalidDiagnostic.recoverable and not invalidDiagnostic.terminal)
   api.observation.set("invalid_update",invalidDiagnostic)
   emptyTicket=api.spatial.submit(emptyIndex,{})
   noHitTicket=api.spatial.submit(emptyIndex,{{kind="nearest",point={0,0,0},max_distance=1}})
   pending=api.spatial.submit(index,{
    {kind="nearest",point={0,0,0},max_distance=100,mask=3},
    {kind="overlap_sphere",center={8,0,0},radius=.25,mask=2},
    {kind="sweep_sphere",from={0,0,0},to={4,0,0},radius=.5,mask=3},
    {kind="nearest",point={0,0,0},max_distance=100,mask=8},
    {kind="nearest",point={0,0,0},max_distance=1,mask=16},
   })
   workTicket=api.spatial.submit(workIndex,workQueries)
   assert(not pcall(function()api.spatial.take(pending)end))
   local earlyDiagnostic=api.spatial.lastDiagnostic()
   assert(earlyDiagnostic and earlyDiagnostic.code=="SPATIAL_RESULT_NEXT_TICK")
   assert(earlyDiagnostic.operation=="spatial.take" and earlyDiagnostic.recovery.retry=="next_tick")
   assert(earlyDiagnostic.context.ticket==pending and earlyDiagnostic.context.frame==0)
   assert(earlyDiagnostic.recoverable and not earlyDiagnostic.terminal)
   api.observation.set("early_take",earlyDiagnostic)
  end
 end,
}`;
const payload={config:{name:'generic-spatial-runtime',entry_script:'main.luau',systems:{physics2d:false,physics3d:false,ui:false,audio:false,particle:false,jobs:false}},scene:{entities:[]},script};
const server=http.createServer(async(req,res)=>{
 try{
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  if(pathname==='/__spatial_runtime__'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><title>Generic spatial runtime verification</title>');return;}
  const path=resolve(root,'.'+decodeURIComponent(pathname));
  if(relative(root,path).startsWith('..'))throw Error('path escape');
  res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.wgsl':'text/plain'})[extname(path)]??'application/octet-stream');
  res.end(await readFile(path));
 }catch{res.statusCode=404;res.end('not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({channel:process.env.UNONE_BROWSER_CHANNEL??'msedge',headless:true,args:['--enable-unsafe-webgpu']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
 await page.goto(`http://127.0.0.1:${server.address().port}/__spatial_runtime__`);
 const value=await page.evaluate(async({runtimeURL,payload})=>{
  const {createRuntimeCore,loadRuntime}=await import('/web/shared/runtime-core.mjs');
  const module=await loadRuntime(location.origin+runtimeURL),runs={};
  for(const mode of ['cpu','gpu']){
   const core=createRuntimeCore(module,{spatialBackend:mode});
   try{
    await core.execute({kind:'load',payload,seed:'42'});
    const first=await core.execute({kind:'tick',input:{}});
    if(first.world.frame!==1||first.world.observations.nearest!==undefined)throw Error('early query delivery');
    const second=await core.execute({kind:'tick',input:{}});
    runs[mode]={frame:second.world.frame,observations:second.world.observations,report:core.report().spatial};
   }finally{core.close();}
  }
  const {createRuntimeBackend}=await import('/web/shared/runtime-backend.mjs');
  for(const mode of ['cpu','gpu']){
   const backend=await createRuntimeBackend({kind:'worker',url:location.origin+runtimeURL,spatialBackend:mode});
   try{
    await backend.request({kind:'load',payload,seed:'42'});
    const first=await backend.request({kind:'tick',input:{}});
    if(first.world.frame!==1||first.world.observations.nearest!==undefined)throw Error('early worker query delivery');
    const second=await backend.request({kind:'tick',input:{}});
    runs['worker_'+mode]={frame:second.world.frame,observations:second.world.observations,report:backend.report().jobs.spatial};
   }finally{backend.close();}
  }
  return runs;
 },{runtimeURL,payload});
 assert.equal(value.cpu.frame,2);assert.equal(value.gpu.frame,2);
 assert.equal(value.cpu.observations.backend,'cpu');assert.equal(value.gpu.observations.backend,'webgpu');
 for(const key of ['nearest','overlap','sweep'])assert.equal(value.cpu.observations[key],value.gpu.observations[key]);
 for(const mode of ['cpu','gpu']){
  assert.equal(value[mode].observations.info.limits.safe_integer,9007199254740991);
  assert.equal(value[mode].observations.result.results[3].hits[0].id,4294967295);
 }
 assert.equal(value.gpu.report.backend,'webgpu');assert.deepEqual(errors,[]);
 for(const mode of ['cpu','gpu']){
  const worker=value['worker_'+mode];
  assert.equal(worker.frame,2);
  const {profile:workerProfile,...workerGeometry}=worker.observations;
  const {profile:mainProfile,...mainGeometry}=value[mode].observations;
  assert.deepEqual(workerGeometry,mainGeometry);
  assert.equal(workerProfile.backend,mainProfile.backend);
  assert.equal(worker.report.backend,value[mode].report.backend);
 }
 for(const [mode,run] of Object.entries(value)){
  const o=run.observations,p=o.profile;
  const gpu=mode.includes('gpu');
  assert.deepEqual(o.empty_batch.results,[]);assert.deepEqual(o.no_hits.results[0].hits,[]);
  assert.deepEqual(o.custom_empty,[]);assert.deepEqual(o.plain_object,{});
  assert.equal(o.result.version,1,'a rejected update must preserve the index version and geometry');
  assert.equal(o.invalid_update.code,'SPATIAL_INPUT_INVALID');
  assert.equal(o.invalid_update.operation,'spatial.update');assert.equal(o.invalid_update.path,'bodies[1].radius');
  assert.equal(o.invalid_update.actual,-1);assert.deepEqual(o.invalid_update.expected,{finite:true,min:0,max:1000000});
  assert.equal(o.invalid_update.recovery.retry,'after_correction');
  assert.deepEqual(o.invalid_update.context,{frame:0,index:3});
  assert.equal(o.invalid_update.recoverable,true);assert.equal(o.invalid_update.terminal,false);
  assert.equal(o.early_take.code,'SPATIAL_RESULT_NEXT_TICK');assert.equal(o.early_take.operation,'spatial.take');
  assert.equal(o.early_take.recovery.retry,'next_tick');assert.deepEqual(o.early_take.context,{frame:0,ticket:6});
  assert.equal(o.early_take.recoverable,true);assert.equal(o.early_take.terminal,false);
  assert.equal(p.totals.completed_batches,4);assert.equal(p.last.bodies,4096);assert.equal(p.last.queries,128);
  assert.equal(p.last.pair_tests_upper_bound,524288);
  assert.ok(Number.isFinite(p.last.executor.total_ms)&&p.last.executor.total_ms>0);
  assert.equal(p.last.executor.phases_ms.gpu_kernel,undefined);
  assert.equal(typeof p.last.executor.gpu_kernel_unavailable_reason,'string');
  const binding=p.bindings;
  assert.equal(binding.clock,'host_monotonic');assert.equal(binding.calls,gpu?10:14);
  assert.equal(binding.failed_calls,2);assert.equal(binding.last.operation,'spatial.take');
  assert.equal(binding.last.success,true);assert.equal(binding.last.ticket,7);
  for(const measured of [binding,binding.last])for(const phase of ['input_decode_ms','output_encode_ms']){
   assert.ok(Number.isFinite(measured[phase])&&measured[phase]>=0,`${mode}: ${phase}`);
  }
  const metrics=run.report.metrics;
  assert.equal(metrics.api_version,1);assert.equal(metrics.clock,'host_monotonic');
  assert.equal(metrics.setup.success,true);assert.equal(metrics.setup.gpu_initialized,gpu);
  for(const phase of ['total_ms','executor_create_ms','configure_ms']){
   assert.ok(Number.isFinite(metrics.setup[phase])&&metrics.setup[phase]>=0,`${mode}: setup ${phase}`);
  }
  assert.ok(metrics.setup.total_ms>=metrics.setup.executor_create_ms&&metrics.setup.total_ms>=metrics.setup.configure_ms);
  const {totals,by_kind}=metrics.bridge,byteFields=['request_bytes','response_bytes'];
  const countFields=['requests','failed_requests',...byteFields],phaseFields=['json_encode_ms','copy_in_ms','abi_ms','response_decode_ms'];
  for(const sample of [totals,...Object.values(by_kind)]){
   for(const count of countFields)assert.ok(Number.isSafeInteger(sample[count])&&sample[count]>=0,`${mode}: bridge ${count}`);
   for(const phase of phaseFields)assert.ok(Number.isFinite(sample[phase])&&sample[phase]>=0,`${mode}: bridge ${phase}`);
  }
  for(const field of countFields)assert.equal(totals[field],Object.values(by_kind).reduce((sum,sample)=>sum+sample[field],0),`${mode}: exact bridge ${field} sum`);
  for(const phase of phaseFields)assert.ok(Math.abs(totals[phase]-Object.values(by_kind).reduce((sum,sample)=>sum+sample[phase],0))<0.000001,`${mode}: bridge ${phase} sum`);
  assert.equal(totals.failed_requests,0);
  if(gpu){
   assert.deepEqual(Object.keys(by_kind).sort(),['complete','configure','drain']);
   assert.equal(totals.requests,7);assert.equal(by_kind.configure.requests,1);
   assert.equal(by_kind.drain.requests,2);assert.equal(by_kind.complete.requests,4);
   const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
   assert.equal(by_kind.configure.request_bytes,bytes({kind:'configure',backend:'webgpu'}));
   assert.equal(by_kind.drain.request_bytes,2*bytes({kind:'drain'}));
   // Configure returns the raw runtime report, while completion returns null.
   // Lua republishes floats/nil with different JSON spelling, so its observed
   // info record is not an exact byte oracle for the raw configure response.
   assert.ok(by_kind.configure.response_bytes>bytes(null));
   assert.equal(by_kind.complete.response_bytes,4*bytes(null));
   assert.ok(by_kind.complete.request_bytes>0&&by_kind.drain.response_bytes>0);
   assert.ok(p.totals.upload_bytes>0&&p.totals.readback_bytes>0);
   for(const phase of ['preparation','queue_wait','validation','packing','upload','encode_submit','readback_wait','decode'])assert.ok(Number.isFinite(p.last.executor.phases_ms[phase])&&p.last.executor.phases_ms[phase]>=0,phase);
  }else{
   assert.equal(metrics.setup.executor_create_ms,0);assert.equal(metrics.setup.configure_ms,0);
   assert.deepEqual(by_kind,{});for(const field of [...countFields,...phaseFields])assert.equal(totals[field],0);
   assert.ok(p.last.executor.phases_ms.cpu_execute>0);
  }
 }
 const report={ok:true,browser:browser.version(),runtime:relative(root,runtime),runs:value,errors};
 await verifyRuntimeFiles();
 await mkdir(resolve(root,'.cache'),{recursive:true});
 await writeFile(resolve(root,args[1]??'.cache/spatial-runtime-report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
