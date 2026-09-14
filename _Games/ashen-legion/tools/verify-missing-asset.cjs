const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage();await page.route('**/assets/creatures/moth.glb',route=>route.fulfill({status:404,body:'Fixture: missing model'}));
 await page.goto('http://127.0.0.1:8190/');await page.waitForSelector('body[data-error]');
 assert.match(await page.locator('#error').innerText(),/404|Failed to fetch|moth/);
 assert.equal(await page.locator('body').getAttribute('data-ready'),null);
 console.log('PASS missing actor asset surfaces explicit load error; never reports ready with invisible actors');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
