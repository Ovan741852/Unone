const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root='D:/Projects/YesSir/_Games/ashen-legion/dist/web';
const output=__dirname;
const delayMs=Number(process.argv[2]||0);
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.css':'text/css','.glb':'model/gltf-binary'};
let requests=[];
const server=http.createServer(async(req,res)=>{
 const rel=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')||'index.html';
 const filename=path.resolve(root,rel);if(!filename.startsWith(path.resolve(root)+path.sep)){res.writeHead(403).end();return;}
 const entry={path:rel,received:performance.now(),bytes:0};requests.push(entry);
 try{const bytes=await fs.readFile(filename);entry.bytes=bytes.length;if(delayMs)await new Promise(r=>setTimeout(r,delayMs));res.writeHead(200,{'content-type':mime[path.extname(filename)]||'application/octet-stream','cache-control':'no-store','cross-origin-opener-policy':'same-origin','cross-origin-embedder-policy':'require-corp'});res.end(bytes);entry.sent=performance.now();}catch(e){entry.error=e.code;res.writeHead(404).end();}
});
(async()=>{
 await fs.mkdir(output,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});const page=await context.newPage();let errors=[];
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',e=>{if(e.type()==='error')errors.push(e.text())});
 await page.addInitScript(()=>{window.__audit={};window.addEventListener('ashen-ready',()=>window.__audit.ready=performance.now());window.addEventListener('load',()=>window.__audit.pageLoad=performance.now());});
 const began=performance.now();let failure;
 try{await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>document.body.dataset.ready==='true'||document.body.dataset.error,{timeout:60000});await page.waitForFunction(()=>{const a=window.ashen?.metrics()?.ui?.assets;return a&&a.length>0&&a.every(x=>x.state!=='loading')},{timeout:60000});await page.waitForTimeout(500);}catch(e){failure=String(e);}
 const data=await page.evaluate(()=>({audit:window.__audit,time:performance.now(),phase:document.body.dataset.phase,error:document.body.dataset.error,ui:window.ashen?.metrics()?.ui,resources:performance.getEntriesByType('resource').map(x=>({name:new URL(x.name).pathname,startTime:x.startTime,responseEnd:x.responseEnd,duration:x.duration,transferSize:x.transferSize,decodedBodySize:x.decodedBodySize,initiatorType:x.initiatorType}))}));
 const report={kind:'read-only localhost export trace; simulated per-request delay only; not actual WAN or phone measurement',delayMs,failure,errors,elapsedMs:performance.now()-began,...data,requests:requests.map(x=>({...x,received:x.received-began,sent:x.sent-began})),totalRequests:requests.length,totalBytes:requests.reduce((s,r)=>s+r.bytes,0)};
 await fs.writeFile(path.join(output,'export-trace-'+delayMs+'.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({delayMs,failure,errors,elapsedMs:report.elapsedMs,audit:data.audit,phase:data.phase,ui:data.ui,totalRequests:report.totalRequests,totalMiB:report.totalBytes/1048576,large:requests.filter(x=>x.bytes>500000).map(x=>({path:x.path,bytes:x.bytes}))},null,2));
 await browser.close();await new Promise(r=>server.close(r));
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
