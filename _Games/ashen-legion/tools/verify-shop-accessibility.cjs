// Actual Edge keyboard/touch input against the exported WASM game. No state edits.
const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const uiPoint=require('./ui-test-pointer.cjs');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const report={ok:false,checks:[],errors:[]},out=process.env.GAME_TEST_EVIDENCE?path.resolve(process.env.GAME_TEST_EVIDENCE):path.resolve(__dirname,'../tests/shop-layout');
 try{
  const page=await browser.newPage({viewport:{width:1280,height:720},hasTouch:true});
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto((process.env.GAME_TEST_URL||'http://127.0.0.1:8190/')+'?seed=42');
  await page.waitForSelector('body[data-ready="true"]',{timeout:60000});
  async function tap(action,id){
   await page.waitForTimeout(400);
   const r=await page.evaluate(({action,id})=>window.ashen.uiTree().children.find(n=>id?n.id===id:n.action===action)?.rect,{action,id});assert.ok(r,'Missing '+(id??action));
   const p=await uiPoint(page,r);await page.touchscreen.tap(p.x,p.y);await page.waitForTimeout(400);
  }
  const focused=()=>page.evaluate(()=>document.activeElement?.dataset.shopControl);
  const modal=()=>page.evaluate(()=>!!window.ashen.uiTree().children.find(n=>n.id==='shop_detail_title'));
  async function tabTo(id){for(let i=0;i<12;i++){await page.keyboard.press('Tab');if(await focused()===id)return;}assert.fail('Tab cannot reach '+id);}
  await tap('Start');await tap('Profile1');await tap('LaunchExpedition');
  await page.waitForFunction(()=>window.ashen.state().phase==='choice');
  const index=await page.evaluate(()=>Object.values(window.ashen.state().cards).findIndex(c=>c.id==='market'));await tap('Choice'+(index+1));
  await tabTo('stock_hit_1');
  assert.equal(await page.locator('[data-shop-focus]').evaluate(el=>el.hidden),false);
  // Canvas fallback nodes have no CSS boxes: Playwright's DOM ariaSnapshot
  // omits them. Check Chromium's actual accessibility tree, not a DOM facsimile.
  const ax=await page.context().newCDPSession(page);
  report.accessibilityTree=(await ax.send('Accessibility.getFullAXTree')).nodes.filter(n=>!n.ignored).map(n=>({role:n.role?.value,name:n.name?.value}));
  assert.ok(report.accessibilityTree.some(n=>n.role==='button'&&n.name.includes('查看詳情')),'Native accessibility tree must expose cards');
  assert.ok(report.accessibilityTree.some(n=>n.role==='button'&&n.name.includes('重骰')),'Native accessibility tree must expose reroll');
  await page.keyboard.press('Enter');await page.waitForTimeout(350);assert.equal(await modal(),true);assert.equal(await focused(),'shop_detail_close');
  await page.keyboard.press('Shift+Tab');assert.equal(await focused(),'shop_detail_buy');
  await page.keyboard.press('Tab');assert.equal(await focused(),'shop_detail_close');
  await page.keyboard.press('Tab');assert.equal(await focused(),'shop_detail_buy');
  await page.screenshot({path:path.join(out,'keyboard-focus-desktop.png')});
  const before=await page.evaluate(()=>window.ashen.state().crystals);
  const price=await page.evaluate(()=>Object.values(window.ashen.state().stock)[0].price);
  await page.keyboard.press('Space');await page.waitForTimeout(350);
  assert.equal(await page.evaluate(()=>window.ashen.state().crystals),before-price);assert.equal(await modal(),false);assert.equal(await focused(),'stock_hit_1');
  assert.equal(await page.locator('[data-shop-control="shop_detail_buy"]').count(),0);
  report.checks.push('Tab / Enter / Space purchase; visible focus; modal trap; successful purchase closes and returns focus to originating card');
  await tabTo('tab_sell');await page.keyboard.press('Enter');await page.waitForTimeout(350);
  await tabTo('tab_home');await page.keyboard.press('Enter');await page.waitForTimeout(350);
  assert.equal(await page.evaluate(()=>window.ashen.uiTree().children.some(n=>n.id==='stock_hit_1')),true);
  report.checks.push('Sell tab and return to buying stay keyboard reachable');
  await tabTo('stock_hit_1');
  await tap(null,'stock_icon_2');assert.equal(await modal(),true);
  await page.keyboard.press('Escape');await page.waitForTimeout(350);
  assert.equal(await focused(),'stock_hit_2','Return focus follows the card actually opened, not stale keyboard focus');
  report.checks.push('Touching card artwork opens detail (same action as card footer)');
  // Background cards cannot receive clicks while their modal is open.
  await tap(null,'stock_icon_1');const title=await page.evaluate(()=>window.ashen.uiTree().children.find(n=>n.id==='shop_detail_title').text);
  await tap(null,'stock_icon_3');
  assert.ok(!await modal()||await page.evaluate(()=>window.ashen.uiTree().children.find(n=>n.id==='shop_detail_title').text)===title);
  if(await modal()){await page.keyboard.press('Escape');await page.waitForTimeout(350);}
  await tabTo('refresh');await page.keyboard.press('Enter');await page.waitForTimeout(350);
  assert.equal(await page.evaluate(()=>window.ashen.state().crystals),before-price-2);
  assert.match(await page.locator('[data-shop-control="refresh"]').textContent(),/4 結晶/);
  await page.keyboard.press('Space');await page.waitForTimeout(350);
  assert.equal(await page.evaluate(()=>window.ashen.state().crystals),before-price-6);
  assert.equal(await page.locator('[data-shop-control="refresh"]').isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.ashen.state().fired),0,'Space on a shop button must not deploy troops');
  report.checks.push('Keyboard rerolls charge 2 then 4; next fee and insufficient state are exposed');
  // A non-16:9 desktop window letterboxes the same stage and focus ring.
  await page.setViewportSize({width:1600,height:1000});await tabTo('stock_hit_2');
  assert.equal(await page.locator('[data-shop-focus]').evaluate(el=>el.hidden),false);
  await page.keyboard.press('Enter');await page.waitForTimeout(400);assert.equal(await modal(),true);
  await page.screenshot({path:path.join(out,'keyboard-focus-letterbox.png')});
  assert.equal(await page.evaluate(()=>window.ashen.metrics().viewport.rotationDegrees),0);
  report.checks.push('Letterboxed desktop stage retains keyboard focus and detail action without rotation or reflow');
  report.ok=!report.errors.length;
 }finally{fs.writeFileSync(path.join(out,'accessibility-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();}
 assert.ok(report.ok);
})().catch(e=>{console.error(e);process.exitCode=1});
