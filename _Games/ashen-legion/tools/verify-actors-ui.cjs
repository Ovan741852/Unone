const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');const path=require('node:path');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8190/?seed=42');await page.waitForSelector('body[data-ready="true"]');
 await page.locator('[data-action="Start"]').click();await page.waitForFunction(()=>window.ashen.state().phase==='choice');
 await page.locator('[data-action="Choice1"]').click();await page.waitForFunction(()=>window.ashen.state().phase==='shop');
 await page.locator('[data-action="LeaveShop"]').click();await page.waitForFunction(()=>window.ashen.state().phase==='battle');
 await page.evaluate(()=>{window.ashen.action('Mode_auto');window.ashen.action('Filter_small')});
 await page.waitForTimeout(2200);
 const metrics=await page.evaluate(()=>window.ashen.metrics());
 assert.ok(metrics.actors.actors>15);assert.equal(metrics.actors.creatures,11);assert.equal(metrics.lottie.ok,true);
 assert.ok(metrics.actors.animator.instances.some(i=>i.animation.state==='walk'));
 await page.screenshot({path:path.resolve(__dirname,'../forest-animated-playable.png')});
 assert.deepEqual(errors,[]);console.log('PASS official scene hooks, '+metrics.actors.actors+' animated roots, 11 Blender assets, Lottie Canvas2D, no browser errors');
 console.log(JSON.stringify({drawCalls:metrics.draw_calls,triangles:metrics.triangles,actors:metrics.actors.actors}));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
