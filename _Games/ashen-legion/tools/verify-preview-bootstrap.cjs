const{chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../tests/preview-bootstrap');fs.mkdirSync(out,{recursive:true});
const base='http://127.0.0.1:8190';
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const context=await browser.newContext({viewport:{width:1000,height:650}}),page=await context.newPage();
 let releaseModule,releaseImages;const moduleGate=new Promise(r=>releaseModule=r),imageGate=new Promise(r=>releaseImages=r);
 await page.route('**/host.mjs*',async r=>{await moduleGate;await r.continue()});
 await page.route('**/content/assets/formal-ui/expedition-keyart-v2.png',async r=>{await imageGate;await r.continue()});
 await page.goto(base+'/?build=preview-progress',{waitUntil:'commit'});
 const meter=page.locator('#loading-progress');await meter.waitFor({state:'visible'});
 assert.equal(await meter.getAttribute('data-state'),'indeterminate');assert.equal(await meter.getAttribute('aria-valuenow'),null);
 await page.screenshot({path:path.join(out,'indeterminate.png')});releaseModule();
 await page.waitForFunction(()=>document.querySelector('#loading-progress').dataset.state==='determinate');
 await page.waitForFunction(()=>ashenLoading.inspect().groups['首屏圖片']?.total>0);
 const counted=await page.evaluate(()=>({loading:ashenLoading.inspect(),now:document.querySelector('#loading-progress').getAttribute('aria-valuenow'),max:document.querySelector('#loading-progress').getAttribute('aria-valuemax'),text:document.querySelector('#loading-assets').textContent}));
 assert.ok(Number(counted.now)<Number(counted.max));assert.match(counted.text,/首屏圖片 \d+ \/ 6/);
 await page.screenshot({path:path.join(out,'known-files.png')});releaseImages();
 await page.waitForSelector('body[data-ready=true]',{timeout:45000});const ready=await page.evaluate(()=>ashenLoading.inspect());
 assert.equal(ready.groups['部隊與裝備'].done,89);assert.equal(ready.groups['首屏圖片'].done,6);assert.equal(await page.locator('#loading').isVisible(),false);
 await context.close();
 // The actual first-screen decode failure must reach only the direct same-origin
 // parent as a display-only message. Koncrate owns its confirmation and exit.
 const embedded=await browser.newContext({viewport:{width:1000,height:650}}),host=await embedded.newPage();
 await host.route('**/__preview-test-host',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><style>html,body,iframe{border:0;margin:0;width:100%;height:100%}</style><script>window.signals=[];addEventListener('message',e=>{if(e.source===document.querySelector('iframe').contentWindow&&e.origin===location.origin)signals.push(e.data)})</script><iframe src="/?build=preview-error"></iframe>`}));
 await host.route('**/content/assets/formal-ui/expedition-keyart-v2.png',r=>r.fulfill({status:503,body:'unavailable'}));
 await host.goto(base+'/__preview-test-host');await host.waitForFunction(()=>signals.some(s=>s.type==='koncrate-preview-content'&&s.state==='error'),{},{timeout:45000});
 const signals=await host.evaluate(()=>signals),errors=signals.filter(s=>s.state==='error');assert.equal(errors.length,1);assert.match(errors[0].message,/首屏圖片載入失敗/);
 assert.deepEqual(Object.keys(errors[0]).sort(),['message','state','type']);assert.equal(signals.some(s=>s.state==='ready'),false);
 const child=host.frames().find(f=>f.parentFrame());await child.evaluate(()=>ashenLoading.fail(new Error('repeat')));assert.equal(await host.evaluate(()=>signals.filter(s=>s.state==='error').length),1);
 await host.screenshot({path:path.join(out,'parent-error.png')});await embedded.close();
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({counted,ready,signals,scope:'Actual exported game, a blocked module, one blocked first-screen image, then a real 503 image failure in a same-origin parent iframe. Parent messagebox/exit is owned and tested by Koncrate.'},null,2));
 console.log('PASS visible unknown/known progress, 89 models + 6 images, first frame, one narrow same-origin parent error, duplicate suppression');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
