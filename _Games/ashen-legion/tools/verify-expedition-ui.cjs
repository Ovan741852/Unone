const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tests/expedition-ui');fs.mkdirSync(out,{recursive:true});
const overlap=(a,b)=>Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>.02&&Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>.02;
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true}),reports=[];try{
 for(const [width,height]of [[1440,900],[844,390],[390,844],[768,1024],[320,568]]){
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<1000,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8190/?build=expedition-ui-v1&seed=42');await page.waitForSelector('body[data-ready="true"]',{timeout:60000});
  const state=()=>page.evaluate(()=>window.ashen.state());
  async function click(action){const r=await page.evaluate(a=>window.ashen.uiTree().children.find(n=>n.kind==='button'&&n.action===a)?.rect,action);assert.ok(r,`${width}: ${action}`);const x=(r.x+r.width/2)*width/100,y=(100-r.y-r.height/2)*height/100;if(width<1000)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);await page.waitForTimeout(130);}
  async function capture(name){
   await page.waitForFunction(()=>window.ashen.metrics().ui.assets.every(a=>a.state==='ready'));const tree=await page.evaluate(()=>window.ashen.uiTree());
   for(const n of tree.children){const r=n.rect;assert.ok(r.x>=-.001&&r.y>=-.001&&r.x+r.width<=100.001&&r.y+r.height<=100.001,`${width}/${name} bounds ${n.id}`);}
   const controls=tree.children.filter(n=>n.kind!=='image');for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++)assert.ok(!overlap(controls[i].rect,controls[j].rect),`${width}/${name}: ${controls[i].id} overlaps ${controls[j].id}`);
   await page.screenshot({path:path.join(out,`${width}x${height}-${name}.png`)});reports.push({width,height,name,tree});console.log(width,height,name);
  }
  await capture('menu');assert.equal(await page.locator('button,section,aside,dialog').count(),0);
  await click('UI_town');await capture('town');await click('UI_home');await click('Start');await page.waitForFunction(()=>window.ashen.state().phase==='choice');await capture('choice');
  await click('ViewMap');await capture('map');await click('VisitLocation');await click('Choice1');await capture('shop');
  await click('UI_page_next');await capture('shop-page2');const actions=await page.evaluate(()=>window.ashen.uiTree().children.filter(n=>n.kind==='button').map(n=>n.action));assert.ok(actions.includes('Buy3'));
  await click('UI_page_prev');const before=await state();await click('Buy1');const after=await state();assert.equal(after.crystals,before.crystals-before.stock[0].price);assert.equal(after.coins,before.coins);await capture('purchased');
  assert.match(await page.evaluate(()=>window.ashen.uiTree().children.find(n=>n.id==='story_quote').text),/已取得/);
  await click('UI_gear');await click('Equip1');await capture('gear');await click('UI_runes');await capture('runes');await click('UI_builds');await click('UI_page_next');await capture('builds');
  await click('LeaveShop');const fired=(await state()).fired;for(const action of ['Unit2','Mode_lock','Mode_auto','Auto_small','Auto_cancel','Mode_lock'])await click(action);assert.equal((await state()).fired,fired,'UI input cannot fire a troop');await capture('battle');
  const points=await page.evaluate(()=>[[-12.5,-12.5],[12.5,-12.5],[-12.5,12.5],[12.5,12.5]].map(([x,z])=>window.ashen.projectPoint(x,z)));
  if(width/height<1.05)assert.ok(points.slice(0,2).every(p=>p.x>=0&&p.x<=width),'portrait retains far corners');
  await click('Pause');await capture('pause');await click('UI_abandon');await capture('abandon');await click('UI_home');await click('Pause');
  const metric=await page.evaluate(()=>window.ashen.metrics());assert.deepEqual(metric.ui.diagnostics,[]);assert.equal(metric.motion.reducedMotion,true);assert.deepEqual(errors,[]);await context.close();
 }
 // Motion evidence uses a live production page, actual input and no state injection.
 const context=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:out,size:{width:1280,height:720}}}),page=await context.newPage();
 await page.goto('http://127.0.0.1:8190/?build=expedition-ui-v1&seed=42');await page.waitForSelector('body[data-ready="true"]',{timeout:60000});
 async function click(action){const r=await page.evaluate(a=>window.ashen.uiTree().children.find(n=>n.kind==='button'&&n.action===a)?.rect,action);assert.ok(r,action);await page.mouse.click((r.x+r.width/2)*12.8,(100-r.y-r.height/2)*7.2);await page.waitForTimeout(130);}
 await page.waitForTimeout(800);const a=await page.evaluate(()=>window.ashen.uiTree().children.find(n=>n.id==='crest').rect);await page.waitForTimeout(250);const b=await page.evaluate(()=>window.ashen.uiTree().children.find(n=>n.id==='crest').rect);assert.notEqual(a.y,b.y,'ambient crest motion');
 await click('Start');await page.waitForFunction(()=>window.ashen.state().phase==='choice');await page.waitForTimeout(900);await click('Choice1');
 await page.waitForTimeout(900);await click('Buy1');await page.waitForTimeout(900);await click('UI_page_next');await page.waitForTimeout(800);await click('UI_gear');await page.waitForTimeout(700);await click('Equip1');await click('LeaveShop');
 const fired=await page.evaluate(()=>window.ashen.state().fired);await click('Unit2');assert.equal(await page.evaluate(()=>window.ashen.state().fired),fired);await click('Mode_auto');await page.waitForTimeout(650);await click('Auto_apply');await page.waitForTimeout(1200);await click('Pause');
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.ashen.metrics().motion.reducedMotion),true);
 // Emulate asymmetric notch/browser insets; these are canvas-host dimensions,
 // not replacement DOM game controls. Resize must cancel old pointer holds.
 await page.evaluate(()=>{for(const [key,value]of Object.entries({left:24,right:16,top:4,bottom:12}))document.documentElement.style.setProperty('--safe-'+key,value+'px');});
 await page.setViewportSize({width:844,height:390});await page.waitForTimeout(200);
 const safe=await page.evaluate(()=>({metrics:window.ashen.metrics(),buttons:window.ashen.uiTree().children.filter(n=>n.kind==='button')}));
 assert.equal(safe.metrics.viewport.safeInsets.left,24);
 for(const n of safe.buttons){assert.ok(n.rect.x>=24/844*100&&n.rect.x+n.rect.width<=100-16/844*100);assert.ok(n.rect.y>=12/390*100&&n.rect.y+n.rect.height<=100-4/390*100);}
 const video=page.video();await context.close();await video.saveAs(path.join(out,'expedition-motion.webm'));
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({ok:true,scope:'Real production Canvas input, 5 viewport sizes, pagination, purchases, equipment, pause, reduced motion and motion video',reports},null,2));console.log('PASS expedition UI');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
