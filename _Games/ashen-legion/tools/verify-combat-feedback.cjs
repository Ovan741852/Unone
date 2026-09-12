const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../tests');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const reports=[],errors=[];
 for(const [width,height]of [[1440,900],[844,390],[390,844]]){
  const page=await browser.newPage({viewport:{width,height},hasTouch:true});page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8190/?build=combat-feedback-v1&seed=1');await page.waitForSelector('body[data-ready=true]',{timeout:45000});
  async function click(a){const r=await page.evaluate(a=>ashen.uiTree().children.find(n=>n.kind==='button'&&n.action===a)?.rect,a);assert.ok(r,a);await page.touchscreen.tap((r.x+r.width/2)*width/100,(100-r.y-r.height/2)*height/100);await page.waitForTimeout(140);}
  await click('Start');await page.waitForFunction(()=>ashen.state().phase==='choice');await page.waitForTimeout(650);await click('Choice1');await page.waitForTimeout(650);await click('LeaveShop');await click('Mode_auto');await page.waitForTimeout(650);await click('Auto_small');await click('Auto_apply');
  await page.waitForFunction(()=>ashen.metrics().labels.criticals>0,null,{timeout:15000});
  const hit=await page.evaluate(()=>({s:ashen.state(),labels:ashen.metrics().labels}));
  assert.ok(hit.labels.items.some(x=>x.kind==='critical'));assert.ok(hit.labels.items.filter(x=>x.kind==='gold').every(x=>/^\+[\d,]+$/.test(x.text)));assert.equal(hit.labels.usesMultiplier,false);
  await page.screenshot({path:path.join(out,`combat-numbers-${width}x${height}.png`)});
  await click('Mode_auto');await click('Unit3');await click('Auto_settings');await page.waitForTimeout(600);await click('Auto_boss');await click('Auto_apply');
  await page.waitForFunction(()=>ashen.metrics().lottie.celebrationVisible,null,{timeout:20000});
  await page.waitForFunction(()=>ashen.metrics().lottie.stage==='count',null,{timeout:6000});
  const win=await page.evaluate(()=>({s:ashen.state(),fx:ashen.metrics().lottie,ui:ashen.uiTree()}));
  assert.ok(win.fx.targetAmount>0);assert.ok(win.fx.rolledAmount<=win.fx.targetAmount);assert.equal(win.fx.usesMultiplier,false);assert.equal(win.fx.pointerEvents,'none');
  for(const n of win.ui.children.filter(n=>n.kind==='button')){const r=n.rect,b={x:r.x*width/100,y:(100-r.y-r.height)*height/100,width:r.width*width/100,height:r.height*height/100},a=win.fx.dockRect;assert.equal(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y,false,'dock overlaps '+n.id);}
  await page.screenshot({path:path.join(out,`win-dock-${width}x${height}.png`)});
  await click('Mode_auto');assert.equal(await page.evaluate(()=>ashen.state().autoEnabled),false,'celebration permits real button input');
  await click('Pause');const paused=await page.evaluate(()=>ashen.metrics().lottie);await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>ashen.metrics().lottie.rolledAmount),paused.rolledAmount);assert.equal(await page.evaluate(()=>ashen.metrics().lottie.celebrationVisible),false);
  await click('Pause');assert.deepEqual(await page.evaluate(()=>ashen.metrics().labels.diagnostics),[]);assert.deepEqual(await page.evaluate(()=>ashen.metrics().lottie.diagnostics),[]);
  reports.push({width,height,hits:hit.labels.items,bigWin:win.fx,actualReward:win.s.rewards});console.log('PASS actual hits, crits, gold and dock '+width+'x'+height);
  await page.close();
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'combat-feedback-browser.json'),JSON.stringify({ok:true,scope:'Production gameplay with real inputs, not synthetic prizes',reports,errors},null,2));
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
