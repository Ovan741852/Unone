const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../tests/first-screen');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const reports=[];
 for(const delay of [0,80]){
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  if(delay)await page.route('**/*',async route=>{await new Promise(r=>setTimeout(r,delay));await route.continue()});
  await page.addInitScript(()=>window.addEventListener('ashen-ready',()=>window.firstReady={at:performance.now(),ui:ashen.metrics().ui,models:ashen.metrics().actors.equipment,creatures:ashen.metrics().actors.creatures,loading:ashenLoading.inspect()}));
  await page.goto('http://127.0.0.1:8190/?build=forced-landscape-v1',{waitUntil:'commit'});
  if(delay){await page.waitForSelector('#loading:not([hidden])');await page.waitForTimeout(300);assert.ok(await page.locator('#loading-elapsed').isVisible());await page.screenshot({path:path.join(out,'loading-portrait.png')});}
  await page.waitForSelector('body[data-ready=true]',{timeout:45000});
  const r=await page.evaluate(()=>({...firstReady,requests:performance.getEntriesByType('resource').map(r=>({url:new URL(r.name).pathname,start:r.startTime,end:r.responseEnd,bytes:r.decodedBodySize})),gateVisible:!document.querySelector('#loading').hidden}));
  assert.ok(r.ui.assets.length>0&&r.ui.assets.every(a=>a.state==='ready'));assert.deepEqual(r.ui.diagnostics,[]);assert.equal(r.models,77);assert.equal(r.creatures,11);assert.equal(r.gateVisible,false);assert.ok(r.loading.firstImages<=r.loading.firstFrame);
  const firstImages=r.requests.filter(r=>r.url.startsWith('/content/assets/formal-ui/'));
  assert.equal(firstImages.length,r.ui.assets.length);assert.ok(firstImages.every(i=>i.end<=r.at));assert.equal(new Set(firstImages.map(i=>i.url)).size,firstImages.length);
  assert.deepEqual(errors,[]);reports.push({delayMs:delay,...r});await context.close();
 }
 // A missing first-screen image must remain a visible recoverable failure.
 const context=await browser.newContext({viewport:{width:844,height:390}}),page=await context.newPage();
 await page.route('**/content/assets/formal-ui/expedition-keyart-v2.png',r=>r.fulfill({status:503,body:'unavailable'}));
 await page.goto('http://127.0.0.1:8190/?build=first-screen-failure');await page.waitForSelector('#loading-retry:not([hidden])',{timeout:45000});
 assert.notEqual(await page.getAttribute('body','data-ready'),'true');assert.match(await page.locator('#error').innerText(),/首屏圖片載入失敗/);await page.screenshot({path:path.join(out,'image-failure.png')});
 await page.unroute('**/content/assets/formal-ui/expedition-keyart-v2.png');await page.locator('#loading-retry').click();await page.waitForSelector('body[data-ready=true]',{timeout:45000});
 assert.equal(await page.evaluate(()=>ashen.state().phase),'menu');assert.deepEqual(await page.evaluate(()=>ashen.metrics().ui.diagnostics),[]);await context.close();
 fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify({scope:'Local fresh browser contexts; 80 ms simulated delay per request, no bandwidth throttle. First-screen images decoded at ready; full roster prepared before play. Simulated missing image plus successful retry.',reports},null,2));
 console.log(JSON.stringify({pass:true,firstFrames:reports.map(r=>({delay:r.delayMs,ready:r.at,loading:r.loading,images:r.ui.assets.length,models:r.models})),failureAndRetry:true}));
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
