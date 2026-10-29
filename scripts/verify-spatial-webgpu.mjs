// Actual browser WebGPU dispatch against the Rust CPU reference; generic geometry only.
// Requires an existing Playwright/browser and Rust toolchain. No installs or games.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir,writeFile,access} from 'node:fs/promises';
import {resolve,dirname,extname,delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url);
let chromium;for(const candidate of [process.env.PLAYWRIGHT_MODULE,'C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright','playwright'].filter(Boolean)){try{({chromium}=require(candidate));break;}catch{}}
if(!chromium)throw Error('Use an existing Playwright runtime via PLAYWRIGHT_MODULE');
const env={...process.env};let cargo=process.env.UNONE_CARGO??'cargo';
const localCargo=resolve(root,'.toolcache/cargo/bin/cargo.exe');
try{await access(localCargo);if(!process.env.UNONE_CARGO){cargo=localCargo;env.CARGO_HOME??=resolve(root,'.toolcache/cargo');env.RUSTUP_HOME??=resolve(root,'.toolcache/rustup');env.PATH=[resolve(root,'.toolcache/cargo/bin'),resolve(root,'.toolcache/w64devkit/bin'),env.PATH].join(delimiter);env.LIBRARY_PATH??=resolve(root,'.toolcache/rustup/toolchains/1.95.0-x86_64-pc-windows-gnu/lib/rustlib/x86_64-pc-windows-gnu/lib/self-contained');}}catch{}
const reference=spawnSync(cargo,['run','--quiet','--manifest-path','crates/unone-spatial-gpu/Cargo.toml','--example','browser_fixtures'],{cwd:root,env,encoding:'utf8',maxBuffer:32*1024*1024});
if(reference.error||reference.status!==0)throw Error(`CPU reference fixture build failed: ${reference.error??reference.stderr}`);
const fixtures=JSON.parse(reference.stdout);
const html=`<!doctype html><meta charset="utf-8"><title>UNONE generic spatial WebGPU verification</title><script type="module">
import {createSpatialGpuExecutor} from '/web/shared/spatial-gpu.mjs';
window.run=async fixtures=>{
 const errors=[],cases=[];let executor;
 const verifyProfile=(profile,batch)=>{if(profile?.clock!=='host_monotonic'||!Number.isFinite(profile.total_ms)||profile.total_ms<0)throw Error('missing spatial host profile');for(const name of ['preparation','queue_wait','validation','packing','upload','encode_submit','readback_wait','decode'])if(!Number.isFinite(profile.phases_ms[name])||profile.phases_ms[name]<0)throw Error('invalid spatial profile phase '+name);if(profile.phases_ms.preparation<profile.phases_ms.validation||profile.total_ms<profile.phases_ms.preparation)throw Error('nested spatial preparation timing');if(profile.phases_ms.gpu_kernel!==null||profile.phases_ms.cpu_execute!==null||!profile.gpu_kernel_unavailable_reason)throw Error('host wait must not be reported as GPU kernel time');if(profile.upload_bytes!==(batch.queries.length?Math.max(1,batch.bodies.length)*48+batch.queries.length*64+16:0)||profile.readback_bytes!==batch.queries.length*772*4)throw Error('spatial profile transfer sizes');};
 const compare=(expected,actual,label)=>{if(expected.version!==actual.version||expected.results.length!==actual.results.length)throw Error(label+' result envelope');for(let i=0;i<expected.results.length;i++){const a=expected.results[i].hits,b=actual.results[i].hits;if(a.length!==b.length)throw Error(label+' query '+i+' hit count');for(let j=0;j<a.length;j++){if(a[j].id!==b[j].id)throw Error(label+' query '+i+' selected ID');const left=[a[j].distance,a[j].fraction,...a[j].point,...a[j].normal],right=[b[j].distance,b[j].fraction,...b[j].point,...b[j].normal];for(let n=0;n<left.length;n++)if(!Number.isFinite(right[n])||Math.abs(left[n]-right[n])>0.0001*(1+Math.abs(left[n])))throw Error(label+' query '+i+' numeric '+left[n]+' != '+right[n]);}}};
 try{
  if(!navigator.gpu)throw Error('real browser WebGPU unavailable');
  const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('real browser GPU adapter unavailable');
  const device=await adapter.requestDevice();device.addEventListener('uncapturederror',event=>errors.push(String(event.error)));
  try{
   executor=await createSpatialGpuExecutor({device});
   for(const fixture of fixtures){let result,error,profile=null;const started=performance.now();try{result=await executor.execute(fixture.batch);}catch(caught){error=String(caught);}if(fixture.error){if(!error||!error.includes('64'))throw Error(fixture.name+' must fail explicitly on overlap overflow');}else{if(error)throw Error(fixture.name+': '+error);compare(fixture.expected,result,fixture.name);profile=executor.profile();verifyProfile(profile,fixture.batch);}cases.push({name:fixture.name,queries:fixture.batch.queries.length,bodies:fixture.batch.bodies.length,duration_ms:performance.now()-started,expected_error:!!fixture.error,profile});}
   const mutable=structuredClone(fixtures[0].batch),snapshotResult=executor.execute(mutable);mutable.bodies.length=0;compare(fixtures[0].expected,await snapshotResult,'queued snapshot ownership');
   for(const batch of [{version:1,bodies:[{id:1,position:[NaN,0,0],radius:0}],queries:[]},{version:1,bodies:[],queries:[{kind:'nearest',point:[0,0,0],max_distance:-1}]},{version:1,bodies:[{id:1,position:[0,0,0],radius:0},{id:1,position:[0,0,0],radius:0}],queries:[]}]){let rejected=false;try{await executor.execute(batch);}catch{rejected=true;}if(!rejected)throw Error('invalid public batch accepted');}
   executor.close();let closedRejected=false;try{await executor.execute({version:1,bodies:[],queries:[]});}catch{closedRejected=true;}if(!closedRejected)throw Error('closed executor accepted work');
   // Closing an injected executor must preserve its host-owned device.
   const stillOwned=device.createBuffer({size:4,usage:GPUBufferUsage.COPY_DST});stillOwned.destroy();
   const owned=await createSpatialGpuExecutor();try{compare(fixtures[0].expected,await owned.execute(fixtures[0].batch),'owned device');}finally{owned.close();}
   const lostExecutor=await createSpatialGpuExecutor({device});device.destroy();await device.lost;let lostRejected=false;try{await lostExecutor.execute(fixtures[0].batch);}catch(error){lostRejected=String(error).includes('lost');}finally{lostExecutor.close();}if(!lostRejected)throw Error('lost GPU device was not reported explicitly');
   return {ok:true,cases,adapter:{vendor:adapter.info?.vendor,architecture:adapter.info?.architecture,device:adapter.info?.device,description:adapter.info?.description},executor:executor.describe(),owned_executor:owned.describe(),gpu_errors:errors};
  }finally{executor?.close();device.destroy();}
 }catch(error){return {ok:false,error:String(error.stack??error),cases,gpu_errors:errors};}
};
</script>`;
const allowed=new Map([['/web/shared/spatial-gpu.mjs',resolve(root,'web/shared/spatial-gpu.mjs')],['/web/shared/spatial.wgsl',resolve(root,'web/shared/spatial.wgsl')]]);
const server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/'){res.writeHead(200,{'content-type':'text/html'});res.end(html);return;}if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}const path=allowed.get(pathname);if(!path){res.writeHead(404);res.end();return;}res.writeHead(200,{'content-type':extname(path)==='.mjs'?'text/javascript':'text/plain'});res.end(await readFile(path));}catch(error){res.writeHead(500);res.end(error.message);}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));let browser;
try{
 browser=await chromium.launch({...(process.env.UNONE_BROWSER_PATH?{executablePath:process.env.UNONE_BROWSER_PATH}:{channel:process.env.BROWSER_CHANNEL??'msedge'}),headless:true});
 const page=await browser.newPage(),browserErrors=[];page.on('pageerror',error=>browserErrors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.waitForFunction(()=>typeof window.run==='function');
 const report=await page.evaluate(fixtures=>window.run(fixtures),fixtures);report.browserErrors=browserErrors;report.browser=await browser.version();
 const reportPath=resolve(root,process.argv[2]??'.cache/spatial-webgpu-report.json');await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2));
 assert.equal(report.ok,true,report.error);assert.deepEqual(browserErrors,[]);assert.deepEqual(report.gpu_errors,[]);
 console.log(JSON.stringify({...report,report:reportPath},null,2));
}finally{await browser?.close();await new Promise(done=>server.close(done));}
