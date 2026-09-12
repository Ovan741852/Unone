const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8190/?seed=42');
  await page.waitForSelector('body[data-ready="true"]');
  await page.locator('#rpg-inventory').click();
  await page.locator('#build-guide summary').click();
  assert.equal(await page.locator('#build-guide > .rpg-grid').first().locator('article').count(),9);
  assert.ok((await page.locator('#build-guide').innerText()).includes('霜鋼重擊'));
  await page.locator('#rpg-panel [data-action="Unit3"]').click();
  await page.waitForFunction(()=>document.querySelector('#build-guide summary')?.textContent.includes('騎兵'));
  assert.equal(await page.locator('#build-guide').getAttribute('open'),'');
  assert.ok((await page.locator('#build-guide').innerText()).includes('穿透 +1 ×20'));
  await page.locator('#rpg-panel').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:path.resolve(__dirname,'../build-guide-playable.png')});
  assert.deepEqual(errors,[]);
  console.log('PASS browser: 9 real build guides, selected unit updates, innate stacks, open state preserved, no page errors');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
