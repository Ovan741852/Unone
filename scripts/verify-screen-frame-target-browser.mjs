import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import http from 'node:http';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url);
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const allowed=new Set(['/web/renderer/screen-frame-target-browser.fixture.mjs','/web/renderer/screen-frame-target.js','/web/vendor/three/three.module.js','/web/vendor/three/three.core.js']);
const server=http.createServer((req,res)=>{if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><script type="module" src="/web/renderer/screen-frame-target-browser.fixture.mjs"></script>');return;}
 if(!allowed.has(req.url)){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':'text/javascript'});fs.createReadStream(path.join(root,req.url)).pipe(res);});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));let browser;
try{browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.runScreenFrameMatrix);const matrix=await page.evaluate(()=>window.runScreenFrameMatrix());
 const initial=await page.evaluate(()=>window.startAtomicFrameTest()),frame=()=>page.evaluate(()=>new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok))));await frame();const before=await page.locator('#atomic').screenshot();
 const aborted=await page.evaluate(()=>window.abortAtomicFrame());await frame();const after=await page.locator('#atomic').screenshot();const retained=before.equals(after);
 const last=await page.evaluate(()=>window.finishAtomicFrame());await frame();const final=await page.locator('#atomic').screenshot();const changed=!after.equals(final);
 console.log(JSON.stringify({errors,matrix,atomic:{initial,aborted,retained,last,changed}},null,2));if(errors.length||matrix.some(x=>x.changed||x.errors.some(Boolean))||!retained||!changed)process.exitCode=1;
}finally{await browser?.close();await new Promise(ok=>server.close(ok));}
