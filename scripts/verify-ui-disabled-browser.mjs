// Smoke an actual exported official production player with UI disabled through multiple
// 30-draw diagnostics publications. This is module/lifecycle acceptance, not an FPS benchmark.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {createRequire} from 'node:module';
const root=resolve(process.argv[2]??''),out=resolve(process.argv[3]??'.cache/ui-disabled-browser.json');
if(!process.argv[2])throw Error('Provide an isolated UI-disabled Web export directory');
const require=createRequire(import.meta.url);let chromium;
for(const name of [process.env.PLAYWRIGHT_MODULE,'C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright','playwright'].filter(Boolean))try{({chromium}=require(name));break;}catch{}
if(!chromium)throw Error('Use an existing Playwright runtime');
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const path=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!path.startsWith(root+sep))throw Error('Path outside export');
 const bytes=await readFile(path);res.writeHead(200,{'content-type':mime[extname(path)]??'application/octet-stream'});res.end(bytes);
}catch(error){res.writeHead(404);res.end(error.message);}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));let browser;
try{
 browser=await chromium.launch({...process.env.UNONE_BROWSER_PATH?{executablePath:process.env.UNONE_BROWSER_PATH}:{channel:process.env.BROWSER_CHANNEL??'msedge'},headless:true});
 const context=await browser.newContext({viewport:{width:640,height:360}}),page=await context.newPage(),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>requests.push(new URL(r.url()).pathname));
 await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.dataset.playerError||Number(document.body.dataset.playerFrame)>=90,{},{timeout:30000});
 const result=await page.evaluate(async()=>({frame:Number(document.body.dataset.playerFrame),error:document.body.dataset.playerError??null,
  metrics:JSON.parse(document.body.dataset.playerPerformance??'null'),boot:JSON.parse(document.body.dataset.playerMetrics??'null'),
  uiEnabled:(await fetch(new URL('content/project.json',document.baseURI)).then(r=>r.json())).config.systems.ui}));
 const uiRequests=requests.filter(path=>/\/(?:ui-[^/]+\.mjs|canvas-ui\.mjs)$/.test(path));
 const report={scope:'Real official production Web export with UI/particles disabled, fresh context,90ticks and repeated30-draw metrics; no FPS or global memory claim.',root,...result,errors,uiRequests,browser:await browser.version()};
 await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({frame:result.frame,error:result.error,uiEnabled:result.uiEnabled,ui:result.metrics?.ui,particle_pool:result.metrics?.particle_pool,errors,uiRequests,report:out},null,2));
 assert.equal(result.uiEnabled,false);assert.equal(result.error,null);assert(result.frame>=90);assert.equal(result.metrics.ui.backend,'disabled');
 assert.equal(result.metrics.particle_pool.capacity,0);assert.deepEqual(errors,[]);assert.deepEqual(uiRequests,[]);
}finally{await browser?.close();await new Promise(done=>server.close(done));}
