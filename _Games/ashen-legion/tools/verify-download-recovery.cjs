const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:393,height:852}});let attempts=0;
 await page.route('**/assets/creatures/beetle.glb',route=>++attempts===1?route.fulfill({status:503,body:'temporary failure'}):route.continue());
 await page.goto('https://node.tail044891.ts.net:8444/?loadtest=retry');await page.waitForSelector('body[data-ready="true"]',{timeout:60000});assert.equal(attempts,2);
 const broken=await browser.newPage({viewport:{width:393,height:852}});let missingAttempts=0;
 await broken.route('**/assets/creatures/beetle.glb',route=>{missingAttempts++;return route.fulfill({status:404,body:'missing'})});
 await broken.goto('https://node.tail044891.ts.net:8444/?loadtest=missing');await broken.waitForSelector('#error:not([hidden])',{timeout:60000});assert.equal(missingAttempts,1);
 const layout=await broken.locator('#error').evaluate(e=>({width:e.clientWidth,scrollWidth:e.scrollWidth,text:e.textContent}));assert.ok(layout.text.includes('404'));assert.ok(layout.scrollWidth<=layout.width+2);
 console.log('PASS HTTPS mobile viewport: injected 503 retries once and loads; 404 fails once with readable wrapped error.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
