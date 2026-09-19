const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const uiPoint=require('./ui-test-pointer.cjs');
const captureDir=fs.mkdtempSync(path.join(os.tmpdir(),'ashen-legion-ui-'));
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],trees={};page.on('pageerror',e=>errors.push(e.message));
 await page.goto((process.env.GAME_TEST_URL||'http://127.0.0.1:8190/')+'?seed=42');await page.waitForSelector('body[data-ready="true"]',{timeout:60000});
 const state=()=>page.evaluate(()=>window.ashen.state());
 async function click(action,target){const r=await page.evaluate(({action,target})=>window.ashen.uiTree().children.find(n=>n.kind==='button'&&(target?n.id===target:n.action===action))?.rect,{action,target});assert.ok(r,'Missing action '+action);const p=await uiPoint(page,r);await page.mouse.click(p.x,p.y);await page.waitForTimeout(130);}
 async function capture(name){await page.waitForFunction(()=>window.ashen.metrics().ui.assets.every(a=>a.state==='ready'));trees[name]=await page.evaluate(()=>window.ashen.uiTree());await page.screenshot({path:path.join(captureDir,'formal-ui-'+name+'.png')});}
 await capture('menu');assert.equal(await page.locator('button:visible,section:visible,aside:visible,dialog:visible').count(),0);
 await click('Start');assert.equal((await state()).phase,'menu');await capture('town');
 assert.ok(await page.evaluate(()=>window.ashen.uiTree().children.some(n=>n.action==='Profile1')));
 await click('Profile2');await click('LaunchExpedition');assert.equal((await state()).phase,'map');await capture('map');
 await page.waitForFunction(()=>window.ashen.state().phase==='choice');await capture('choice');
 await click('ViewMap');assert.equal((await state()).phase,'map');await capture('map-arrived');await click('VisitLocation');assert.equal((await state()).phase,'choice');
 const market=Object.values((await state()).cards).findIndex(c=>c.id==='market');await click('Choice'+(market+1));assert.equal((await state()).phase,'shop');await capture('shop');
 const before=(await state()).coins,crystals=(await state()).crystals,quote=(await state()).stock[0],price=quote.price;await click('ShopDetail1');await capture('shop-detail');await click('Buy1');assert.equal((await state()).coins,before);assert.equal((await state()).crystals,crystals-price);await click('ShopDetailClose','shop_detail_close');
 await click('LeaveShop');assert.equal((await state()).phase,'loadout');await click('Equip1');assert.equal((await state()).costs[0],Math.ceil((8+quote.deployExtra)*.5));await capture('gear');
 await click('UI_runes');await capture('runes');
 assert.ok(!await page.evaluate(()=>window.ashen.uiTree().children.some(n=>n.action==='UI_builds'||(n.text||'').includes('流派'))));
 await click('Deploy');assert.equal((await state()).phase,'battle');
 const deployed=(await state()).fired;await click('Unit2');await click('Mode_lock');await click('Mode_auto');await click('Auto_small');await click('Auto_cancel');assert.equal((await state()).fired,deployed,'UI actions must not shoot');
 await click('Mode_lock');await click('Unit1');await page.mouse.move(600,440);await page.mouse.down();await page.waitForTimeout(650);await page.mouse.up();await page.waitForTimeout(500);assert.ok((await state()).fired>deployed,'hold field deploys troops');
 await click('Mode_auto');await page.waitForTimeout(650);await click('Auto_apply');await page.waitForTimeout(1400);await capture('battle');
 await click('Pause');assert.equal((await state()).paused,true);await capture('pause');await click('UI_abandon');await capture('abandon');await click('UI_home');assert.equal((await state()).phase,'battle');await click('Pause');assert.equal((await state()).paused,false);
 const metrics=await page.evaluate(()=>window.ashen.metrics());assert.equal(metrics.ui.backend,'canvas2d');assert.deepEqual(metrics.ui.diagnostics,[]);assert.equal(metrics.lottie.ok,true);assert.ok(metrics.actors.actors>10);
 for(const [width,height] of [[1280,720],[900,600]]){
  await page.setViewportSize({width,height});await capture(`battle-${width}x${height}`);
  const bounds=await page.evaluate(()=>window.ashen.uiTree().children.every(n=>n.rect.x>=0&&n.rect.y>=0&&n.rect.x+n.rect.width<=100&&n.rect.y+n.rect.height<=100));assert.equal(bounds,true);
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.resolve(__dirname,'../tests/formal-ui-browser.json'),JSON.stringify({ok:true,errors,metrics,trees},null,2));console.log('PASS actual canvas pointer: save selection, town, expedition, buy, paper-doll equipment, runes, field hold, lock/auto/filter and pause; no DOM game controls.');
}finally{await browser.close();fs.rmSync(captureDir,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
