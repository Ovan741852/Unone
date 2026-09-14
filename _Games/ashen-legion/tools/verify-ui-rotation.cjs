const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:844,height:390},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8190/?build=expedition-ui-v1&seed=42');await page.waitForSelector('body[data-ready="true"]',{timeout:60000});
 async function click(action){const r=await page.evaluate(a=>window.ashen.uiTree().children.find(n=>n.kind==='button'&&n.action===a)?.rect,action);assert.ok(r,action);const v=page.viewportSize();await page.mouse.click((r.x+r.width/2)*v.width/100,(100-r.y-r.height/2)*v.height/100);await page.waitForTimeout(130);}
 await click('Start');await page.waitForFunction(()=>window.ashen.state().phase==='choice');await click('Choice1');await click('LeaveShop');
 const point=await page.evaluate(()=>window.ashen.projectPoint(0,0));await page.mouse.move(point.x,point.y);await page.mouse.down();await page.waitForFunction(()=>window.ashen.state().fired>0);
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400);const a=await page.evaluate(()=>window.ashen.state().fired);await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>window.ashen.state().fired),a,'rotation cancels held fire');await page.mouse.up();
 await click('Unit2');assert.equal(await page.evaluate(()=>window.ashen.state().selected),2);assert.equal(await page.evaluate(()=>window.ashen.state().fired),a);
 await page.setViewportSize({width:844,height:390});await page.waitForTimeout(200);await click('Mode_lock');assert.equal(await page.evaluate(()=>window.ashen.state().fireMode),'lock');await click('Pause');assert.equal(await page.evaluate(()=>window.ashen.state().paused),true);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.resolve(__dirname,'../tests/expedition-ui/rotation.json'),JSON.stringify({ok:true,scope:'Same production game session: rotate landscape to portrait while firing, release, select troop, rotate back, lock and pause',errors},null,2));console.log('PASS live orientation switch cancels held fire and preserves UI actions');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
